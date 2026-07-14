# 実装指示書：MetaLife有料プラン相当機能の実装

対象実装者: Claude Sonnet 5（AIエージェント）
最終更新: 2026-07-13

## 0. 背景と目的

このアプリは SkyOffice（Phaser3 + Colyseus + React/Redux + PeerJS）をフォークした社内向け仮想オフィス。
目的は次の2つ。

1. 現状の使い勝手の悪さ（特にミーティングルームのホワイトボード）を解消する
2. MetaLife（https://metalife.co.jp）の**有料プランでできることをすべてこのアプリでもできるようにする**

フェーズ1→2→3→4の順に実装すること。**フェーズ内のタスクも記載順に実施**し、各タスク完了ごとに動作確認してからコミットする（コミットメッセージは既存に合わせて日本語1行）。

### 開発環境の起動

```bash
# サーバー（ルートで）
npm start          # localhost:2567 (Colyseus)
# クライアント
cd client && yarn dev   # Vite dev server
```

- 動作確認はブラウザタブを2つ開いて2ユーザーで行うこと（同期機能の検証に必須）。
- devサーバーの変更が反映されないときはブラウザReloadではなく**プロセスをCtrl+Cで完全再起動**する。

### 全体アーキテクチャの要点（先に読むべきファイル）

| ファイル | 役割 |
|---|---|
| `types/Messages.ts` | クライアント⇔サーバーのメッセージenum（**追加はここから**） |
| `types/IOfficeState.ts` | Colyseus同期スキーマのinterface |
| `server/rooms/schema/OfficeState.ts` | スキーマ実体（Playerなど） |
| `server/rooms/SkyOffice.ts` | サーバー本体。onMessageハンドラ群＋JSONファイル永続化 |
| `client/src/services/Network.ts` | クライアント側の通信層。room.send / onMessage / phaserEvents中継 |
| `client/src/events/EventCenter.ts` | Phaser⇔Reactのイベントバス |
| `client/src/components/MeetingRoomOverlay.tsx` | ミーティングルーム全画面UI（Excalidraw WB＋メモ＋カメラ列） |
| `client/src/scenes/Game.ts` | Phaserメインシーン。入退室・近接判定 |
| `client/src/web/WebRTC.ts` | PeerJSラッパー。近接通話・画面共有・近接マイク自動制御 |

永続化は現状すべてサーバーカレントのJSONファイル（`attendance.json` / `signboards.json` / `builder.json` / `meeting-whiteboards.json`）。フェーズ1〜2ではこの方式を踏襲してよい（フェーズ3でDB化）。

### 共通ルール

- UI文言はすべて日本語。専門用語・略語を出す前に平易な言い換えを検討する。
- サーバー側で受信データは必ず検証する（既存コードの `.slice(0, 500)` や hex色の正規表現チェックの流儀に従う）。
- 既存機能（勤怠・看板・マップビルダー・ジュークボックス・ノック・エモート・既読チャット）を壊さないこと。タスク完了ごとに主要動線を一通り触って確認する。
- `Message` enumは**末尾にのみ追加**する（既存の順序を変えると互換性が壊れる）。

---

## フェーズ1: ミーティングルームの使い勝手修正（最優先）

### 1-1. 議事録メモとタブのサーバー同期化【最重要】

**現状の問題**: `MeetingRoomOverlay.tsx` の `DocumentEditor`（メモ欄）と `WBTab`（タブ一覧）は localStorage 保存のみで、**他の参加者に一切共有されていない**。議事録を書いても自分にしか見えず、タブ構成も人によって違う。

**実装内容**:

1. `types/Messages.ts` 末尾に追加:
   - `MEETING_DOC_SYNC`（メモ本文の同期）
   - `REQUEST_MEETING_DOC_SNAPSHOT`
   - `MEETING_TABS_SYNC`（タブ一覧の同期）
   - `REQUEST_MEETING_TABS_SNAPSHOT`
