# 実装指示書：フェーズ1.5（実使用で出た不具合11件の修正）

対象実装者: Claude Sonnet 5（AIエージェント）
作成日: 2026-07-15
前提: `docs/implementation-plan.md` のフェーズ1（会議室まわり）は実装済み。本書はその後の**実使用テストで出た不具合・要望**を潰すもので、**フェーズ2より先に着手する**。

## 0. 進め方（重要）

### 検証方法についての注意

前回のフェーズ1では、この環境にブラウザ自動化（chromium-cli / Playwright）が入っておらず、
**サーバーに実クライアント（colyseus.js）で複数接続するプロトコルレベル検証**しかできなかった。
その結果、**サーバー同期は正しいのにブラウザ上の見た目・操作で壊れている**バグが今回大量に出た（本書の対象）。

したがって本フェーズでは:

1. **サーバー側のロジック**は従来どおりプロトコル検証スクリプト（`_verify_*.ts` を一時作成 → 実行 → 削除）で確認してよい。
2. **ブラウザ上の挙動（DOM・React・Phaser・WebRTC・Excalidraw）に関わる項目は、プロトコル検証では絶対に確認できない。**
   これらは実装後に**「ユーザーに実ブラウザで確認してもらう」**前提で進め、報告時に
   「未検証。ブラウザでの確認をお願いします」と**正直に明記する**こと。動作確認できていないものを
   「動きます」と報告してはならない。
3. 可能なら `npx playwright install chromium` を試み、成功すれば2タブでの実ブラウザ検証を行う（推奨）。
   失敗・重すぎる場合は無理に粘らず 2. の方針でよい。

### 作業単位

- 修正は**1項目1コミット**（日本語1行メッセージ + 必要なら本文）。
- 着手前に必ず対象ファイルの現状コードを読む（本書の行番号は変わっている可能性がある）。
- `Message` enum への追加は**末尾のみ**。
- スキーマを変えたら `types/IOfficeState.ts` と `server/rooms/schema/OfficeState.ts` の両方を揃える。

### 優先度

**A（すぐ直す・使用不能レベル）**: 1-1 退社時フリーズ / 1-2 右クリック / 1-3 ホワイトボードの図が戻る・画像消える / 1-4 タブ切替が共有されない / 1-5 会議室の画面共有
**B（機能追加・利便性）**: 1-6 PDF / 1-7 ルーム再入室 / 1-8 カメラOFF既定
**C（あると嬉しい）**: 1-9 YouTubeプレビュー / 1-10 スタンプ

---

## A. 使用不能レベルの不具合

### 1-1. 退社しようとすると動けなくなる（ブラウザを閉じるしかない）【最優先】

**症状**: 出口ゾーンに入ると「退社しますか？」が出る。キャンセルするとキャラクターが動かせなくなり、ブラウザを閉じるしかない。

**原因**（`client/src/scenes/Game.ts` の `handleExitZone()`、1043行目付近）:

```ts
private handleExitZone() {
  if (this.hasAskedExit) return
  this.hasAskedExit = true
  this.myPlayer.body.setVelocity(0, 0)
  setTimeout(() => {
    if (window.confirm('退社しますか？')) { window.location.reload() }
    else { setTimeout(() => { this.hasAskedExit = false }, 10000) }
  }, 50)
}
```

問題は2つある。

1. **`window.confirm()` はJSのメインスレッドを完全にブロックする。** モーダルが開いた瞬間にPhaserのキャンバスはフォーカスを失い、
   その時点で押していた矢印キーの **`keyup` イベントが Phaser に届かない**。結果、Phaser の Key オブジェクトは
   `isDown === true` のまま固着し、閉じた後もキー状態が壊れて操作不能になる。これが「動けない」の直接原因。
2. **キャンセル後10秒で `hasAskedExit` が false に戻る。** 出口ゾーンに立ったままだと10秒ごとに confirm が再表示され、
   モーダル地獄になる。

**実装内容**:

1. **`window.confirm` の使用をやめ、Reactの自前ダイアログに置き換える。**
   - 新規コンポーネント `client/src/components/ExitConfirmDialog.tsx`（MUIの `Dialog` を使う。既存の `SignboardDeleteConfirm.tsx` の流儀に合わせる）。
   - 新規ストア or 既存ストアに `exitDialogOpen: boolean` を持たせ、`Game.ts` からは `store.dispatch(openExitDialog())` するだけにする。
   - ダイアログの「退社する」→ `window.location.reload()`、「キャンセル」→ 閉じるだけ。
