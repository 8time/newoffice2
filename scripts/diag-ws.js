const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const ctx = await browser.newContext({ permissions: ['camera','microphone'], viewport: { width: 1200, height: 800 } })
  const p = await ctx.newPage()
  p.on('console', (m) => { if (m.type()==='error' || /colyseus|matchmake|join|error|refused|CORS|mixed/i.test(m.text())) log('   [con:'+m.type()+'] '+m.text().slice(0,160)) })
  p.on('pageerror', (e) => log('   [pageerror] '+e.message.slice(0,160)))
  p.on('response', async (r) => { const u=r.url(); if(/matchmake/i.test(u)){ let body=''; try{body=(await r.text()).slice(0,200)}catch{}; log('   [matchmake] '+r.status()+' '+u.split('/').slice(3).join('/')+' body='+body) } })
  p.on('requestfailed', (r) => { if(/matchmake|colyseus/i.test(r.url())) log('   [req失敗] '+r.url()+' '+(r.failure()?.errorText||'')) })
  let ws
  p.on('websocket', (w) => {
    if (!/colyseus/.test(w.url())) return
    ws = w
    let sent=0, recv=0
    log('   [ws open] '+w.url().slice(0,80))
    w.on('framesent', () => sent++)
    w.on('framereceived', () => recv++)
    w.on('close', () => log('   [ws CLOSE] sent='+sent+' recv='+recv))
    setTimeout(() => log('   [ws frames 5s] sent='+sent+' recv='+recv), 6000)
  })
  await p.goto('https://newoffice2.pages.dev', { waitUntil: 'domcontentloaded' })
  await wait(10000)
  const st = await p.evaluate(() => ({ lobby: window.__store?.getState().room.lobbyJoined, room: window.__store?.getState().room.roomJoined }))
  log('   状態(load後10s): '+JSON.stringify(st))
  await browser.close()
}
main().catch((e)=>{log('FATAL '+e); process.exit(1)})
