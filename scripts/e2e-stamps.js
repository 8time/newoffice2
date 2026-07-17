/**
 * スタンプ機能の検証。
 *
 * フェーズ1: 表示ルールの分離
 *  - 絵文字だけの発言は、吹き出しなし・背景透明で大きく表示される
 *  - 文中の絵文字（「了解👍」）は今までどおり吹き出しの中に通常サイズ
 *  - 相手の画面でも同じ見た目になる
 */
const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }

const TAG = Date.now().toString().slice(-4)

async function enter(browser, name) {
  const p = await (await browser.newContext({
    permissions: ['camera', 'microphone'], viewport: { width: 1400, height: 900 },
  })).newPage()
  await p.goto('http://localhost:5173')
  await p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await p.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await p.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await p.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  await p.locator('input[type="text"]').first().fill(name)
  await p.getByRole('button', { name: '入室する' }).click()
  await p.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(2500)
  return p
}

const say = async (p, text) => {
  const i = p.locator('input[placeholder*="エンター"]').first()
  await i.click()
  // 絵文字はtypeだと入らないことがあるので値を直接入れて送信する
  await i.fill(text)
  await p.keyboard.press('Enter')
  await wait(1800)
}

// その発言の見た目を測る（吹き出しの有無・文字の大きさ）
const look = (p, text) => p.evaluate((t) => {
  const nodes = [...document.querySelectorAll('div')]
  // 本文を持つ一番内側の要素を探す
  const hit = nodes.filter((d) => d.textContent.trim() === t && d.children.length === 0).pop()
    || nodes.filter((d) => d.textContent.trim() === t).pop()
  if (!hit) return null
  const st = getComputedStyle(hit)
  // 吹き出しは背景色を持つ。スタンプ表示なら透明
  const bg = st.backgroundColor
  return {
    fontSize: Math.round(parseFloat(st.fontSize)),
    bg,
    hasBubbleBg: bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent',
  }
}, text)

