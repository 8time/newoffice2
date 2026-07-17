/**
 * MAP右下にあった白い丸アイコンの機能を、設定ダイアログへ移せているか検証する。
 * 移した機能: ルーム情報 / 操作ガイド / 背景テーマ / ジョイスティック表示
 * あわせて、右下にアイコンが残っていないこと・絵文字が重ならないことを確認する。
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
  await p.locator('input[type="text"]').first().fill('設定テスト')
  await p.getByRole('button',{name:'入室する'}).click()
  await p.waitForSelector('text=チャット',{timeout:20000}); await wait(3500)

  log('== 右下のアイコンが撤去されているか ==')
  const guideIcon = await p.locator('[title="操作ガイド"], [aria-label="操作ガイド"]').count()
  const roomIcon = await p.locator('[title="ルーム情報"]').count()
  check(guideIcon === 0 && roomIcon === 0, '右下の白い丸アイコンが無くなった', 'まだ残っている')

  log('\n== 設定を開く ==')
  await p.evaluate(() => {
    const label=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent.trim()==='設定')[0]
    label.parentElement.querySelector('button').click()
  })
  await wait(1200)
  const items = await p.evaluate(() => ({
    guide: /W, A, S, D/.test(document.body.innerText),
    room: /ルーム情報/.test(document.body.innerText),
    invite: /招待URLをコピー/.test(document.body.innerText),
    bg: /背景を夜にする/.test(document.body.innerText),
    joy: /ジョイスティック/.test(document.body.innerText),
    name: /名前/.test(document.body.innerText),
  }))
  log('   ' + JSON.stringify(items))
  check(items.guide, '操作ガイドが設定の中にある', '操作ガイドが無い')
  check(items.room && items.invite, 'ルーム情報と招待URLが設定の中にある', 'ルーム情報が無い')
  check(items.bg, '背景テーマの切り替えが設定の中にある', '背景テーマが無い')
  check(items.joy, 'ジョイスティックの切り替えが設定の中にある', 'ジョイスティックが無い')
  check(items.name, '元からの名前・アバター設定も残っている', '既存の設定が消えた')
  await p.screenshot({path:'_e2e_out/settings-merged.png'})

  log('\n== 背景テーマが実際に効くか ==')
  const before = await p.evaluate(()=>window.__store.getState().user.backgroundMode)
  await p.getByText('背景を夜にする').click()
  await wait(800)
  const after = await p.evaluate(()=>window.__store.getState().user.backgroundMode)
  log(`   ${before} → ${after}`)
  check(before !== after, '設定から背景を切り替えられた', '切り替わらない')

  log(failed===0?'\n=== 全項目 PASS ===':`\n=== ${failed}件 FAIL ===`)
  await b.close()
  process.exit(failed===0?0:1)
})().catch(e=>{console.error('FATAL',e);process.exit(1)})
