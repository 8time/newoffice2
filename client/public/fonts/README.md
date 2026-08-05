# 伝言板のチョーク風フォント置き場

伝言板ダイアログの「字体：チョーク」で使うフォントをここに置きます。

## 置き方

Chalk JP のフォントファイルを、次のファイル名でこのフォルダに入れてください。

- `ChalkJP.woff2`（推奨。軽くて速い）
- もしくは `ChalkJP.ttf` / `ChalkJP.otf` を woff2 に変換

`.ttf` / `.otf` しか無い場合は、woff2 へ変換すると読み込みが速くなります（変換サイトや `woff2_compress` などで可）。とりあえず動かすだけなら、`index.scss` の `@font-face` に `.ttf` の行も入れてあるので、`ChalkJP.ttf` を置くだけでも表示されます。

## 参照場所

`client/src/index.scss` の `@font-face { font-family: 'Chalk JP'; src: url('/fonts/ChalkJP.woff2') ... }`

## 注意

- このフォントに無い漢字は、ブラウザが自動でゴシック体に代替します（レイアウトは崩れません）。
- 再配布ライセンスを確認のうえ配置してください（ここに置くと全参加者へ配信されます）。