2. **ダイアログを開いている間は `this.disableKeys()`、閉じたら `this.enableKeys()`**（既存メソッドがある）。
   さらに閉じる直前に **Phaserのキー状態をリセット**する。`this.input.keyboard.resetKeys()` を呼ぶこと
   （固着キー対策。`enableKeys()` の中に入れてしまってよい）。
3. **再表示ループの防止**: `hasAskedExit` の10秒タイマーによるリセットをやめ、
   **「出口ゾーンから一度出たらフラグをリセットする」**方式に変える。
   `this.physics.add.overlap` は重なっている間ずっと発火するので、`update()` 内で
   「今フレーム出口ゾーンと重なっているか」を判定し、**重なっていない → `hasAskedExit = false`** とする。
   （Phaserの `Phaser.Geom.Rectangle.Overlaps` か、overlapコールバックで毎フレーム立てるフラグを使う）
4. キャンセル後は出口ゾーンから離れるまで二度と聞かない、という挙動にする。

**受け入れ条件**: 出口ゾーンに入る → ダイアログが出る → キャンセル → **その場で普通に歩ける**。出口ゾーンから離れて再度入ると、また聞かれる。出口ゾーンに立ちっぱなしでも再表示されない。

---

### 1-2. チャット欄で右クリックが使えない（ペーストできない）

**原因**: `client/src/scenes/Game.ts` 140行目の

```ts
this.input.mouse?.disableContextMenu()
```

Phaser 3 の `MouseManager.disableContextMenu()` は実装が

```js
disableContextMenu: function () {
  document.body.addEventListener('contextmenu', function (event) { event.preventDefault(); return false })
  return this
}
```

となっており、**`document.body` 全体**に `preventDefault` を張る。ゲームキャンバスだけでなく、
その上に重なっているReactのチャット入力欄・サイドバー・ダイアログを含む**ページ全体で右クリックメニューが死ぬ**。

なお、この呼び出しはマップビルダーで「右クリックで設置物を削除」するために追加されたものなので、
**キャンバス上での右クリックメニュー抑止は残す必要がある**。

**実装内容**:

1. `this.input.mouse?.disableContextMenu()` の呼び出しを**削除**する。
2. 代わりに**Phaserのキャンバス要素にだけ** contextmenu の preventDefault を張る:
   ```ts
   this.game.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
   ```
   （`create()` 内。シーン再起動で二重登録されないよう、`shutdown`/`destroy` で `removeEventListener` するか、
   一度だけ登録するガードを入れる）
3. マップビルダーの右クリック削除が従来どおり動くことを確認する。

**受け入れ条件**: チャット入力欄で右クリック → ブラウザのコンテキストメニュー（貼り付け等）が出る。マップ上で右クリック → メニューは出ず、ビルダーの削除は従来どおり動く。

---

### 1-3. ホワイトボードで図を動かすと元の位置に戻る／画像が遅れて出て消える【最優先】

**症状**: 図形をドラッグしても元の位置にスナップバックする。画像を挿入すると大きなタイムラグの後に表示され、その後消える。

**原因**（`client/src/components/CollaborativeWhiteboard.tsx`）: フェーズ1-2で入れた同期実装に構造的な欠陥がある。

1. **エコーループ（これが「元に戻る」の主因）**
   リモート更新の受信ハンドラで `apiRef.current.updateScene(...)` を呼んでいるが、
   `updateScene` は **Excalidraw の `onChange` を再発火させる**。それを `applyingRemote` フラグで抑止しているつもりだが、
   解除を `window.requestAnimationFrame()` で行っている:
   ```ts
   window.requestAnimationFrame(() => { applyingRemote.current = false })
   ```
   Excalidraw の `onChange` は内部で throttle されており、**rAF より後に発火することがある**。
   その場合フラグは既に false に戻っているため、**受け取ったばかりのシーンを自分の変更として送り返してしまう**。
   互いにこれをやると、古いバージョンの要素が相手に押し戻され、ドラッグ中の図形が前の座標に巻き戻る。

