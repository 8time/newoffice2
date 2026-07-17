/**
 * チャット欄に「〇〇が入室しました」を出さないことを検証する。
 * 入室はサイドバーの「今日の出社記録」「在席メンバー」で分かるため不要。
 * 通常のチャットが今までどおり流れることもあわせて確認する。
 */
const { chromium } = require('playwright')
const wait=(ms)=>new Promise(r=>setTimeout(r,ms))
const log=console.log
let failed=0
const check=(c,ok,ng)=>{log(c?`[PASS] ${ok}`:`[FAIL] ${ng}`); if(!c)failed++}

async function enter(browser, name) {
  const p = await (await browser.newContext({permissions:['camera','microphone'],viewport:{width:1300,height:850}})).newPage()
  await p.goto('http://localhost:5173')
  await p.waitForFunction(()=>window.__store?.getState().room.lobbyJoined===true,{timeout:30000})
  await p.waitForFunction(()=>window.game?.scene?.keys?.bootstrap?.preloadComplete===true,{timeout:30000})
  await p.getByRole('button',{name:'パブリックロビーに接続'}).click()
  await p.waitForFunction(()=>window.__store?.getState().room.roomJoined===true,{timeout:30000})
  await p.locator('input[type="text"]').first().fill(name)
  await p.getByRole('button',{name:'入室する'}).click()
  await p.waitForSelector('text=チャット',{timeout:20000})
  await wait(2500)
  return p
}
const msgs = (p) => p.evaluate(()=>window.__store.getState().chat.chatMessages.map(m=>({t:m.messageType, c:m.chatMessage.content})))

;(async()=>{
  const b=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']})

  log('== Aが入室（自分の入室が出ないこと）==')
  const A = await enter(b,'Aさん')
  let m = await msgs(A)
  log('   Aのチャット: ' + JSON.stringify(m))
  check(!m.some(x=>String(x.c).includes('入室しました')), '自分の入室メッセージが出ない', '自分の入室メッセージが出ている')

  log('== Bが入室（Aの画面に相手の入室が出ないこと）==')
  const B = await enter(b,'Bさん')
  await wait(3000)
  m = await msgs(A)
  log('   Aのチャット: ' + JSON.stringify(m))
  check(!m.some(x=>String(x.c).includes('入室しました')), '相手の入室メッセージも出ない', '相手の入室メッセージが出ている')

  log('== 通常のチャットは今までどおり流れるか ==')
  const input = A.locator('input[placeholder*="エンター"]').first()
  await input.click(); await input.type('こんにちは',{delay:30}); await A.keyboard.press('Enter')
  await wait(2500)
  const mb = await msgs(B)
  log('   Bのチャット: ' + JSON.stringify(mb))
  check(mb.some(x=>String(x.c).includes('こんにちは')), '通常のチャットは相手に届く', 'チャットが届かない＝壊した')
  await A.screenshot({path:'_e2e_out/chat-no-join.png'})

  log(failed===0?'\n=== 全項目 PASS ===':`\n=== ${failed}件 FAIL ===`)
  await b.close()
  process.exit(failed===0?0:1)
})().catch(e=>{console.error('FATAL',e);process.exit(1)})
