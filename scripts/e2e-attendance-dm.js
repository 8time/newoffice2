/**
 * 出社記録から置手紙（DM）を送れるか検証する。
 *  - 出社記録の各行に✉ボタンが出る（自分の行には出ない）
 *  - その場にいなくなった相手にもDMを開いて送れる
 *  - 送ったDMは相手が後で入室したときに履歴として受け取れる
 */
const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }
const TAG = Date.now().toString().slice(-4)

async function enter(browser, name) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1400, height: 900 } })
  const p = await ctx.newPage()
  await p.goto('http://localhost:5173')
  await p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await p.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await p.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await p.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  await p.locator('input[type="text"]').first().fill(name)
  await p.getByRole('button', { name: '入室する' }).click()
  await p.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(3000)
  return { ctx, p }
}

async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })

  const nameB = `受取${TAG}`
  const nameA = `送信${TAG}`

  log('== 受取人Bが一度出社して、退社する（＝いなくなった相手を作る）==')
  const B = await enter(browser, nameB)
  // BのuserKey(clientId)を控えておく（後で入り直したとき同じキーで受け取る）
  const bKey = await B.p.evaluate(() => localStorage.getItem('skyoffice_client_id'))
  log(`   BのuserKey: ${bKey}`)
  await wait(2000)
  await B.ctx.close() // Bは退室（オフラインになる）
  await wait(2000)

  log('\n== 送信者Aが入室し、出社記録からBに置手紙を送る ==')
  const A = await enter(browser, nameA)
  await A.p.getByText('すべて表示', { exact: false }).click().catch(() => {})
  await wait(1000)

  // Aの出社記録にBの行があり、✉ボタンが出ているか
  const btnInfo = await A.p.evaluate((bn) => {
    const items = [...document.querySelectorAll('li')]
    const row = items.find((li) => li.textContent.includes(bn))
    if (!row) return { found: false }
    const btn = row.querySelector('button.dm-btn')
    return { found: true, hasBtn: !!btn }
  }, nameB)
  log('   ' + JSON.stringify(btnInfo))
  check(btnInfo.found, '出社記録にBの行がある', 'Bの行が見つからない')
  check(btnInfo.hasBtn, 'Bの行に置手紙ボタン(✉)が出ている', '✉ボタンが出ていない')

  // 自分(A)の行には✉が出ないこと
  const selfHasBtn = await A.p.evaluate((an) => {
    const items = [...document.querySelectorAll('li')]
    const row = items.find((li) => li.textContent.includes(an))
    return row ? !!row.querySelector('button.dm-btn') : null
  }, nameA)
  check(selfHasBtn === false, '自分の行には✉が出ない', `自分にも✉が出ている: ${selfHasBtn}`)

  log('\n== ✉を押してDMを開き、置手紙を送る ==')
  await A.p.evaluate((bn) => {
    const items = [...document.querySelectorAll('li')]
    const row = items.find((li) => li.textContent.includes(bn))
    row.querySelector('button.dm-btn').click()
  }, nameB)
  await wait(1200)
  const dmOpened = await A.p.evaluate(() => window.__store.getState().dm.openKey)
  log(`   開いたDMの相手: ${dmOpened}`)
  check(dmOpened === bKey, 'Bを宛先にDMが開いた', `違う相手が開いた: ${dmOpened} (期待: ${bKey})`)

  const letter = `置手紙テスト${TAG}`
  const dmInput = A.p.locator('input[placeholder*="メッセージ"]').first()
  await dmInput.click()
  await dmInput.fill(letter)
  await A.p.keyboard.press('Enter')
  await wait(2000)
  await A.p.screenshot({ path: '_e2e_out/attendance-dm.png' })

  log('\n== Bが後から入室すると、置手紙を受け取れるか ==')
  const B2 = await enter(browser, nameB) // 同じ名前＝同じlocalStorage…ではない(別context)。
  // 別contextなのでclientIdが変わってしまう。それでは履歴が届かないため、
  // BのclientIdを復元してから履歴を要求する必要がある。
  await B2.p.evaluate((k) => localStorage.setItem('skyoffice_client_id', k), bKey)
  await B2.p.reload()
  await B2.p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await B2.p.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await B2.p.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await B2.p.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  await B2.p.locator('input[type="text"]').first().fill(nameB)
  await B2.p.getByRole('button', { name: '入室する' }).click()
  await B2.p.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(3000)

  const received = await B2.p.evaluate(() => {
    const dm = window.__store.getState().dm
    // 全会話の中に置手紙が届いているか（入室時に受信箱がまとめて届く）
    const allMsgs = Object.values(dm.messagesByKey || {}).flat()
    return allMsgs.map((m) => m.content)
  })
  log('   Bが持っているDM: ' + JSON.stringify(received))
  check(received.includes(letter), 'Bは後から入室しても置手紙を受け取れた（入室時に受信箱が届く）', `受け取れていない: ${JSON.stringify(received)}`)

  log('\n== 未読の置手紙は通知される（ポップアップ）か ==')
  await wait(2000)
  // トーストDOM・lastRead状態・トースト要素を詳しく見る
  const notifyDbg = await B2.p.evaluate(() => {
    const dm = window.__store.getState().dm
    const toastEls = [...document.querySelectorAll('*')].filter((e) => /さんからDM/.test(e.textContent || '') && e.children.length <= 2)
    return {
      lastReadByKey: dm.lastReadByKey,
      openKey: dm.openKey,
      messagesByKey: Object.fromEntries(Object.entries(dm.messagesByKey).map(([k, v]) => [k, v.length])),
      toastCount: toastEls.length,
    }
  })
  log('   ' + JSON.stringify(notifyDbg))
  const toastShown = await B2.p.locator('text=さんからDM').count()
  check(toastShown > 0, '未読の置手紙が通知トーストで知らされた', '通知が出ていない（気づけない）')
  await B2.p.screenshot({ path: '_e2e_out/attendance-dm-received.png' })

  log('\n== ライブDM（両者オンライン）の通知も従来どおり出るか ==')
  // B2は既読になっているので、Aから新しいライブDMを送る
  const liveMsg = `ライブ${TAG}`
  await A.p.evaluate((c) => window.game.scene.keys.game.network.sendDm(window.__store.getState().dm.openKey, c), liveMsg)
  await wait(2000)
  const liveToast = await B2.p.locator(`text=${liveMsg}`).count()
  const liveReceived = await B2.p.evaluate(() => Object.values(window.__store.getState().dm.messagesByKey).flat().map((m) => m.content))
  check(liveReceived.includes(liveMsg), 'ライブDMがBに届いた', `届いていない: ${JSON.stringify(liveReceived)}`)
  check(liveToast > 0, 'ライブDMの通知トーストも出た', 'ライブDMの通知が出ていない')

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
