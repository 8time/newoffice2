const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] })
  const ctx = await browser.newContext({ permissions: ['camera','microphone'], viewport: { width: 1200, height: 800 } })
  const p = await ctx.newPage()
  const wsList = []
  p.on('websocket', (w) => { if(!/colyseus/.test(w.url()))return; const o={url:w.url(),sent:0,recv:0,closed:null,code:null}; wsList.push(o); w.on('framesent',()=>o.sent++); w.on('framereceived',()=>o.recv++); w.on('close',()=>{o.closed=true}) })
  p.on('response', async (r) => { if(/matchmake\/joinOrCreate\/skyoffice/.test(r.url())){ let b='';try{b=(await r.text()).slice(0,160)}catch{}; log('   [skyoffice matchmake] '+r.status()+' '+b) } })
  p.on('console', (m)=>{ if(/error|4001|切断|kick/i.test(m.text())) log('   [con] '+m.text().slice(0,120)) })
  await p.goto('https://newoffice2.pages.dev', { waitUntil: 'domcontentloaded' })
  await p.getByRole('button', { name: 'パブリックロビーに接続' }).waitFor({ timeout: 30000 })
  await wait(2000)
  log('クリック前のWS数: '+wsList.length)
  await p.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await wait(8000)
  log('\n全WS:')
  wsList.forEach((o,i)=>log(`  #${i} sent=${o.sent} recv=${o.recv} closed=${o.closed} ${o.url.slice(0,70)}`))
  await browser.close()
}
main().catch((e)=>{log('FATAL '+e); process.exit(1)})