2. サーバー `SkyOffice.ts`: 既存の `meetingWhiteboardSnapshots` とまったく同じパターンで `meetingDocSnapshots` / `meetingTabsSnapshots` の Map を追加。永続化ファイルは `meeting-docs.json` / `meeting-tabs.json`。保存は既存の3秒デバウンス方式（`scheduleWhiteboardSave` を汎用化してよい）。
3. `Network.ts`: 送信メソッド（`sendMeetingDocUpdate(roomId, content)` 等）と受信ハンドラを既存のホワイトボード同期と同じ流儀で追加。`EventCenter.ts` にイベント追加。
4. `MeetingRoomOverlay.tsx`:
   - `DocumentEditor`: 入力を300msデバウンスでサーバー送信。リモート更新受信時は、**自分のtextareaにフォーカスがあり未送信の編集がある場合は上書きしない**（自分の編集が優先）。フォーカスがない場合のみ反映し、反映時は `selectionStart/End` を保存・復元してカーソル位置が飛ばないようにする。競合解決はlast-writer-winsで妥協してよい（v1）。
   - タブ（追加・削除・リネーム）: 操作のたびにタブ配列全体をサーバー送信し、受信側は全置換。`loadTabs`/`saveTabs` のlocalStorageはオフラインフォールバックとして残してよいが、**サーバースナップショットを正とする**。
   - 入室時に `REQUEST_MEETING_DOC_SNAPSHOT` / `REQUEST_MEETING_TABS_SNAPSHOT` を送る（既存の `requestMeetingWhiteboardSnapshot` と同じタイミング）。

**受け入れ条件**: 2つのブラウザタブで同じミーティングルームに入り、(a)片方でメモを書くともう片方に1秒以内に表示される、(b)タブの追加・リネーム・削除が双方に反映される、(c)全員退室→再入室してもメモとタブが残っている、(d)入力中にカーソルが飛ばない。

### 1-2. ホワイトボード同期の軽量化と同時編集の競合解消

**現状の問題**（`MeetingRoomOverlay.tsx` の `CollaborativeWhiteboard`）:
- 描画のたびに `elements` + **全画像のbase64（`files`）** を丸ごと送信している（160msデバウンス）。画像を貼ると1回の更新が数MBになる。
- 受信側は `updateScene` で elements を**全置換**するため、2人が同時に描くと後勝ちで片方の描画が消える。

**実装内容**:

1. **画像の再送停止**: 送信済み fileId を `Set` で記録し、`files` は**未送信の新規分だけ**payloadに含める。サーバー側は roomId ごとに files をマージして保持し（スナップショットには全fileを含める）、`REQUEST_MEETING_WHITEBOARD_SNAPSHOT` への応答では全量を返す。受信側は今まで通り `addFiles` で追加（既にマージ実装あり）。
2. **要素レベルの調停（reconciliation）**: 受信時に全置換をやめ、Excalidraw要素が持つ `id` / `version` / `versionNonce` を使ってマージする:
   - ローカルとリモートを `id` で突合し、`version` が大きい方を採用（同versionなら `versionNonce` が小さい方など決定的なルールで統一）。
   - 削除は Excalidraw の `isDeleted: true` フラグ付き要素として伝搬するのでそのままマージで処理される。
   - マージ結果を `updateScene` に渡す。これは Excalidraw 公式コラボ実装（excalidraw-app の reconcileElements）と同じ考え方。@excalidraw/excalidraw パッケージが `reconcileElements` 相当をexportしていればそれを使い、なければ約30行の自前実装でよい。
   - 送信側も全量 `elements` を送ってよい（要素マージで競合が解消されるため）。ただし `isDeleted` 要素が無限に溜まるので、サーバー保存時に `isDeleted` かつ更新から24時間超の要素を間引く処理を入れる。
3. `appState` の同期対象は現状どおり `viewBackgroundColor` / `theme` / `gridSize` のみ（ズームや選択状態を同期してはならない）。

**受け入れ条件**: (a)2タブで**同時に**線を描き続けても互いの描画が消えない、(b)画像を3枚貼った後の描画操作で送信payloadに画像データが含まれない（DevToolsのWSフレームで確認）、(c)再入室で画像含め全要素が復元される。

### 1-3. 会議室コンテンツの配信先を参加者に限定

**現状の問題**: `SkyOffice.ts` の `MEETING_WHITEBOARD_SYNC` ハンドラが `this.broadcast(...)` で**オフィス全員**に送っている。会議室外の人にも帯域を消費し、秘匿性もない。