2. **`updateScene` に `captureUpdate` を指定していない**
   Excalidraw 0.18 の `updateScene` は `captureUpdate?: CaptureUpdateActionType` を受け取る
   （`client/node_modules/@excalidraw/excalidraw/dist/types/excalidraw/types.d.ts:468`。
   `CaptureUpdateAction` は本体から export 済み）。
   指定しないとリモート由来の変更が**自分の undo 履歴に積まれ**、さらに onChange 再発火の一因になる。
   リモート適用時は **`CaptureUpdateAction.NEVER`** を指定しなければならない。

3. **画像（files）が消えるのも同じエコーが原因**
   自分が挿入した画像は `sentFileIds` に記録され二度と送られない。ところがエコーで
   「画像を持っていない側のシーン」が押し戻されると、画像要素が古いバージョンで上書きされたり、
   fileId は残っているのに実体が来ない状態になり、表示された画像が消える。
   タイムラグは 160ms デバウンス + 巨大な base64 を丸ごとWebSocketで送っていることによる。

**実装内容**:

1. **`captureUpdate` を必ず指定する**。リモート適用は履歴に積まない:
   ```ts
   import { Excalidraw, reconcileElements, CaptureUpdateAction } from '@excalidraw/excalidraw'
   ...
   apiRef.current.updateScene({
     elements: reconciled,
     appState: payload.appState || {},
     captureUpdate: CaptureUpdateAction.NEVER,
   })
   ```
2. **`applyingRemote` の rAF 解除をやめる**。フラグ方式そのものが競合するので、
   **「受信した要素のバージョンを覚えておき、自分の送信内容と一致するなら送らない」**方式に変える:
   - `lastBroadcastedOrReceived = new Map<elementId, version>()` を持つ。
   - リモート受信時: 適用した各要素の `id → version` をこのMapに記録する。
   - `handleChange` 時: 全要素について「Mapに記録されたversionと同じか」を調べ、
     **1つも変化がなければ送信しない（＝エコーしない）**。
   - 送信した場合は、送った要素の `id → version` を同じMapに記録する。
   - これはExcalidraw公式コラボ（excalidraw-app の `Collab.tsx`）と同じ考え方で、フラグより確実。
3. **ドラッグ中の中間状態を送らない／送りすぎない**
   `onChange` は `appState.draggingElement` / `newElement` など編集中の状態を持つ。
   デバウンスは維持しつつ（160ms でよい）、上記2のバージョン比較により無駄な送信が消えるので、
   ドラッグ中も滑らかに同期される。
4. **画像はWebSocketで送らない（タイムラグの根治）**
   `1-6` の「ファイルのサーバーアップロード化」と**同じ仕組みを流用**する。
   Excalidraw の画像も `POST /api/files` にアップロードし、`dataURL` の代わりに
   **`https://<server>/files/<id>` のURL**を `files[fileId].dataURL` に入れて同期する。
   （Excalidraw の BinaryFileData は `dataURL` に通常のURLを入れても表示できる）
   これによりWebSocketに数MBのbase64が乗らなくなり、ラグが消える。
   - **1-6 を先に実装してから本項目のこの部分に着手すること。**
   - サーバー側の `meetingWhiteboardSnapshots` に保存するのもURLだけになり、`meeting-whiteboards.json` が肥大しなくなる。

**受け入れ条件**: (a) 2タブで図形をドラッグしても巻き戻らない。(b) 同時に別々の図形を描いても互いに消えない。(c) 画像を挿入すると1秒以内に相手にも出て、**消えない**。(d) リモートの変更が自分の Ctrl+Z（元に戻す）に混ざらない。

---

### 1-4. 会議室のホワイトボードで「議題2」タブに切り替えても相手の画面が変わらない

**原因**: フェーズ1-1でタブの**一覧（追加・名前・削除）**はサーバー同期したが、
**「今どのタブを見ているか」（`activeTabId`）は各クライアントのローカルstateのまま**。
（`MeetingRoomOverlay.tsx` の `WhiteboardWithDoc` 内 `const [activeTabId, setActiveTabId] = useState(...)`）

そのため A が議題2タブに切り替えて描いても、B は議題1を表示したままで、B の画面上は何も変わらない。
（実際には議題2のボードには描かれているが、B には見えない）

**設計判断**: 会議室のホワイトボードは「全員で同じ板を見る」のが自然なので、
**アクティブタブもサーバー同期して全員が追従する**方式にする。

**実装内容**:

