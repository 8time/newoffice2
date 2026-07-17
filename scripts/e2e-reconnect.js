/**
 * サーバーが再起動したとき、自動で元の部屋へ戻れるか検証する。
 * デプロイのたびにサーバーが再起動し、その都度「接続が切れました」と出て
 * 手動でリロードするのは煩わしいため、復帰を待って自動で入り直す。
 *
 * 使い方: node scripts/e2e-reconnect.js
 * （途中でサーバーを落として再起動するので、開発サーバーが動いている状態で実行すること）
 */
const { chromium } = require('playwright')
const { execSync, spawn } = require('child_process')
const path = require('path')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }
const ROOT = path.join(__dirname, '..')

function killServer() {
  try {
    const out = execSync('netstat -ano | findstr ":2567" | findstr LISTENING', { encoding: 'utf8' })
    const pids = [...new Set(out.trim().split('\n').map((l) => l.trim().split(/\s+/).pop()))]
    pids.forEach((pid) => { try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' }) } catch {} })
    return pids
  } catch { return [] }
}

function startServer() {
  const p = spawn('npm', ['start'], { cwd: ROOT, shell: true, detached: true, stdio: 'ignore' })
  p.unref()
  return p
}

async function serverUp() {
  try {
    const res = await fetch('http://localhost:2567/api/storage-status')
    return res.ok
  } catch { return false }
}

;(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1300, height: 850 } })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => log('   [pageerror] ' + e.message.slice(0, 160)))
  p.on('console', (m) => { if (m.type() === 'error') log('   [console.error] ' + m.text().slice(0, 160)) })

  log('== 入室する ==')
  await p.goto('http://localhost:5173')
  await p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await p.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await p.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await p.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  await p.locator('input[type="text"]').first().fill('再接続テスト')
  await p.getByRole('button', { name: '入室する' }).click()
  await p.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(2500)
  const loggedIn0 = await p.evaluate(() => window.__store.getState().user.loggedIn)
  check(loggedIn0 === true, '入室できた（テストの前提）', '入室できていない')

  log('\n== サーバーを落とす（＝デプロイによる再起動を再現）==')
  killServer()
  await wait(4000)

  const state1 = await p.evaluate(() => window.__store.getState().room.disconnectReason)
  log(`   切断を検知したか: ${JSON.stringify(state1)}`)
  check(state1 === 'lost', '切断を検知した', `検知できていない: ${JSON.stringify(state1)}`)

  const reconnecting = await p.locator('text=再接続しています').count()
  check(reconnecting > 0, '「再接続しています…」と出て自動で待っている', '手動リロードを促す画面のまま')
  const intent = await p.evaluate(() => sessionStorage.getItem('skyoffice_reconnect_intent'))
  log(`   戻る部屋の覚え書き: ${intent}`)
  check(!!intent, '戻る部屋を覚えている', '戻る部屋を覚えていない')
  await p.screenshot({ path: '_e2e_out/reconnect-1-waiting.png' })

  log('\n== サーバーを戻す ==')
  startServer()
  for (let i = 0; i < 40 && !(await serverUp()); i++) await wait(1000)
  log('   サーバー復帰')

  // 自動でリロード→再入室するのを待つ
  await p.waitForFunction(() => window.__store?.getState().user.loggedIn === true, { timeout: 60000 })
    .catch(() => {})
  await wait(2000)
  const dbg = await p.evaluate(() => ({
    lobbyJoined: window.__store.getState().room.lobbyJoined,
    roomJoined: window.__store.getState().room.roomJoined,
    name: localStorage.getItem('skyoffice_playerName'),
    preload: window.game?.scene?.keys?.bootstrap?.preloadComplete,
  }))
  log('   復帰後の状態: ' + JSON.stringify(dbg))
  const loggedIn1 = await p.evaluate(() => window.__store.getState().user.loggedIn)
  const reason1 = await p.evaluate(() => window.__store.getState().room.disconnectReason)
  const intent1 = await p.evaluate(() => sessionStorage.getItem('skyoffice_reconnect_intent'))
  log(`   loggedIn=${loggedIn1} reason=${JSON.stringify(reason1)} 覚え書き=${intent1}`)
  check(loggedIn1 === true, '自動で元の部屋に戻れた（手動操作なし）', '自動で戻れていない')
  check(!intent1, '戻ったあと覚え書きは片付いている', '覚え書きが残っている')
  await p.screenshot({ path: '_e2e_out/reconnect-2-back.png' })

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