**実装内容**: Player スキーマには既に `meetingRoomId` がある（入退室時に `UPDATE_MEETING_ROOM_ID` で更新済み）。ホワイトボード／メモ／タブの同期メッセージは、`this.clients` のうち `this.state.players.get(client.sessionId)?.meetingRoomId === message.roomId` のクライアントにだけ `client.send(...)` する共通ヘルパー `broadcastToMeetingRoom(roomId, type, payload, exceptClient)` を作って置き換える。

注意: タスク1-6で旧ホワイトボードにも同じ同期チャネルを使う。その場合の roomId は `board_` プレフィックスで区別し、`board_` 始まりの roomId は該当ホワイトボードの `connectedUser` に含まれるクライアントへ送る。

**受け入れ条件**: 会議室の外にいるタブのWSフレームに、会議室内の描画更新が流れてこない。

### 1-4. 「手を挙げる」の同期

**現状の問題**: `MeetingRoomOverlay.tsx` の `handRaised` はローカルstateのみ。誰にも見えない。

**実装内容**: `IPlayer` / `OfficeState.ts` の Player スキーマに `handRaised: boolean` を追加し、`Message.RAISE_HAND` を追加。クライアントはトグル時に送信、サーバーは player の値を更新（状態同期で全員に伝わる）。`Network.ts` の `player.onChange` で `handRaised` の変化を検知して Redux（`UserStore` の playerStatus map など既存の仕組み）に流す。UI:
- 参加者パネルの該当者に「✋」を表示
- 相手のカメラカード（`CamCard` のラベル部）にも「✋」を表示
- 会議室退室時（`clearActiveMeetingRoom` / `MEETING_ROOM_EXIT`）に自動で手を下ろす

**受け入れ条件**: 片方が手を挙げると、もう片方の参加者パネルとカメララベルに✋が出る。退室すると消える。

### 1-5. 参加者パネルを「その会議室の参加者」に修正

**現状の問題**: `MeetingRoomOverlay.tsx:1054` が `playerNameMap.values()` 全員を表示している。

**実装内容**: `Network.ts` の `player.onChange` で `meetingRoomId` の変化も Redux に反映する（`UserStore` に `playerMeetingRoomMap` を追加するか、既存の playerStatus オブジェクトに含める）。パネルでは `meetingRoomId === activeRoom.id` のプレイヤー＋自分だけを表示する。マイクミュート状態（`isAudioMuted` は既にスキーマにある）と✋も併記する。

**受け入れ条件**: 会議室Aに2人・オフィスに1人の状態で、パネルに2人だけ表示される。

### 1-6. 旧tldrawホワイトボードの廃止（外部流出リスクの解消）

**現状の問題**: マップ上のホワイトボード3枚は `client/src/stores/WhiteboardStore.ts:43` で `https://www.tldraw.com/r/sky-office-<roomId>` （**公開URL**）をiframe表示している。URLを推測されれば社外から閲覧・編集可能で、外部サービス依存でもある。

**実装内容**:
1. `MeetingRoomOverlay.tsx` の `CollaborativeWhiteboard` を独立ファイル `client/src/components/CollaborativeWhiteboard.tsx` に切り出す（propsは `roomId` のみ。ExcalidrawGlobalスタイルも移す）。
2. `WhiteboardDialog.tsx` のiframeをこのコンポーネントに置き換え、roomIdは `board_${whiteboardId}` とする。同期チャネル・永続化は既存の `MEETING_WHITEBOARD_SYNC` をそのまま使う（1-3の `board_` 配信ルール参照）。
3. `WhiteboardStore.ts` からtldraw URL生成を削除（`whiteboardId` だけ保持）。`OfficeState.ts` の `getRoomId`/`whiteboardRoomIds` 周りは残しても害はないが、未使用になるなら削除。
4. ダイアログを開いている間のキー無効化（`game.disableKeys()`）は現状の流儀を維持。

**受け入れ条件**: マップ上のホワイトボードに近づいてEnterで開くとExcalidrawが出て、2タブ間で同期し、再起動後も内容が残る。tldraw.comへの通信が発生しない。

### 1-7. ミーティングルームUIの微修正

