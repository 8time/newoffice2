/**
 * 出社記録を最新4件だけにして、空いた分をチャットに回せているか検証する。
 *  - 既定は最新4件（新しい順）
 *  - 「すべて表示」で全件見える
 *  - 4件表示のほうがチャットの表示領域が広い
 */
const { chromium } = require('playwright')
const wait=(ms)=>new Promise(r=>setTimeout(r,ms))
const log=console.log
let failed=0
const check=(c,ok,ng)=>{log(c?`[PASS] ${ok}`:`[FAIL] ${ng}`); if(!c)failed++}

;(async()=>{
  const b=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']})
  const p=await (await b.newContext({permissions:['camera','microphone'],viewport:{width:1500,height:900}})).newPage()
  await p.goto('http://localhost:5173')
  await p.waitForFunction(()=>window.__store?.getState().room.lobbyJoined===true,{timeout:30000})
  await p.waitForFunction(()=>window.game?.scene?.keys?.bootstrap?.preloadComplete===true,{timeout:30000})
  await p.getByRole('button',{name:'パブリックロビーに接続'}).click()
  await p.waitForFunction(()=>window.__store?.getState().room.roomJoined===true,{timeout:30000})
  await p.locator('input[type="text"]').first().fill('出社テスト')
  await p.getByRole('button',{name:'入室する'}).click()
  await p.waitForSelector('text=チャット',{timeout:20000})
  await wait(3500)

  const total = await p.evaluate(async () => (await (await fetch('http://localhost:2567/api/attendance')).json()).length)
  log(`サーバー上の当日記録: ${total}件`)

  const rows = () => p.evaluate(() => document.querySelectorAll('ul li').length)
  // サイドバー(幅525px)の最後の子＝チャット欄の入れ物の高さを測る
  const chatH = () => p.evaluate(() => {
    const bar = [...document.querySelectorAll('div')].find(
      (d) => Math.round(d.getBoundingClientRect().width) === 525 && d.getBoundingClientRect().height > 400
    )
    const wrap = bar?.lastElementChild
    return wrap ? Math.round(wrap.getBoundingClientRect().height) : 0
  })

  const shown = await rows()
  const h1 = await chatH()
  log(`既定の表示件数: ${shown} / チャット領域の高さ: ${h1}px`)
  check(total <= 4 ? shown === total : shown === 4, `既定は最新4件だけ（${shown}件）`, `件数が違う: ${shown}`)
  await p.screenshot({path:'_e2e_out/attendance-compact.png'})

  if (total > 4) {
    log('\n== すべて表示 ==')
    await p.getByRole('button',{name:/すべて表示/}).click()
    await wait(800)
    const shownAll = await rows()
    const h2 = await chatH()
    log(`すべて表示: ${shownAll}件 / チャット領域: ${h2}px`)
    check(shownAll === total, `全件表示された（${shownAll}件）`, `全件出ない: ${shownAll}/${total}`)
    check(h1 >= h2, `4件表示のほうがチャットが広い（${h1}px ≧ ${h2}px）`, `チャットが広がっていない: ${h1} < ${h2}`)
    await p.screenshot({path:'_e2e_out/attendance-all.png'})

    await p.getByRole('button',{name:/最新のみ/}).click()
    await wait(600)
    check(await rows() === 4, '「最新のみ」で4件に戻る', '戻らない')
  } else {
    log('（記録が4件以下のため「すべて表示」は判定なし）')
  }

  log(failed===0?'\n=== 全項目 PASS ===':`\n=== ${failed}件 FAIL ===`)
  await b.close()
  process.exit(failed===0?0:1)
})().catch(e=>{console.error('FATAL',e);process.exit(1)})
