// Render 等での起動エントリ。
// tsc の rootDir 推論により出力が server/lib/server/index.js または
// server/lib/index.js のどちらにもなり得るため、存在する方を起動する。
const fs = require('fs')
const path = require('path')

const candidates = [
  path.join(__dirname, 'server', 'lib', 'server', 'index.js'),
  path.join(__dirname, 'server', 'lib', 'index.js'),
]

const entry = candidates.find((p) => fs.existsSync(p))

if (!entry) {
  console.error('[start] サーバのビルド成果物が見つかりません。確認した場所:')
  candidates.forEach((p) => console.error('  - ' + p))
  console.error('[start] ビルド(npx tsc -p server/tsconfig.server.json)が成功しているか確認してください。')
  process.exit(1)
}

console.log('[start] entry: ' + entry)
require(entry)