- カメラ列のピアビデオ取り込みが `MutationObserver` でDOM移動するハック（`MeetingRoomOverlay.tsx:1037-1049`）になっている。`WebRTC.ts` 側に「マウント先コンテナを登録し、新規ストリームは登録先に直接append する」APIを追加して置き換える（`mountPeerVideos` の拡張）。
- フォントサイズが全体に過大（タブ30px、ボタンラベル22px等）。一般的なフルHDで自然なサイズ（タブ16-18px、ラベル12-14px、ボタン高さ半分程度）に調整する。ただし4K想定で使っている可能性があるため、**変更前にスクリーンショットを撮って差を確認**し、極端に小さくしない。
- `WhiteboardDialog.tsx` の `Backdrop` に `padding: 16px 180px 16px 16px` という右側固定180pxがある。チャットサイドバーとの重なり回避と思われるが、サイドバー非表示時は全幅を使えるようにする。

---

## フェーズ2: アカウント・権限管理（MetaLife有料プランの中核）

MetaLife有料プランの目玉はほぼすべて「管理者権限」を前提にする。**先にアカウント基盤を作り、その上に各制限機能を載せる**こと。

### 2-1. ユーザーアカウントとログイン

**現状**: 名前を入力するだけの匿名入室。`LoginDialog.tsx` が入口。

**実装内容**:
1. サーバーに `users.json` 永続化のユーザーストアを追加: `{ id, name, passwordHash(bcrypt・依存導入済み), role: 'admin'|'member'|'guest', banned: boolean, createdAt }`。
2. Express（`server/index.ts`）にAPI追加: `POST /api/auth/register`（初回登録。**最初に登録したユーザーが自動的にadmin**）、`POST /api/auth/login`（トークン発行。`jsonwebtoken` を追加依存とする）、`GET /api/auth/me`。
3. Colyseus `onAuth` を拡張: joinオプションでトークンを受け取り検証。`banned` ユーザーは `ServerError(403)` で拒否。検証結果の userId/role を `client.userData` に保持し、Player スキーマに `userId` / `role` を追加して同期する。
4. **匿名入室（ゲスト）は設定で許可制**にする: スペース設定 `allowAnonymous: boolean`（デフォルトtrue、管理画面から変更可）。匿名ユーザーは `role: 'guest'` 扱い。
5. `LoginDialog.tsx` を「ログイン／新規登録／ゲストとして入る」の3導線に改修。トークンはlocalStorageに保存し自動ログイン。

### 2-2. 管理画面（アドミンパネル）

`client/src/components/AdminPanel.tsx` を新設（管理者roleのみ表示されるFAB→ダイアログ）。機能:
- ユーザー一覧: role変更、**永久追放（BAN）**、強制退室（kick: サーバーで `client.leave()`）
- スペース設定の編集（2-3の権限設定、2-1の匿名許可、後述のIP制限等）
- 設定は `space-settings.json` に永続化し、`OfficeState` に読み取り専用フィールドとして同期する

### 2-3. 権限別の機能制限（通信制御）

スペース設定に以下のフラグを持たせ、**サーバー側の各onMessageハンドラで必ず検証**する（クライアント側はUIを無効化表示するだけ。クライアント検証だけでは制限にならない）:

| 設定 | 効果（guestまたは指定role以下に対して） |
|---|---|
| `restrictChat` | `ADD_CHAT_MESSAGE` を拒否 |
| `restrictFileUpload` | `SEND_FILE_MESSAGE` を拒否 |
| `restrictScreenShare` | 画面共有開始を拒否（Player スキーマに `canScreenShare` を同期しクライアントで抑止＋`CONNECT_TO_COMPUTER` 側でも検証） |
| `restrictWhiteboard` | `MEETING_WHITEBOARD_SYNC` 等の書き込みを拒否（閲覧は可） |
| `restrictMegaphone` | 2-5のメガホン使用を拒否 |
| `restrictBuilder` | マップビルダー系メッセージを拒否 |

拒否時はクライアントにエラーメッセージを返し、トースト表示する（例:「この操作は管理者により制限されています」）。

### 2-4. 会議室の施錠（中から鍵をかける）

