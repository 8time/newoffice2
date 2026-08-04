const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1200, height: 800 } })
  const p = await ctx.newPage()
  p.on('console', (m) => { const t = m.text(); if (/切断|code=|kick|4001/i.test(t)) log('   [console] ' + t.slice(0,120)) })
  await p.goto('https://newoffice2.pages.dev', { waitUntil: 'domcontentloaded' })
  await p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 }).catch(()=>log('   lobbyJoined待ちタイムアウト'))
  await p.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 }).catch(()=>{})
  log('lobby接続OK。パブリックロビーに接続をクリック')
  await p.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  const joined = await p.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 20000 }).then(()=>true).catch(()=>false)
  log('roomJoined: ' + joined)
  if (joined) {
    await p.locator('input[type="text"]').first().fill('診断ユーザー')
    await p.getByRole('button', { name: '入室する' }).click()
    const inOffice = await p.waitForFunction(() => window.__store?.getState().user.loggedIn === true, { timeout: 20000 }).then(()=>true).catch(()=>false)
    log('loggedIn(オフィス入室): ' + inOffice)
    await wait(3000)
    const final = await p.evaluate(() => ({ loggedIn: window.__store.getState().user.loggedIn, reason: window.__store.getState().room.disconnectReason }))
    log('最終状態: ' + JSON.stringify(final))
    await p.screenshot({ path: '_e2e_out/prod-join.png' })
  }
  await browser.close()
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
