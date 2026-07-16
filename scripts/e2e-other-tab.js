/**
 * 同じブラウザ(同じclientId)の別タブで同じ部屋を開いたときの挙動を検証する。
 * サーバーは1ブラウザ=1キャラを保つため古いタブを追い出すが、
 * 以前は何も表示されず、古いタブは「マップは映るのに看板が置けない・消せない」
 * という原因の分からない状態になっていた。
 */
const { chromium } = require('playwright')
const wait=(ms)=>new Promise(r=>setTimeout(r,ms))
const log=console.log
let failed=0
const check=(c,ok,ng)=>{log(c?`[PASS] ${ok}`:`[FAIL] ${ng}`); if(!c)failed++}

async function enter(ctx, name) {
  const p = await ctx.newPage()
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

;(async()=>{
  const b=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']})
  // 同じコンテキスト＝localStorage共有＝同じclientId（実際の「別タブ」と同じ状況）
  const ctx=await b.newContext({permissions:['camera','microphone'],viewport:{width:1200,height:800}})

  log('== タブ1で入室 ==')
  const tab1 = await enter(ctx, 'タブ1')
  const cid1 = await tab1.evaluate(()=>localStorage.getItem('skyoffice_client_id'))
  log(`   clientId: ${cid1}`)

  log('== タブ2で同じ部屋を開く（ここでタブ1が追い出される）==')
  const tab2 = await enter(ctx, 'タブ2')
  const cid2 = await tab2.evaluate(()=>localStorage.getItem('skyoffice_client_id'))
  check(cid1 === cid2, '別タブでも同じclientIdになる（＝この状況を再現できている）', 'clientIdが違う＝再現できていない')
  await wait(3000)

  log('== タブ1の状態 ==')
  const r1 = await tab1.evaluate(()=>window.__store.getState().room.disconnectReason)
  log(`   disconnectReason: ${JSON.stringify(r1)}`)
  check(r1 === 'other-tab', 'タブ1が「別タブで開いたため切断」を検知した', `検知できていない: ${JSON.stringify(r1)}`)

  const noticeShown = await tab1.locator('text=別のタブで開いたため切断しました').count()
  check(noticeShown > 0, 'タブ1に理由が表示された（黙ってゾンビ化しない）', '何も表示されない＝原因が分からないまま')
  const hasBtn = await tab1.getByRole('button',{name:'このタブで再接続する'}).count()
  check(hasBtn > 0, '復帰方法（再接続ボタン）が示されている', '復帰方法が無い')
  await tab1.screenshot({path:'_e2e_out/other-tab-1.png'})

  log('== タブ2は正常に使えるか ==')
  const r2 = await tab2.evaluate(()=>window.__store.getState().room.disconnectReason)
  const notice2 = await tab2.locator('text=別のタブで開いたため切断しました').count()
  check(r2 === '' && notice2 === 0, '新しいタブ2は普通に使える（誤検知しない）', `タブ2に誤検知: ${JSON.stringify(r2)}`)

  log(failed===0?'\n=== 全項目 PASS ===':`\n=== ${failed}件 FAIL ===`)
  await b.close()
  process.exit(failed===0?0:1)
})().catch(e=>{console.error('FATAL',e);process.exit(1)})
