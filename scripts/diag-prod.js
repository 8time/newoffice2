/**
 * 本番(Cloudflare Pages)を実際に開いて、何が起きているか観測する。
 * - WebSocketの接続先URL（＝環境変数が効いているか）
 * - 失敗したリクエスト
 * - コンソール
 * - ストアの状態（lobbyJoined/roomJoined/preload）
 */
const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
const URL = process.argv[2] || 'https://newoffice2.pages.dev'

async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1200, height: 800 } })
  const p = await ctx.newPage()

  const wsUrls = []
  p.on('websocket', (ws) => { wsUrls.push(ws.url()); ws.on('close', () => log('   [ws closed] ' + ws.url())) })
  p.on('requestfailed', (r) => log('   [req失敗] ' + r.url().slice(0, 90) + ' — ' + (r.failure()?.errorText || '')))
  p.on('console', (m) => { const t = m.text(); if (/切断|error|Error|failed|Failed|wss|colyseus|peer|undefined/i.test(t)) log('   [console] ' + t.slice(0, 140)) })
  p.on('pageerror', (e) => log('   [pageerror] ' + e.message.slice(0, 140)))

  log('== ' + URL + ' を開く ==')
  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })

  // 段階的に状態を観測
  for (let i = 0; i < 8; i++) {
    await wait(2500)
    const st = await p.evaluate(() => {
      const s = window.__store?.getState?.()
      return {
        lobbyJoined: s?.room?.lobbyJoined,
        roomJoined: s?.room?.roomJoined,
        loggedIn: s?.user?.loggedIn,
        disconnectReason: s?.room?.disconnectReason,
        preload: window.game?.scene?.keys?.bootstrap?.preloadComplete,
      }
    }).catch((e) => ({ err: String(e) }))
    log(`   t+${(i + 1) * 2.5}s ` + JSON.stringify(st))
  }

  log('\n== WebSocket接続先(実際に叩いたURL) ==')
  wsUrls.forEach((u) => log('   ' + u))

  // 画面に何が出ているか（主要テキスト）
  const visibleText = await p.evaluate(() => {
    const pick = (sel) => Array.from(document.querySelectorAll(sel)).map((e) => e.textContent?.trim()).filter(Boolean).slice(0, 6)
    return { buttons: pick('button'), headings: pick('h1,h2,h3') }
  }).catch(() => ({}))
  log('\n== 画面の要素 ==')
  log('   見出し: ' + JSON.stringify(visibleText.headings))
  log('   ボタン: ' + JSON.stringify(visibleText.buttons))

  await p.screenshot({ path: '_e2e_out/prod-diag.png', fullPage: false })
  await browser.close()
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
