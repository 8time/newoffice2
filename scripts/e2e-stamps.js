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
  const sidebar = A.locator('div').filter({ hasText: 'チャット' }).last()
  await A.screenshot({ path: '_e2e_out/stamp-mode.png', clip: { x: 880, y: 480, width: 520, height: 420 } })

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