1. `types/Messages.ts` 末尾に `MEETING_ACTIVE_TAB_SYNC` と `REQUEST_MEETING_ACTIVE_TAB` を追加。
2. サーバー（`SkyOffice.ts`）: `meetingActiveTabs = new Map<string, string>()`（会議室ID → タブID）を持ち、
   既存の `broadcastToMeetingRoom` でその会議室の参加者にだけ配信する。永続化は不要（メモリのみでよい）。
3. クライアント（`MeetingRoomOverlay.tsx`）:
   - タブをクリックしたら `setActiveTabId` に加えてサーバーへ送信。
   - リモートで `MEETING_ACTIVE_TAB_SYNC` を受けたら `setActiveTabId` を更新する。
   - 入室時に `REQUEST_MEETING_ACTIVE_TAB` を送り、現在みんなが見ているタブに合わせる。
4. **UI**: タブが他の人の操作で切り替わったことが分かるよう、タブバーに小さく
   「◯◯さんが議題2に切り替えました」を2〜3秒だけ表示する（唐突に画面が変わる違和感を防ぐ）。

**受け入れ条件**: A が議題2タブを押すと、B の画面も議題2に切り替わり、A の描画が見える。

---

### 1-5. 会議室のホワイトボード画面で画面共有が相手に届かない

**原因**（`client/src/web/WebRTC.ts` の `startScreenShare()` / `stopScreenShare()`、446行目付近）:

```ts
async startScreenShare() {
  ...
  this.peers.forEach(({ call }) => {          // ← this.peers だけ
    const sender = call.peerConnection.getSenders().find(s => s.track?.kind === 'video')
    if (sender) sender.replaceTrack(screenTrack)
  })
  ...
}
```

このクラスはピア接続を**2つのMapに分けて**持っている:

- `this.peers` … **自分から発信した（call した）**相手
- `this.onCalledPeers` … **相手から着信した（answer した）**相手

画面共有のトラック差し替えが **`this.peers` にしか適用されていない**。
つまり「相手が先に自分を呼んだ」場合、その相手には画面共有が一切届かない。
2人で使うと片方向は成功し逆方向は失敗する（＝「使えない」と感じる）。`stopScreenShare()` も同じ欠陥。

**実装内容**:

1. `startScreenShare()` / `stopScreenShare()` の両方で、**`this.peers` と `this.onCalledPeers` の両方**に対して
   `replaceTrack` を実行する。共通処理を `private replaceVideoTrackForAllPeers(track: MediaStreamTrack)` に切り出すとよい。
2. **カメラが未取得（`myStream` が無い）状態でも画面共有できるようにする。**
   現状 `stopScreenShare()` は `if (!this.isSharingScreen || !this.myStream) return` で早期returnする。
   1-8 でカメラOFF既定にするため、`myStream` はある（トラックがdisabledなだけ）が、
   カメラ未許可のケースも考慮し `myStream` が無ければ senders に対して `replaceTrack(null)` するようにしておく。
3. **会議室での見え方**: 現状は画面共有トラックがカメラ列の小さいタイルに差し替わるだけで、
   共有された画面が小さすぎて実用にならない。**誰かが画面共有中は、ホワイトボード領域（左側の大きい面）に
   共有画面を大きく表示する**よう `MeetingRoomOverlay.tsx` を変更する。
   - 誰が共有中かを知る必要があるので、Player スキーマに **`isScreenSharing: boolean`** を追加し、
     `Message.UPDATE_MEDIA_STATUS` と同様にサーバー同期する（`types/IOfficeState.ts` と `OfficeState.ts` の両方）。
   - 共有中は左側に「◯◯さんが画面を共有中」＋大きなvideo要素、ホワイトボードはその裏に隠す
     （タブで「ホワイトボード / 共有画面」を切り替えられるようにするのが親切）。

**受け入れ条件**: A→B、B→A のどちらの向きでも画面共有が届く。会議室では共有画面が大きく表示される。共有停止でカメラ映像に戻る。

---

## B. 機能追加・利便性

### 1-6. チャットのPDFが別タブで開かない（26MBのPDF）

**原因は2つある**（`client/src/components/Chat.tsx`）。

1. **サイズ上限に引っかかっている**
   ```ts
   const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB
   ```
   26MBのPDFは送信時点で `alert()` が出て**送信されていない**。
