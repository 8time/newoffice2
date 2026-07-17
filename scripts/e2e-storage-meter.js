/**
 * 保存容量メーター（MAP左下）と、自分で消せる内訳画面を検証する。
 *  - メーターが出て使用量を示す
 *  - クリックで内訳が開き、大きい順に並ぶ
 *  - 使用中のファイルは消せない（画面でもサーバーでも）
 *  - 未使用のファイルは消せて、使用量が減る
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
  await p.locator('input[type="text"]').first().fill('容量テスト')
  await p.getByRole('button',{name:'入室する'}).click()
  await p.waitForSelector('text=チャット',{timeout:20000})
  await wait(3000)

  log('== メーターが出るか ==')
  await p.waitForSelector('text=保存容量',{timeout:15000}).catch(()=>{})
  const meter = await p.locator('text=保存容量').count()
  check(meter > 0, 'MAP左下にメーターが出た', 'メーターが出ない')
  await p.screenshot({path:'_e2e_out/storage-meter.png'})

  log('\n== クリックで内訳が開くか ==')
  await p.locator('text=保存容量').first().click()
  await wait(1200)
  const dlg = await p.locator('text=保存容量の内訳').count()
  check(dlg > 0, '内訳画面が開いた', '内訳が開かない')
  await p.screenshot({path:'_e2e_out/storage-dialog.png'})

  const info = await p.evaluate(async () => {
    const r = await fetch('/api/storage-usage'.replace(/^/,'http://localhost:2567'))
    const j = await r.json()
    return { count: j.fileCount, inUse: j.files.filter(f=>f.inUse).length,
             sortedDesc: j.files.every((f,i)=> i===0 || j.files[i-1].size >= f.size) }
  })
  log('   ' + JSON.stringify(info))
  check(info.sortedDesc, '大きい順に並んでいる', '並び順が違う')

  log('\n== 使用中のファイルは消せないか（一番大事）==')
  const usedBtns = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('div')].filter(d => d.textContent === '使用中')
    return rows.map(r => {
      const item = r.parentElement
      const btn = item?.querySelector('button')
      return { disabled: btn?.disabled === true }
    })
  })
  log('   使用中の行: ' + JSON.stringify(usedBtns))
  check(usedBtns.length === 0 || usedBtns.every(x=>x.disabled), '使用中のファイルは削除ボタンが押せない', '使用中でも押せてしまう')

  // サーバー側でも拒否するか（画面だけの制限にしない）
  const guard = await p.evaluate(async () => {
    const r = await fetch('http://localhost:2567/api/storage-usage')
    const j = await r.json()
    const used = j.files.find(f => f.inUse)
    if (!used) return { skipped: true }
    const del = await fetch('http://localhost:2567/api/files/' + used.id, { method: 'DELETE' })
    return { status: del.status, body: await del.json() }
  })
  log('   サーバーに直接削除を依頼: ' + JSON.stringify(guard))
  check(guard.skipped || guard.status === 409, '使用中はサーバーが拒否した(409)', '★使用中を消せてしまった')

  log('\n== 未使用のファイルは消せるか ==')
  const before = await p.evaluate(async()=>(await (await fetch('http://localhost:2567/api/storage-usage')).json()).fileCount)
  const delRes = await p.evaluate(async () => {
    const j = await (await fetch('http://localhost:2567/api/storage-usage')).json()
    const free = j.files.find(f => !f.inUse)
    if (!free) return { skipped: true }
    const r = await fetch('http://localhost:2567/api/files/' + free.id, { method: 'DELETE' })
    return { status: r.status, name: free.name }
  })
  await wait(800)
  const after = await p.evaluate(async()=>(await (await fetch('http://localhost:2567/api/storage-usage')).json()).fileCount)
  log(`   ${JSON.stringify(delRes)} / 件数: ${before} → ${after}`)
  check(delRes.skipped || (delRes.status === 200 && after === before - 1), '未使用のファイルを削除できた', '削除できていない')

  log(failed===0?'\n=== 全項目 PASS ===':`\n=== ${failed}件 FAIL ===`)
  await b.close()
  process.exit(failed===0?0:1)
})().catch(e=>{console.error('FATAL',e);process.exit(1)})
