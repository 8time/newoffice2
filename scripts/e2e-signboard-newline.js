/**
 * 看板のテキスト入力でEnterによる改行ができるか検証する。
 * PhaserがDOM入力欄のキーも拾うため、Enterでチャットが開いてフォーカスを奪われ、
 * 改行が入力できなくなっていた。
 */
const { chromium } = require('playwright')
const wait=(ms)=>new Promise(r=>setTimeout(r,ms))
const log=console.log
let failed=0
const check=(c,ok,ng)=>{log(c?`[PASS] ${ok}`:`[FAIL] ${ng}`); if(!c)failed++}

;(async()=>{
  const b=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']})
  const p=await (await b.newContext({permissions:['camera','microphone'],viewport:{width:1400,height:900}})).newPage()
  await p.goto('http://localhost:5173')
  await p.waitForFunction(()=>window.__store?.getState().room.lobbyJoined===true,{timeout:30000})
  await p.waitForFunction(()=>window.game?.scene?.keys?.bootstrap?.preloadComplete===true,{timeout:30000})
  await p.getByRole('button',{name:'パブリックロビーに接続'}).click()
  await p.waitForFunction(()=>window.__store?.getState().room.roomJoined===true,{timeout:30000})
  await p.locator('input[type="text"]').first().fill('Aさん')
  await p.getByRole('button',{name:'入室する'}).click()
  await p.waitForSelector('text=チャット',{timeout:20000})
  await wait(2500)

  await p.evaluate(()=>{
    const label=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent.trim()==='看板を設置')[0]
    label.parentElement.querySelector('button').click()
  })
  await wait(1200)

  const ta=p.locator('textarea').first()
  await ta.click()
  await ta.type('1行目',{delay:30})
  await p.keyboard.press('Enter')
  await ta.type('2行目',{delay:30})
  await wait(800)

  const val = await ta.inputValue()
  log('入力欄の中身: ' + JSON.stringify(val))
  check(val.includes('\n'), '改行が入力できた', '改行が入らない（Enterが奪われている）')
  check(val === '1行目\n2行目', '入力した通りの2行になっている', `中身が違う: ${JSON.stringify(val)}`)

  // Enterでチャットが開いてしまっていないか
  const chatFocused = await p.evaluate(()=>window.__store.getState().chat.focused)
  check(chatFocused !== true, 'Enterでチャットにフォーカスが奪われていない', 'Enterでチャットにフォーカスが移ってしまう')

  // 改行入りの看板が設置できるか
  await p.getByRole('button',{name:/設置モードへ/}).click()
  await wait(1000)
  await p.mouse.click(520,380)
  await wait(2500)
  const placed = await p.evaluate(()=>{
    const g=window.game.scene.keys.game
    let found=null
    g.signboardMap.forEach((c,id)=>{ const t=c.list?.find(o=>o.type==='Text'); if(t&&t.text.includes('1行目')) found=t.text })
    return found
  })
  log('看板の文字: ' + JSON.stringify(placed))
  check(!!placed && placed.includes('\n'), '改行を含む看板が設置された', '改行入りの看板が設置できない')
  await p.screenshot({path:'_e2e_out/signboard-newline.png'})

  log(failed===0?'\n=== 全項目 PASS ===':`\n=== ${failed}件 FAIL ===`)
  await b.close()
  process.exit(failed===0?0:1)
})().catch(e=>{console.error('FATAL',e);process.exit(1)})