2. **仮に送れても、data URL は別タブで開けない**
   ファイルは base64 の **data URL** としてやり取りされ、プレビューは
   ```tsx
   <a href={file.url} target="_blank">PDFを開く（別タブ）</a>
   ```
   としている。しかし **Chrome/Edge は `data:` URL へのトップレベル遷移をセキュリティ上ブロックする**
   （2017年以降の仕様）。したがって**サイズに関係なく、この方式では永久に別タブで開けない**。

**実装内容**（`docs/implementation-plan.md` のフェーズ3-1を前倒しで実施する）:

1. **サーバーにファイルアップロードAPIを作る**（`server/index.ts`、Express）:
   - `POST /api/files` … `multer` を追加依存として使用。保存先 `server/uploads/`。上限は **50MB** に引き上げる。
   - `GET /files/:id` … 保存したファイルを返す。**`Content-Disposition: inline`** ＋ 正しい `Content-Type`
     （PDFなら `application/pdf`）で返すこと。inline にしないとブラウザ内蔵PDFビューアが開かず必ずダウンロードになる。
   - HTMLやSVGをinlineで返すとXSSになるため、**`text/html` と `image/svg+xml` は `attachment` で返す**。
   - メタ情報（元のファイル名・MIME・サイズ）を `uploads/index.json` に保存し、`GET /files/:id` で復元する。
2. **クライアント**: `Chat.tsx` の `readAndSendFile` を、base64化ではなく
   `fetch('/api/files', { method: 'POST', body: formData })` でアップロードし、
   返ってきた **URL を `FileAttachment.url` に入れて送信**するよう変更する。
   - WebSocketにはURL（数十バイト）しか流れなくなるため、大容量ファイルでも詰まらない。
   - `MAX_FILE_SIZE` は 50MB に引き上げる。
   - 既存の base64 data URL を受信して表示するコードは**後方互換のため残す**（過去メッセージが壊れないように）。
3. **PDFのプレビューを改善**: 別タブリンクだけでなく、チャット内に `<iframe src={url} />` で
   1ページ目のプレビューを出す（高さ200px程度）。クリックで別タブ。
4. 開発時、Viteのdevサーバー（:5173）からColyseus（:2567）へのAPIアクセスはCORSかViteのproxy設定が必要。
   既存の `Network.ts` がサーバーURLをどう解決しているか（`import.meta.env.VITE_SERVER_URL`）に合わせ、
   **同じ方法でAPIのベースURLを決める共通関数**を作ること。

**受け入れ条件**: 26MBのPDFを送信でき、受信側で「PDFを開く」を押すと**別タブでPDFが表示される**（ダウンロードではなく）。画像・動画も従来どおり表示される。

---

### 1-7. いつものルームにURL一発で入りたい（毎回ルーム作成が面倒）

**要望**: ルームのURLをブックマークしておけば、それを踏むだけでいつものメンバーがいるルームに即入室できるようにしたい。

**現状**（`client/src/components/RoomSelectionDialog.tsx`）: 毎回「公開ルームに入る / カスタムルームを作る・探す」を手動で選んでいる。URLにルーム情報は乗っていない。

**実装内容**:

1. **URLクエリでのルーム指定**: `http://localhost:5173/?room=<roomId>` の形式に対応する。
   - `client/src/App.tsx`（または `RoomSelectionDialog.tsx`）の初期化時に `new URLSearchParams(window.location.search).get('room')` を読む。
   - `room` があり、かつ `lobbyJoined` になったら **自動で `joinCustomById(roomId, password)` を呼ぶ**。
   - パスワード付きルームの場合はパスワード入力だけを求めるダイアログを出す。
   - 参加に失敗した場合（ルームが消えている等）はエラーを出して通常のルーム選択画面に戻す。
2. **ルームURLのコピー機能**: `HelperButtonGroup.tsx` の「ルーム情報」ダイアログに
   **「このルームのURLをコピー」ボタン**を追加する（現状「共有リンクは近日公開予定です 😄」というプレースホルダのままになっている）。
   `${window.location.origin}/?room=${roomId}` を `navigator.clipboard.writeText()` でコピーし、
   「コピーしました」のトーストを出す。
3. **前回のルームを記憶して自動再入室**: `localStorage` に
   `{ roomId, roomName, password?, playerName, avatarName }` を保存する。
   - ルーム選択画面に **「前回のルーム（◯◯）に入る」ボタン**を最上部に出す。
   - `?room=` が付いている場合はそちらを優先。
   - **パスワードをlocalStorageに平文で保存するかはユーザーに確認すること**（利便性とのトレードオフ）。
     デフォルトでは保存せず、パスワード付きルームでは毎回入力とする。
