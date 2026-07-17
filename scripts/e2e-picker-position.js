/**
 * チャットのスタンプ・絵文字ピッカーが、チャットを上へスクロールしても
 * 入力欄のそばに固定表示されるか検証する。
 * 以前はスクロール領域(ChatBox)の内側に置かれていたため、上へスクロールすると
 * ピッカーも一緒に流れて見失っていた。
 */
const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }

async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const p = await (await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1400, height: 900 } })).newPage()
  await p.goto('http://localhost:5173')
  await p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await p.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await p.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await p.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  await p.locator('input[type="text"]').first().fill('位置A')
  await p.getByRole('button', { name: '入室する' }).click()
  await p.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(2500)

  // 履歴が縦に長くなるよう、たくさん発言してスクロールできる状態にする
  const input = p.locator('input[placeholder*="エンター"]').first()
  for (let i = 0; i < 15; i++) {
    await input.click()
    await input.fill(`メッセージ${i}`)
    await p.keyboard.press('Enter')
    await wait(200)
  }
  await wait(1000)

  // 入力欄の絵文字ボタンの位置（ピッカーがこの近くに出るのが正しい）
  const emojiBtnBox = await p.evaluate(() => {
    const btn = document.querySelector('[aria-label="emoji"]')
    if (!btn) return null
    const r = btn.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom) }
  })
  log('絵文字ボタンの位置: ' + JSON.stringify(emojiBtnBox))

  const getPickerTop = async (sel) => p.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom) }
  }, sel)

  // ─── 絵文字ピッカー ───
  log('\n== 絵文字ピッカーを開く ==')
  await p.locator('[aria-label="emoji"]').click()
  await wait(800)
  const emojiPicker1 = await getPickerTop('.emoji-mart')
  log('   開いた直後のピッカー位置: ' + JSON.stringify(emojiPicker1))
  check(!!emojiPicker1, '絵文字ピッカーが表示された', 'ピッカーが出ない')

  // ピッカーが入力欄付近（＝画面下部）に出ているか。ボタンより上に出るのが正しい
  check(
    !!emojiPicker1 && !!emojiBtnBox && emojiPicker1.bottom <= emojiBtnBox.bottom + 20 && emojiPicker1.bottom > emojiBtnBox.top - 400,
    '絵文字ピッカーが入力欄ボタンの近く（上）に出ている',
    `位置がおかしい: picker=${JSON.stringify(emojiPicker1)} btn=${JSON.stringify(emojiBtnBox)}`
  )

  log('\n== チャットを一番上までスクロールする ==')
  await p.evaluate(() => {
    const box = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).overflowY === 'auto' && /メッセージ0/.test(d.textContent || ''))
    if (box) box.scrollTop = 0
  })
  await wait(800)
  const emojiPicker2 = await getPickerTop('.emoji-mart')
  log('   スクロール後のピッカー位置: ' + JSON.stringify(emojiPicker2))
  check(
    !!emojiPicker1 && !!emojiPicker2 && Math.abs(emojiPicker1.top - emojiPicker2.top) <= 3,
    'スクロールしてもピッカーは同じ位置に留まっている（一緒に流れない）',
    `スクロールで動いた: ${JSON.stringify(emojiPicker1)} → ${JSON.stringify(emojiPicker2)}`
  )
  await p.screenshot({ path: '_e2e_out/picker-emoji-scrolled.png' })
  // 閉じる
  await p.locator('[aria-label="emoji"]').click()
  await wait(500)

  // ─── スタンプピッカー ───
  log('\n== スタンプピッカーでも同様に確認 ==')
  await p.locator('[aria-label="stamp"]').click()
  await wait(800)
  // StampPickerのWrapper（お気に入り/よく使う タブを含む箱）を特定
  const stampSel = 'div:has(> div > button:text-is("よく使う"))'
  const stampPicker1 = await p.evaluate(() => {
    const tab = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'よく使う')
    if (!tab) return null
    let el = tab
    // タブの2つ上（Tabs → Wrapper）
    while (el && getComputedStyle(el).position !== 'absolute') el = el.parentElement
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom) }
  })
  log('   スタンプピッカー位置: ' + JSON.stringify(stampPicker1))
  check(!!stampPicker1, 'スタンプピッカーが表示された', 'スタンプピッカーが出ない（スタンプ未登録かも）')

  if (stampPicker1) {
    await p.evaluate(() => {
      const box = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).overflowY === 'auto' && /メッセージ0/.test(d.textContent || ''))
      if (box) box.scrollTop = 0
    })
    await wait(800)
    const stampPicker2 = await p.evaluate(() => {
      const tab = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'よく使う')
      if (!tab) return null
      let el = tab
      while (el && getComputedStyle(el).position !== 'absolute') el = el.parentElement
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) }
    })
    log('   スクロール後: ' + JSON.stringify(stampPicker2))
    check(
      !!stampPicker2 && Math.abs(stampPicker1.top - stampPicker2.top) <= 3,
      'スタンプピッカーもスクロールで流れない',
      `スクロールで動いた: ${JSON.stringify(stampPicker1)} → ${JSON.stringify(stampPicker2)}`
    )
  }

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