1. `OfficeState` に `meetingRoomLocks: MapSchema<string>`（roomId → 施錠者sessionId。空なら解錠）を追加。`Message.LOCK_MEETING_ROOM` / `UNLOCK_MEETING_ROOM` を追加。施錠・解錠できるのは**室内にいる人**のみ（サーバーで `player.meetingRoomId === roomId` を検証）。
2. `Game.ts` の入口判定（`handleMeetingRoomEntrance` 付近、`Game.ts:1106` 参照）で施錠中なら入室させず、「🔒 会議中です」のフキダシ表示＋ノック導線（既存の `KNOCK_PLAYER` を流用して室内全員に通知）を出す。
3. `MeetingRoomOverlay.tsx` の下部バーに「🔒 鍵をかける／開ける」トグルを追加。施錠中はヘッダー等に施錠中表示。
4. 施錠者が退室・切断したら自動解錠（`onLeave` と `MEETING_ROOM_EXIT` の両方で処理）。

### 2-5. メガホン（フロア全体放送）

**設計方針**: 近接通話は `OtherPlayer.ts` の overlap 判定で `makeCall` する仕組み（`Game.ts:1150` / `OtherPlayer.ts:209-220` 参照）。メガホンは「距離に関係なく全員と通話状態にする」機能として実装する。

1. Player スキーマに `megaphoneOn: boolean` を追加、`Message.TOGGLE_MEGAPHONE` を追加（`restrictMegaphone` をサーバー検証）。
2. クライアント: 誰かの `megaphoneOn` がtrueになったら、距離に関係なく `webRTC.connectToNewUser(そのsessionId)` で接続し、falseに戻ったら**近接範囲外なら**切断する。`OtherPlayer` の「範囲外になったら切断」ロジックに「相手がメガホン中なら切断しない」条件を追加。
3. UI: 画面下ツールバーにメガホンボタン（📢）。使用中は画面上部に「◯◯さんが全体放送中」バナーを全員に表示。
4. 音量: メガホン中の相手の音声は近接減衰を適用しない。

### 2-6. 入室制御（IP制限・ワンタイムパスワード）

1. **IP制限**: スペース設定に `allowedIps: string[]`（CIDR対応、空なら制限なし）。Colyseus `onAuth` で `client` のリモートIP（`request.headers['x-forwarded-for']` 優先。Render等のプロキシ配下を考慮）を検証。管理画面から編集。
2. **ワンタイムパスワード**: スペース設定 `requireOtp: boolean`。有効時、ログイン後にサーバーが6桁コードを発行して**管理者の画面に表示**（メール基盤がないため、v1は「管理者が口頭/チャットで伝える」運用とする。メール送信はフェーズ3の連携後に拡張）。コードは10分有効・1回限り。
3. 既存のスペースパスワード（bcrypt）はそのまま併存。

### フェーズ2の受け入れ条件（共通）

- ゲスト制限ONのとき、ゲストのチャット送信がサーバーで拒否される（DevToolsから直接 `room.send` しても弾かれること）
- BANしたユーザーは再ログイン・再入室できない
- 施錠された会議室に外から入れず、ノックが室内に届く
- メガホンONで、マップの反対側にいる人にも声が届く

---

## フェーズ3: 外部連携・運用機能

### 3-1. ファイル送信のサーバーアップロード化（全ファイル形式対応）

**現状**: `Chat.tsx` がファイルをbase64化してWSでbroadcastしている（25MB上限、`MAX_FILE_SIZE`）。大きいファイルで全員のWSが詰まる。

**実装内容**: Express に `POST /api/files`（multer、認証必須、25MB上限維持）と `GET /files/:id` を追加。チャットにはURLとメタ情報だけ流す。保存先は `server/uploads/`（フェーズ3-4のDB移行時にパスをストレージ抽象に載せる)。拡張子制限はしない（MetaLife有料同等の全形式対応）が、`Content-Disposition: attachment` で配信しXSSを防ぐ。既存のbase64受信表示コードは後方互換のため残してよい。

### 3-2. Webhook・Slack/Teams/Google Chat通知

1. スペース設定に `webhooks: { url, events[] }[]` を追加（管理画面から編集、件数無制限）。
2. 通知イベント: 入室/退室、チャット投稿（本文の先頭100文字）、ノック、会議開始/終了、勤怠（出社/退社）。
3. 送信フォーマットはSlack Incoming Webhook互換のJSON（`{ text: "..." }`）を基本とし、Teams/Google Chatも同形式のシンプルテキストで送る（各サービスのIncoming Webhookはいずれも `text` 系フィールドで受けられる。Teamsのみ `{ text }` でMessageCard扱いになることを確認する）。
4. 送信はfire-and-forget＋失敗ログ。サーバーをブロックしないこと。