4. **名前とアバターも記憶する**: 現状 `LoginDialog.tsx` で毎回名前とアバターを選んでいる。
   前回の名前・アバターを localStorage から復元し、初期値として入れておく（変更は可能なままにする）。

**受け入れ条件**: ルームを作る → URLをコピー → 別ブラウザでそのURLを開く → 名前入力だけで同じルームに入れる。次回そのURLを踏めば同じルームに直行できる。

---

### 1-8. 入室時のデフォルトを「カメラOFF・マイクON・アバター表示」にしたい

**現状**（`client/src/web/WebRTC.ts`）:
```ts
getUserMedia(alertOnError = true) {
  navigator.mediaDevices?.getUserMedia({ video: true, audio: true })
    .then((stream) => { this.setMediaStream(stream) })
  ...
}
isAudioMuted = false
isVideoOff = false   // ← カメラONで始まる
```
カメラが最初からONなので毎回手動でOFFにしている。

**注意**: `handleProximityLeave()` が「近くに誰もいない → `setMuted(true)`」を実行するため、
**マイクは近接制御で自動的にON/OFFされる**。この既存の近接マイク制御を壊さないこと。

**実装内容**:

1. `setMediaStream(stream)` の中で、**取得直後にビデオトラックを無効化**する:
   ```ts
   this.isVideoOff = true
   const videoTrack = stream.getVideoTracks()[0]
   if (videoTrack) videoTrack.enabled = false
   this.applyVideoFallback(this.myVideo, true)   // アバター表示に切り替え
   this.network.updateMediaStatus(this.isVideoOff, this.isAudioMuted)
   ```
   - **`getUserMedia` の video 自体は取得したままにする**（`video: false` にすると後からカメラONにできなくなる）。
   - トラックを `enabled = false` にするだけなので、カメラのランプは点くがプライバシー上の映像送信はされない。
     ランプも消したいなら `videoTrack.stop()` + ON時に再取得が必要だが、複雑になるので**まずは `enabled = false` で実装**し、
     ユーザーが「ランプが点くのが気になる」と言った場合のみ再取得方式を検討する。
2. **マイクはON（ミュート解除）で開始**する。ただし上記の近接マイク制御があるため、
   「近くに誰もいなければ自動でミュート、近づいたら自動で解除」という既存挙動は維持する。
3. **左上のアバター表示**: カメラOFF時にアバター画像が出る仕組み（`applyVideoFallback` / `AvatarFallback`）は既にあるので、
   初期状態から**それが表示される**ことを確認する（`VideoOverlay.tsx` と `MeetingRoomOverlay.tsx` の両方）。
4. **設定を記憶する**: 1-7 の localStorage に `preferCameraOff: boolean`（既定 true）も保存し、
   ユーザーが自分でカメラONにした場合は次回もONで始まるようにする（任意。実装するなら簡潔に）。

**受け入れ条件**: ルームに入るとカメラはOFF・自分の枠にはアバターが表示され、マイクは（近くに人がいれば）ONになっている。カメラボタンを押せば従来どおりONにできる。

---

## C. あると嬉しい機能

### 1-9. チャットにYouTubeリンクを貼ると動画プレビューが出るようにしたい

**現状**（`client/src/components/Chat.tsx` の `Message` コンポーネント）:
```tsx
<Bubble isMine={isMine}>
  {messageType === MessageType.FILE_MESSAGE && file ? <FilePreview .../> : chatMessage.content}
</Bubble>
```
本文は**ただのテキストとして描画**され、URLはリンクにすらならない。

**実装内容**:

1. `client/src/components/ChatMessageContent.tsx`（新規）を作り、本文テキストを解析して描画する:
   - URLを検出して `<a href target="_blank" rel="noopener noreferrer">` にする（YouTube以外のURLも対象）。
   - **URLの描画には必ずReactの要素として出力すること。`dangerouslySetInnerHTML` は使わない**（XSS防止）。
2. **YouTube URLの検出**: 以下の形式に対応する。
   - `https://www.youtube.com/watch?v=<ID>`
   - `https://youtu.be/<ID>`
   - `https://www.youtube.com/shorts/<ID>`
   - `https://www.youtube.com/embed/<ID>`
   - `?t=123` / `&start=123` の開始位置指定があれば埋め込みにも引き継ぐ。
   - 動画IDは `[A-Za-z0-9_-]{11}` で厳密に検証する（不正な文字列をURLに埋め込まないこと）。
