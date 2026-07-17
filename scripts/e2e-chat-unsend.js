/**
 * チャットの「送信取消」を検証する。
 *  - 自分の発言を右クリックすると取消メニューが出る
 *  - 取り消すと相手の画面からも消える
 *  - 他人の発言では取消メニューが出ない（勝手に消せない）
 *  - サーバーに直接頼んでも他人の発言は消せない（画面だけの制限にしない）
 */
const { chromium } = require('playwright')
const wait=(ms)=>new Promise(r=>setTimeout(r,ms))
const log=console.log
let failed=0
const check=(c,ok,ng)=>{log(c?`[PASS] ${ok}`:`[FAIL] ${ng}`); if(!c)failed++}

async function enter(b, name) {
  const p = await (await b.newContext({permissions:['camera','microphone'],viewport:{width:1300,height:850}})).newPage()
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
const say = async (p, text) => {
  const i = p.locator('input[placeholder*="エンター"]').first()
  await i.click(); await i.type(text,{delay:20}); await p.keyboard.press('Enter'); await wait(2000)
}
const msgs = (p) => p.evaluate(()=>window.__store.getState().chat.chatMessages.map(m=>m.chatMessage.content))

const TAG = Date.now().toString().slice(-5)
const MSG_A = `Aの発言${TAG}`
const MSG_B = `Bの発言${TAG}`

;(async()=>{
  const b=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']})
  const A = await enter(b,'Aさん')
  const B = await enter(b,'Bさん')

  await say(A, MSG_A)
  await say(B, MSG_B)
  await wait(1500)
  check((await msgs(B)).some(c=>c.includes(MSG_A)), 'Aの発言がBに届いた（前提）', 'Aの発言が届いていない')

  log('\n== 自分の発言を右クリック ==')
  await A.locator(`text=${MSG_A}`).first().click({ button: 'right' })
  await wait(600)
  const menu = await A.locator('text=送信取消').count()
  check(menu > 0, '自分の発言では送信取消が出る', '送信取消が出ない')
  await A.screenshot({path:'_e2e_out/unsend-menu.png'})

  log('\n== 他人の発言を右クリック ==')
  await A.mouse.click(650, 300); await wait(500)   // 空白をクリックしてメニューを閉じる
  await A.locator(`text=${MSG_B}`).first().click({ button: 'right' })
  await wait(600)
  const menu2 = await A.locator('text=送信取消').count()
  check(menu2 === 0, '他人の発言では送信取消が出ない', '他人の発言でも取消が出てしまう')

  log('\n== 取り消すと全員の画面から消えるか ==')
  await A.mouse.click(650,300); await wait(400)
  await A.locator(`text=${MSG_A}`).first().click({ button: 'right' })
  await wait(600)
  await A.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('送信取消'))
    btn.click()
  })
  await wait(2500)
  const aAfter = await msgs(A), bAfter = await msgs(B)
  log('   A: ' + JSON.stringify(aAfter))
  log('   B: ' + JSON.stringify(bAfter))
  check(!aAfter.some(c=>c.includes(MSG_A)), '自分の画面から消えた', '自分の画面に残っている')
  check(!bAfter.some(c=>c.includes(MSG_A)), '相手の画面からも消えた', '相手の画面に残っている')
  check(bAfter.some(c=>c.includes(MSG_B)), '他の発言は消えていない', '他の発言まで消えた')

  log('\n== サーバーに直接頼んでも他人の発言は消せないか（画面だけの制限にしない）==')
  const targetId = await B.evaluate((msg)=>{
    const m = window.__store.getState().chat.chatMessages.find(m=>m.chatMessage.content.includes(msg))
    return m?.chatMessage.id
  }, MSG_B)
  await A.evaluate((id)=>{ window.game.scene.keys.game.network.removeChatMessage(id) }, targetId)
  await wait(2500)
  const bStill = await msgs(B)
  check(bStill.some(c=>c.includes(MSG_B)), '他人の発言はサーバーが守った', '★他人の発言を消せてしまった')

  log(failed===0?'\n=== 全項目 PASS ===':`\n=== ${failed}件 FAIL ===`)
  await b.close()
  process.exit(failed===0?0:1)
})().catch(e=>{console.error('FATAL',e);process.exit(1)})