### 3-3. 操作ログ

1. `server/audit-log.jsonl`（JSON Lines、追記のみ）に記録: 入退室、ログイン成否、BAN/kick、role変更、スペース設定変更、ファイルアップロード、会議室施錠/解錠、看板・ビルダー編集。各行 `{ ts, userId, name, action, detail }`。
2. 管理画面に閲覧タブ（日付フィルタ＋アクション種別フィルタ、新しい順、ページング）。
3. ログ肥大対策: 日付ごとにファイル分割（`audit-2026-07-13.jsonl`）。

### 3-4. 永続化のDB移行

**現状の問題**: JSONファイル群はRenderの再デプロイで消える（エフェメラルディスク）。

**実装内容**: `better-sqlite3` でSQLite化し、`server/storage.ts` に読み書きを集約（attendance / signboards / builder / whiteboards / docs / tabs / users / settings / audit）。DBファイルのパスは環境変数 `DATA_DIR`（デフォルト `./data`）とし、RenderではPersistent Diskをマウントする想定。既存JSONファイルが存在する場合は初回起動時に自動インポートする移行処理を入れること。

### 3-5. カレンダー連携（簡易版）

Google カレンダーの本格OAuth連携は行わず、v1は: 会議室ごとに「予定」を登録できる簡易スケジュール（タイトル・開始終了・作成者）を設け、開始5分前にスペース内通知＋（設定があれば）Webhook通知を送る。管理不要・DB1テーブルで済む範囲に留める。

---

## フェーズ4: 空間・見た目

このフェーズは規模が大きいため、**各タスク着手前に設計をユーザーに提示して承認を得る**こと。

**同時接続の目標は10人**（ユーザー確認済み 2026-07-13）。現状のPeerJSフルメッシュで10人は実用範囲のため、**SFU（LiveKit等）への移行は行わない**。代わりに10人快適化の軽い調整のみ実施:

### 4-1. 通話の10人快適化（軽微）

- 送信映像の解像度・フレームレート上限を設定（例: 640x360 / 24fps。`getUserMedia` の constraints で指定）
- 会議室内で参加者が多いとき、画面外のカメラ映像の描画を止める（video要素の `IntersectionObserver` で非表示時にsrcObjectは維持しつつ再生負荷を下げる）
- 通話相手数が10を超えた場合の挙動（新規接続を保留し「参加者が上限です」表示）を明確化

### 4-2. 複数フロアとフロア別入室制限

- Colyseusのルーム＝フロアとして複数フロアを定義（`floors.json`: id, 名前, マップ, 入室可能role）。
- フロア移動UI（エレベーター的なセレクタ or マップ上の階段オブジェクト）。
- フロアごとの入室制限はroleで判定（フェーズ2の基盤を利用）。

### 4-3. アバター着せ替え

- 現状4キャラ固定（Adam/Ash/Lucy/Nancy）。LimeZu（既存アセットの作者）の追加スプライトを導入し、キャラ選択を拡充。着せ替え（服・髪のレイヤー合成）はアセット制作コストが高いため、まずキャラ数追加で対応し、レイヤー合成は別途判断。

### 4-4. ミニマップ

- Phaserの第2カメラでマップ全景を右下に小さく表示。プレイヤー位置をドットで示し、クリックで注視移動（テレポートはしない）。

---

## 進め方チェックリスト（Sonnet 5向け）

- [ ] タスク着手前に対象ファイルの現状コードを必ず読む（この指示書の行番号は変わっている可能性がある）
- [ ] `Message` enumへの追加は末尾のみ
- [ ] サーバー側検証のない権限制限を作らない
- [ ] 各タスクごとに2タブでの同期動作を確認してからコミット（日本語1行メッセージ）
- [ ] スキーマ（`OfficeState.ts` / `IOfficeState.ts`）を変えたら両ファイルを揃える
- [ ] 判断に迷う仕様（UIの見た目・文言など）は既存の流儀に合わせ、大きな設計変更が必要になった場合のみユーザーに確認する
