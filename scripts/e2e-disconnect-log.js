/**
 * 切断履歴がリロードをまたいで残り、再接続後のコンソールに自動再表示されるか検証する。
 *  - 切断時に localStorage へ記録される
 *  - リロード後の読み込み時に「[切断履歴]」がコンソールへ出る（見逃さない）
 *  - window.__disconnectLog() でいつでも再表示できる
 */
const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }
const KEY = 'skyoffice_disconnect_log'

async function joinPublic(p, name) {
  await p.goto('http://localhost:5173')
  await p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await p.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await p.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await p.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  await p.locator('input[type="text"]').first().fill(name)
  await p.getByRole('button', { name: '入室する' }).click()
  await p.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(2000)
}

async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1200, height: 800 } })
  const p = await ctx.newPage()
  // 履歴を消してから始める
  await p.goto('http://localhost:5173')
  await p.evaluate((k) => localStorage.removeItem(k), KEY)

  await joinPublic(p, '切断ログ太郎')

  // 実際の「切断→自動リロード」で消えないことを見る。リロード後の読み込みで出る
  // コンソールを捕まえるため、先にリスナーを付けてから切断を起こす。
  const consoleLines = []
  p.on('console', (m) => consoleLines.push(m.text()))

  log('== 切断を起こす（room.leave）→ 自動でリロードが走る ==')
  // leaveはリロードを誘発してevaluateがナビゲーションで中断するので握りつぶす
  await p.evaluate(() => window.game.scene.keys.game.network.room?.leave()).catch(() => {})
  // 切断→リロード→ロビー再接続まで待つ（履歴はlocalStorageに残っているはず）
  await p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 40000 })
  await wait(1500)

  const stored = await p.evaluate((k) => localStorage.getItem(k), KEY)
  log('   リロードをまたいだ後のlocalStorage履歴: ' + stored)
  const arr = JSON.parse(stored || '[]')
  check(arr.length >= 1, '切断がlocalStorageに記録され、リロードをまたいで残っている', `残っていない: ${stored}`)
  check(arr[0] && typeof arr[0].code === 'number' && typeof arr[0].t === 'number', '記録にcodeと時刻が入っている', `形式が不正: ${stored}`)

  const printed = consoleLines.some((l) => /\[切断履歴\]/.test(l))
  log('   コンソールに「[切断履歴]」が出た: ' + printed)
  check(printed, 'リロード後の読み込みで切断履歴がコンソールへ自動表示された（見逃さない）', 'コンソールに履歴が出ていない')

  log('== window.__disconnectLog() でいつでも再表示できるか ==')
  const hasHelper = await p.evaluate(() => typeof window.__disconnectLog === 'function' && typeof window.__clearDisconnectLog === 'function')
  check(hasHelper, '__disconnectLog / __clearDisconnectLog が使える', 'ヘルパー関数が無い')

  // クリアも効くか
  await p.evaluate(() => window.__clearDisconnectLog())
  const afterClear = await p.evaluate((k) => localStorage.getItem(k), KEY)
  check(!afterClear, '__clearDisconnectLog()で履歴を消せる', `消えていない: ${afterClear}`)

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