3. **プレビュー描画**: 吹き出しの下に `<iframe>` で YouTube 埋め込みを出す。
   - `src` は **`https://www.youtube-nocookie.com/embed/<ID>`**（プライバシー強化ドメイン）を使う。
   - サイズは幅240px前後（チャット幅に収まるよう `FilePreviewWrapper` と同程度）。`allowfullscreen` を付ける。
   - 1メッセージに複数URLがあっても、**埋め込みは最初の1件だけ**にする（吹き出しが縦に伸びすぎるのを防ぐ）。
4. 既存の吹き出しレイアウト（`Bubble` の最大幅）を崩さないこと。

**受け入れ条件**: チャットにYouTubeのURLを貼ると、リンクと一緒に再生可能なプレイヤーが吹き出し内に出る。他のURLはクリック可能なリンクになる。

---

### 1-10. チャットにLINEのようなスタンプ機能がほしい

**現状**: 絵文字ピッカー（emoji-mart）はあるが、これは**テキストに絵文字を挿入する**だけ。大きな画像スタンプは送れない。
（なお頭上に出る `EmotePanel`（エモート）は別機能。混同しないこと）

**実装内容**:

1. **スタンプ画像の用意**
   - `client/public/assets/stamps/` に PNG（推奨 240x240px、透過）を置く。
   - **著作権に注意**: LINEのスタンプ画像等を流用してはならない。
     フリー素材（CC0 / パブリックドメイン）か、**絵文字を大きく描画したもの**を使う。
     まずは **絵文字ベースの簡易スタンプ**（👍 😂 🎉 🙏 😢 💪 ✅ ❓ 等を大きく表示するだけ）で実装し、
     画像スタンプを使いたいかは**ユーザーに確認する**こと。
   - スタンプ定義は `client/src/components/stamps.ts` に `{ id, label, emoji | imageUrl }[]` の配列で持つ。
2. **メッセージ種別の追加**
   - `client/src/stores/ChatStore.ts` の `MessageType` に **`STAMP_MESSAGE`** を追加する。
   - `types/Messages.ts` 末尾に `SEND_STAMP` を追加。
   - サーバー（`SkyOffice.ts`）は既存の `SEND_FILE_MESSAGE` と同じ流儀で、
     **`stampId` だけ**を全員にブロードキャストする（画像そのものは送らない。クライアントが同じアセットを持っている）。
     `stampId` は**サーバー側で既知のIDリストと照合して検証する**（任意の文字列を通さない）。
3. **UI**
   - チャット入力欄の絵文字ボタンの隣に**スタンプボタン**を追加。
   - 押すとスタンプ一覧のパネルが開き、クリックで即送信（テキスト入力は不要）。
   - 受信側では吹き出しの**背景・枠なし**で大きく表示する（LINEのスタンプと同じ見た目）。
     `Bubble` をそのまま使うと吹き出しの中に入ってしまうので、`STAMP_MESSAGE` のときは
     吹き出しをスキップして画像／絵文字だけを描画する分岐を入れる。
4. 既読表示・時刻表示は通常メッセージと同様に出す。

**受け入れ条件**: スタンプボタンから選んで送ると、双方の画面に吹き出しなしの大きなスタンプが表示される。

---

## 参考：この後のフェーズ2以降

本フェーズ完了後は `docs/implementation-plan.md` のフェーズ2（アカウント・権限管理）に進む。
ただし **1-6 でファイルアップロードAPI（元フェーズ3-1）を前倒し実装する**ため、
フェーズ3に着手する際は3-1が済んでいることを前提にしてよい。

## チェックリスト

- [ ] 対象ファイルの現状コードを読んでから着手した
- [ ] `Message` enum への追加は末尾のみ
- [ ] スキーマ変更時は `types/IOfficeState.ts` と `server/rooms/schema/OfficeState.ts` を両方揃えた
- [ ] サーバー側で受信データを検証している（stampId、ファイルのMIME等）
- [ ] `dangerouslySetInnerHTML` を使っていない（1-9）
- [ ] 1項目1コミット（日本語メッセージ）
- [ ] **ブラウザでしか確認できない項目は「未検証」と正直に報告した**
