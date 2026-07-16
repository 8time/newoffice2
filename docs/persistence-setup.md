# データを消えないようにする設定（Supabase・無料枠）

## なぜ必要か

Renderの無料枠はディスクが**再起動・スピンダウンで初期化**される。無操作が15分ほど続くと
サービスが停止し、次に起動したときファイルは全部ビルド時の状態に戻る。そのため以下が消えていた。

- 会議室のホワイトボード・議事録・タブ構成
- ホワイトボードやチャットに貼った画像の実体（`server/uploads/`）
- チャット履歴・DM履歴・看板・マップビルダーの設置物・勤怠

さらに画像だけが消えると、クライアント側に図形だけが残るため
**「ダミー画像のまま直らない」**状態になっていた。

保存先をサーバーの外（Supabase）に置くことで、再起動しても消えなくなる。

## セットアップ手順（10分ほど・無料）

### 1. Supabaseのプロジェクトを作る

1. https://supabase.com/ でサインアップ（無料）
2. 「New project」でプロジェクトを作成。リージョンは `Northeast Asia (Tokyo)` が近い
3. データベースのパスワードは控えておく（この後は使わない）

### 2. 保存用のテーブルを作る

左メニューの「SQL Editor」で以下を実行する。

```sql
create table if not exists kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
```

### 3. 画像用のバケットを作る

1. 左メニュー「Storage」→「New bucket」
2. 名前は **`uploads`**（変える場合は環境変数 `SUPABASE_BUCKET` も設定する）
3. Publicにする必要はない（サーバー経由で配信するため非公開のままでよい）

### 4. 接続情報を控える

左メニュー「Project Settings」→「API」から2つコピーする。

| 項目 | 環境変数 |
|---|---|
| Project URL | `SUPABASE_URL` |
| `service_role` の secret キー | `SUPABASE_SERVICE_ROLE_KEY` |

> `service_role` キーは全権限を持つ。**サーバー専用**で、クライアントには絶対に置かないこと。
> このリポジトリでは `server/storage.ts` だけが読む。

### 5. Renderに設定する

Renderのダッシュボード → 対象サービス → 「Environment」で2つ追加する。

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

保存すると自動で再デプロイされる。

### 6. 動いているか確認する

デプロイ後のログに次が出ていれば成功。

```
[Storage] Supabaseに保存します（永続化あり）
[Storage] Supabaseから<件数>件読み込みました
```

次のように出ている場合は環境変数が読めていない。

```
[Storage] ローカルファイルに保存します（SUPABASE_URL未設定。Renderでは再起動で消えます）
```

## 仕組み

`server/storage.ts` が保存先を抽象化している。

- `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` があれば **Supabase**
- 無ければ **ローカルファイル**（開発時は従来どおり `meeting-whiteboards.json` などに書く）

JSONは起動時に `hydrate()` でまとめてメモリへ読み込み、以後は同期的に読む。
書き込みは500msでまとめて非同期に流す（描画のたびにネットワークへ書かないため）。
画像の実体はSupabase Storageの `uploads` バケットへ、名前やMIMEなどの索引はJSONとして保存する。

## 補足

- Supabaseの無料プロジェクトは**1週間ほど無操作だと一時停止**する。停止してもデータは消えず、
  ダッシュボードから再開できる。毎日使うなら止まらない。
- 無料枠はDB 500MB・ストレージ1GB。画像が増えてきたら古いものを消す運用を足す。
- 既にダミー画像になってしまったホワイトボードは、画像の実体が既に失われているため
  この設定では復活しない。その要素を消して貼り直す必要がある。
