/**
 * ページ内の切断履歴パネルの検証。
 *  - 左端に「接続ログ」タブが常に出る（ログイン前でも）
 *  - タブを押すとパネルが開き、記録した切断が表示される
 *  - window.showDisconnectLog() でも開ける
 *  - 「消去」で履歴を消せる
 */
const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }
const KEY = 'skyoffice_disconnect_log'

async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1200, height: 800 } })
  const p = await ctx.newPage()

  // 事前に履歴を仕込む（Colyseus 1006 と PeerJS -1 の2件）
  await p.goto('http://localhost:5173')
  await p.evaluate((k) => {
    const now = Date.now()
    localStorage.setItem(k, JSON.stringify([
      { t: now - 120000, code: 1006, reason: '異常終了・closeフレーム無し＝経路が無言で切断' },
      { t: now - 5000, code: -1, reason: 'PeerJS署名サーバー切断（通話の仲介）— 自動で繋ぎ直します' },
    ]))
  }, KEY)
  await p.reload()
  await p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await wait(800)

  log('== ログイン前でも「接続ログ」タブが出るか ==')
  const tab = p.getByRole('button', { name: /接続ログ/ })
  check(await tab.isVisible().catch(() => false), 'ログイン前から「接続ログ」タブが表示される', 'タブが出ていない')
  // 件数バッジ
  const badge = await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((el) => /接続ログ/.test(el.textContent || ''))
    return b ? b.textContent : ''
  })
  check(/2/.test(badge), 'タブに件数(2)が出る', `件数が出ていない: ${badge}`)

  log('== タブを押すとパネルが開き、履歴が表示されるか ==')
  await tab.click()
  await wait(500)
  check(await p.getByText('接続の切断履歴（2件）').isVisible().catch(() => false), 'パネルが開いて件数が出る', 'パネルが開かない')
  check(await p.getByText('経路が無言で切断').first().isVisible().catch(() => false), 'Colyseus切断(1006)が表示される', '1006が出ていない')
  check(await p.getByText('通話(PeerJS)').first().isVisible().catch(() => false), 'PeerJS切断(-1)が表示される', 'PeerJS行が出ていない')
  check(await p.getByText(/前回の切断から/).first().isVisible().catch(() => false), '前回からの間隔が出る', '間隔が出ていない')
  await p.screenshot({ path: '_e2e_out/disconnect-panel.png' })

  // 閉じる
  await p.getByRole('button', { name: '閉じる' }).click()
  await wait(300)

  log('== window.showDisconnectLog() でも開くか ==')
  await p.evaluate(() => window.showDisconnectLog())
  await wait(500)
  check(await p.getByText('接続の切断履歴（2件）').isVisible().catch(() => false), 'window.showDisconnectLog()でパネルが開く', '関数で開かない')

  log('== 「消去」で履歴を消せるか ==')
  await p.getByRole('button', { name: '消去' }).click()
  await wait(400)
  const after = await p.evaluate((k) => localStorage.getItem(k), KEY)
  check(!after || after === '[]', '消去でlocalStorageの履歴が消える', `消えていない: ${after}`)
  check(await p.getByText('まだ切断は記録されていません').isVisible().catch(() => false), '消去後は「記録なし」表示になる', '空表示にならない')

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