async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const A = await enter(browser, 'スタンプA')
  const B = await enter(browser, 'スタンプB')

  const EMOJI = '👍'
  const TEXT = `了解${TAG}👍`

  log('== 絵文字だけの発言 ==')
  await say(A, EMOJI)
  const stamp = await look(A, EMOJI)
  log('   ' + JSON.stringify(stamp))
  check(!!stamp, '発言が表示された', '発言が見つからない')
  check(stamp && stamp.fontSize >= 48, `大きく表示された（${stamp?.fontSize}px）`, `大きくない: ${stamp?.fontSize}px`)
  check(stamp && !stamp.hasBubbleBg, '吹き出し（背景）が付いていない', `吹き出しが付いている: ${stamp?.bg}`)

  log('\n== 文中の絵文字（今までどおり）==')
  await say(A, TEXT)
  const normal = await look(A, TEXT)
  log('   ' + JSON.stringify(normal))
  check(normal && normal.fontSize <= 24, `通常の大きさのまま（${normal?.fontSize}px）`, `大きくなってしまった: ${normal?.fontSize}px`)
  check(normal && normal.hasBubbleBg, '吹き出しが付いている（デザイン不変）', '吹き出しが消えてしまった')

  log('\n== 相手の画面でも同じ見た目か ==')
  await wait(1500)
  const stampB = await look(B, EMOJI)
  const normalB = await look(B, TEXT)
  log('   スタンプ: ' + JSON.stringify(stampB))
  log('   通常:     ' + JSON.stringify(normalB))
  check(stampB && stampB.fontSize >= 48 && !stampB.hasBubbleBg, '相手にもスタンプとして大きく出た', '相手の画面が違う')
  check(normalB && normalB.hasBubbleBg, '相手にも通常メッセージは吹き出しで出た', '相手の画面が違う')

  // チャット欄の最新部分だけを撮る（全体を撮ると肝心の発言が写らない）
  await A.evaluate(() => {
    const box = [...document.querySelectorAll('div')].find(
      (d) => d.scrollHeight > d.clientHeight && /エンターキー|発言/.test(d.textContent || '')
    )
    if (box) box.scrollTop = box.scrollHeight
  })
  await wait(800)
  await A.screenshot({ path: '_e2e_out/stamp-mode.png', clip: { x: 880, y: 480, width: 520, height: 420 } })

  // ─── フェーズ2: スタンプメーカー ─────────────────────────────────────────
  log('\n\n########## フェーズ2: スタンプメーカー ##########')
  const fs = require('fs')
  const path = require('path')

  log('== 設定の中に入口があるか ==')
  await A.evaluate(() => {
    const label = [...document.querySelectorAll('*')].filter(
      (e) => e.children.length === 0 && e.textContent.trim() === '設定'
    )[0]
    label.parentElement.querySelector('button').click()
  })
  await wait(1200)
  const inSettings = await A.locator('text=スタンプを管理').count()
  check(inSettings > 0, '設定の中に「スタンプを管理」がある', '設定に入っていない')
  await A.getByRole('button', { name: 'キャンセル' }).click()
  await wait(600)

  log('\n== アニメ画像を登録して、動きが失われないか ==')
  await A.evaluate(() => window.__store.dispatch({ type: 'stamp/openStampManager' }))
  await A.waitForSelector('text=スタンプを管理', { timeout: 10000 })
  await wait(600)

  // 2コマのアニメGIF。縮小処理を通されると1コマ目だけになり容量が変わる
  const ANIM_GIF = Buffer.from(
    'R0lGODlhCgAKAPIAAP///wAAAP8AAAD/AAAA/////wAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh' +
    'BAkAAAAALAAAAAAKAAoAAAMWCLrcHiBAKMSC1KIuAAAh+QQJAAAAACwAAAAACgAKAIAAAAD/AAAC' +
    'FIyPqcvtD6OctNqLs968+w+G4kQBADs=', 'base64'
  )
  const gifPath = path.join(__dirname, '..', '_e2e_out', `anim-${TAG}.gif`)
  fs.writeFileSync(gifPath, ANIM_GIF)
  const originalSize = fs.statSync(gifPath).size
  log(`   元のファイル: ${originalSize} bytes（アニメGIF）`)

  await A.setInputFiles('input[type="file"][accept="image/png,image/gif,image/webp,image/apng"]', gifPath)
  await wait(900)
  await A.getByLabel('スタンプの名前').fill(`テストスタンプ${TAG}`)
  await A.getByRole('button', { name: '登録' }).click()
  await wait(3000)

  const registered = await A.evaluate((tag) => {
    const st = window.__store.getState().stamp.stamps
    const hit = Object.entries(st).find(([, s]) => s.name === `テストスタンプ${tag}`)
    return hit ? { id: hit[0], ...hit[1] } : null
  }, TAG)
  log('   登録結果: ' + JSON.stringify(registered))
  check(!!registered, 'スタンプが登録された', '登録できていない')
  if (!registered) { log('=== 以降は判定不能 ==='); await browser.close(); process.exit(1) }
  check(
    /^\/files\/[a-zA-Z0-9_]+$/.test(registered.url),
    'URLが /files/ 形式で保存された（自動削除から守られる）',
    `URL形式が違う: ${registered.url}`
  )

  // 保存されたファイルの大きさが元と同じ＝縮小処理を通っていない＝アニメが生きている
  const savedSize = await A.evaluate(async (url) => {
    const r = await fetch(url)
    return (await r.blob()).size
  }, `http://localhost:2567${registered.url}`)
  log(`   保存後のファイル: ${savedSize} bytes`)
  check(
    savedSize === originalSize,
    `アニメが失われていない（${originalSize}→${savedSize} bytes で一致）`,
    `★縮小された（${originalSize}→${savedSize}）= アニメが静止画になった疑い`
  )
  await A.screenshot({ path: '_e2e_out/stamp-manager.png' })

  log('\n== 別のブラウザにも配られるか ==')
  await wait(1500)
  const onB = await B.evaluate((tag) => {
    const st = window.__store.getState().stamp.stamps
    return Object.values(st).some((s) => s.name === `テストスタンプ${tag}`)
  }, TAG)
  check(onB, '相手の画面にも同じスタンプが配られた', '相手に届いていない')

  log('\n== 他人のスタンプは消せないか（サーバーが守るか）==')
  await B.evaluate((id) => window.game.scene.keys.game.network.removeStamp(id), registered.id)
  await wait(2500)
  const stillThere = await A.evaluate((id) => !!window.__store.getState().stamp.stamps[id], registered.id)
  check(stillThere, '★他人のスタンプはサーバーが守った（消せない）', '★他人のスタンプを消せてしまった')

  log('\n== 1MBを超える画像は拒否するか ==')
  const bigPath = path.join(__dirname, '..', '_e2e_out', `big-${TAG}.png`)
  fs.writeFileSync(bigPath, Buffer.alloc(1024 * 1024 + 5000, 1))
  await A.setInputFiles('input[type="file"][accept="image/png,image/gif,image/webp,image/apng"]', bigPath)
  await wait(900)
  const rejected = await A.locator('text=1MB以下').count()
  check(rejected > 0, '1MB超は登録前に拒否される', '大きすぎる画像が通ってしまう')

  // ─── フェーズ3: チャットからの送信 ───────────────────────────────────────
  log('\n\n########## フェーズ3: スタンプの送信 ##########')
  await A.getByRole('button', { name: '閉じる' }).click()
  await wait(800)

  log('== ピッカーから送れるか ==')
  await A.locator('[aria-label="stamp"]').click()
  await wait(900)
  const pickerShown = await A.locator('img[alt="テストスタンプ' + TAG + '"]').count()
  check(pickerShown > 0, 'スタンプ一覧に登録したスタンプが出る', 'ピッカーに出ていない')
  await A.screenshot({ path: '_e2e_out/stamp-picker.png' })

  // ─── フェーズ4: お気に入り ─────────────────────────────────────────────
  log('\n\n########## フェーズ4: お気に入り ##########')

  log('== ☆を押すとお気に入りに入るか ==')
  const favBefore = await A.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('skyoffice_stamp_favorites') || '[]') } catch { return [] }
  })
  check(!favBefore.includes(registered.id), '最初はお気に入りに入っていない（前提）', '最初から入っている＝検証できない')

  await A.locator(`[aria-label="favorite-${registered.id}"]`).click()
  await wait(500)
  const favAfter = await A.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('skyoffice_stamp_favorites') || '[]') } catch { return [] }
  })
  log('   お気に入り: ' + JSON.stringify(favAfter))
  check(favAfter.includes(registered.id), '☆を押すとお気に入りに保存された', 'お気に入りに入らない')

  log('\n== 「お気に入り」タブに出るか ==')
  await A.getByText('お気に入り', { exact: true }).click()
  await wait(500)
  const inFavTab = await A.locator('img[alt="テストスタンプ' + TAG + '"]').count()
  check(inFavTab > 0, 'お気に入りタブに出てくる', 'お気に入りタブに出ない')

  log('\n== ☆をもう一度押すと外れるか ==')
  await A.locator(`[aria-label="favorite-${registered.id}"]`).click()
  await wait(500)
  const favRemoved = await A.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('skyoffice_stamp_favorites') || '[]') } catch { return [] }
  })
  check(!favRemoved.includes(registered.id), 'もう一度押すとお気に入りから外れた', '外れていない')

  log('\n== 別のブラウザには影響しないか（個人設定）==')
  const favOnB = await B.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('skyoffice_stamp_favorites') || '[]') } catch { return [] }
  })
  check(favOnB.length === 0, '相手のお気に入りには影響していない', '相手にも伝わってしまっている')

  // 送信タブへ戻す（「よく使う」からでもクリックできる）
  await A.getByText('よく使う', { exact: true }).click()
  await wait(500)

  // ─── フェーズ5: マップ上の頭上スタンプ ─────────────────────────────────
  log('\n\n########## フェーズ5: 頭上スタンプ ##########')
  const stampTexKey = `stamptex_${registered.id}`

  log('== 送信するとアバターの頭上に表示されるか ==')
  await A.locator('img[alt="テストスタンプ' + TAG + '"]').first().click()
  // 表示は2200msのtweenでフェードして消えるため、A・Bとも同じタイミングで
  // 早めに（消える前に）確認する。片方を確認してからもう片方…と順番に待つと、
  // 後から見た方はもう消えた後、という誤検知になる
  await wait(1200)

  const hasTexA = await A.evaluate(
    (key) => window.game.scene.keys.game.textures.exists(key),
    stampTexKey
  )
  check(hasTexA, '自分の画面でスタンプ画像のテクスチャが読み込まれた', 'テクスチャが読み込まれていない')

  const hasImgObjA = await A.evaluate((key) => {
    const scene = window.game.scene.keys.game
    return scene.children.list.some((o) => o.texture && o.texture.key === key)
  }, stampTexKey)
  check(hasImgObjA, '自分のアバターの頭上に画像が出た', '頭上に画像が出ていない')

  log('\n== 相手の頭上にも表示されるか（SEND_EMOTEの中継）==')
  const hasImgObjB = await B.evaluate((key) => {
    const scene = window.game.scene.keys.game
    return scene.children.list.some((o) => o.texture && o.texture.key === key)
  }, stampTexKey)
  check(hasImgObjB, '相手の画面にも頭上スタンプが中継された', '相手の画面に出ていない')
  await A.screenshot({ path: '_e2e_out/stamp-above-head.png' })

  log('\n== 約2秒で自動的に消えるか ==')
  await wait(2000) // ここまでの経過(1200ms)と合わせてtween(2200ms)を過ぎる
  const stillThereA = await A.evaluate((key) => {
    const scene = window.game.scene.keys.game
    return scene.children.list.some((o) => o.texture && o.texture.key === key)
  }, stampTexKey)
  check(!stillThereA, '一定時間で消えて残らない', 'いつまでも頭上に残っている')

  log('\n== 通常の絵文字リアクション（EmotePanel経由）は今までどおりか ==')
  // stampIdを渡さない従来のsendEmote呼び出しが壊れていないことを確認する
  await A.evaluate(() => window.game.scene.keys.game.network.sendEmote('🎉'))
  await wait(1200)
  const hasEmojiText = await A.evaluate(() => {
    const scene = window.game.scene.keys.game
    return scene.children.list.some((o) => o.type === 'Text' && o.text === '🎉')
  })
  check(hasEmojiText, '通常の絵文字エモートは今までどおり文字で頭上に出る', '絵文字エモートが壊れている')

  // 送った本文が [stamp:xxx] の形で、画像として表示されているか
  const sentOnA = await A.evaluate((id) => {
    const msgs = window.__store.getState().chat.chatMessages
    const m = msgs.find((x) => x.chatMessage.content === `[stamp:${id}]`)
    if (!m) return null
    const img = document.querySelector(`img[alt="${window.__store.getState().stamp.stamps[id]?.name}"]`)
    return { content: m.chatMessage.content, shownAsImage: !!img }
  }, registered.id)
  log('   ' + JSON.stringify(sentOnA))
  check(!!sentOnA, 'スタンプが本文の印として送られた', '送信されていない')
  check(sentOnA?.shownAsImage, '画像として表示されている', '画像になっていない')

  log('\n== 相手にも画像として届くか ==')
  await wait(1500)
  const onBmsg = await B.evaluate((id) => {
    const msgs = window.__store.getState().chat.chatMessages
    const has = msgs.some((x) => x.chatMessage.content === `[stamp:${id}]`)
    const stamps = window.__store.getState().stamp.stamps
    const imgs = [...document.querySelectorAll('img')].filter((i) => i.alt === stamps[id]?.name)
    // 吹き出しに入っていないこと（親に背景が付いていない）
    const bare = imgs.length > 0 && getComputedStyle(imgs[0].parentElement).backgroundColor === 'rgba(0, 0, 0, 0)'
    return { has, imgCount: imgs.length, bare }
  }, registered.id)
  log('   ' + JSON.stringify(onBmsg))
  check(onBmsg.has && onBmsg.imgCount > 0, '相手の画面にスタンプが届いた', '相手に届いていない')
  check(onBmsg.bare, '吹き出しなしで表示されている', '吹き出しに入ってしまっている')

  log('\n== 使用回数が数えられているか（よく使う順の土台）==')
  const used = await A.evaluate((id) => window.__store.getState().stamp.stamps[id]?.useCount, registered.id)
  log(`   useCount: ${used}`)
  check(used >= 1, '送信で使用回数が増えた', `増えていない: ${used}`)

  log('\n== 送信取消できるか ==')
  const msgId = await A.evaluate((id) => {
    const m = window.__store.getState().chat.chatMessages.find((x) => x.chatMessage.content === `[stamp:${id}]`)
    return m?.chatMessage.id
  }, registered.id)
  await A.evaluate((mid) => window.game.scene.keys.game.network.removeChatMessage(mid), msgId)
  await wait(2500)
  const goneBoth = await Promise.all([
    A.evaluate((id) => !window.__store.getState().chat.chatMessages.some((x) => x.chatMessage.content === `[stamp:${id}]`), registered.id),
    B.evaluate((id) => !window.__store.getState().chat.chatMessages.some((x) => x.chatMessage.content === `[stamp:${id}]`), registered.id),
  ])
  check(goneBoth[0] && goneBoth[1], 'スタンプの発言も両者から取り消せた', `取り消せない: ${JSON.stringify(goneBoth)}`)

  log('\n== 台帳から消えたスタンプの発言はどうなるか ==')
  await A.evaluate((id) => window.game.scene.keys.game.network.addChatMessage(`[stamp:${id}]`), registered.id)
  await wait(2000)
  await A.evaluate((id) => window.game.scene.keys.game.network.removeStamp(id), registered.id)
  await wait(2500)
  const fallback = await A.locator('text=(削除されたスタンプ)').count()
  check(fallback > 0, '削除済みスタンプの発言は文言で退避される（画像切れにならない）', '退避表示が出ない')

  log('\n== 自分のスタンプは消せるか（後片付け）==')
  const gone = await A.evaluate((id) => !window.__store.getState().stamp.stamps[id], registered.id)
  check(gone, '自分のスタンプは消せた', '自分のスタンプが消せない')

  try { fs.unlinkSync(gifPath); fs.unlinkSync(bigPath) } catch {}

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
