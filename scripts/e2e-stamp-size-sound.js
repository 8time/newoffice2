/**
 * スタンプ画像のサイズ調整と送信音を検証する。
 *  1. スタンプ画像の横幅がチャットメッセージエリア(ChatBox)の約50%になっている
 *  2. 画面が広い場合は 160〜200px で頭打ちになる（実測 180px）
 *  3. 縦横比が保たれている（height:autoで潰れていない）
 *  4. 通常のテキストメッセージ・アバター・吹き出しのレイアウトが崩れていない
 *  5. スタンプ送信で「ポン」音（通常のチャット通知音とは別の音）が鳴る
 */
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }

const TAG = Date.now().toString().slice(-4)

// AudioContextの発振器に渡された周波数を記録するフック。
// 実際に音が鳴った/鳴らなかったを見た目に頼らず確認するため、ページ読み込み前に仕込む
const AUDIO_SPY = `
  window.__beeps = []
  const OrigOsc = window.OscillatorNode
  const origCreateOscillator = AudioContext.prototype.createOscillator
  AudioContext.prototype.createOscillator = function (...args) {
    const osc = origCreateOscillator.apply(this, args)
    const origSet = osc.frequency.setValueAtTime.bind(osc.frequency)
    osc.frequency.setValueAtTime = (value, time) => {
      window.__beeps.push(value)
      return origSet(value, time)
    }
    return osc
  }
`

async function enter(browser, name) {
  const ctx = await browser.newContext({
    permissions: ['camera', 'microphone'], viewport: { width: 1400, height: 900 },
  })
  await ctx.addInitScript(AUDIO_SPY)
  const p = await ctx.newPage()
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

const registerStamp = async (p, name) => {
  await p.evaluate(() => window.__store.dispatch({ type: 'stamp/openStampManager' }))
  await p.waitForSelector('text=スタンプを管理', { timeout: 10000 })
  await wait(600)
  // 明確な縦横比(200x100)を持つPNGを用意し、縦横比が保たれているか判定できるようにする
  const png = path.join(__dirname, '..', '_e2e_out', `size-${TAG}.png`)
  // 1x1 PNGだと自然サイズが小さすぎてwidth:autoとの区別が付きにくいので、
  // Canvasで200x100の画像を作ってから使う
  const dataUrl = await p.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 200; c.height = 100
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#ff8800'
    ctx.fillRect(0, 0, 200, 100)
    return c.toDataURL('image/png')
  })
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64')
  fs.writeFileSync(png, buf)
  await p.setInputFiles('input[type="file"][accept="image/png,image/gif,image/webp,image/apng"]', png)
  await wait(700)
  await p.getByLabel('スタンプの名前').fill(name)
  await p.getByRole('button', { name: '登録' }).click()
  await wait(2500)
  await p.getByRole('button', { name: '閉じる' }).click()
  await wait(500)
  try { fs.unlinkSync(png) } catch {}
  return p.evaluate((n) => {
    const st = window.__store.getState().stamp.stamps
    const hit = Object.entries(st).find(([, s]) => s.name === n)
    return hit ? hit[0] : null
  }, name)
}

async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const A = await enter(browser, 'サイズA')
  const B = await enter(browser, 'サイズB')

  const stampName = `サイズ検証${TAG}`
  log('== 準備: 200x100(2:1)の画像でスタンプを登録 ==')
  const stampId = await registerStamp(A, stampName)
  check(!!stampId, 'スタンプを登録できた（検証の前提）', '登録に失敗、以降は判定不能')
  if (!stampId) { await browser.close(); process.exit(1) }
  await wait(1500)

  log('\n== 通常のテキストメッセージを先に送っておく（レイアウト比較用）==')
  const input = A.locator('input[placeholder*="エンター"]').first()
  await input.click()
  await input.fill(`通常メッセージ${TAG}`)
  await A.keyboard.press('Enter')
  await wait(1500)

  const beforeAvatar = await A.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) => /^[A-Za-z]$/.test(d.textContent?.trim() || '') && d.getBoundingClientRect().width > 30 && d.getBoundingClientRect().width < 50)
    return el ? { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null
  })
  log('   通常メッセージのアバターサイズ: ' + JSON.stringify(beforeAvatar))

  log('\n== スタンプを送信する（送信音のフックを仕込んだ状態で）==')
  await A.evaluate(() => { window.__beeps = [] })
  await B.evaluate(() => { window.__beeps = [] })

  await A.locator('[aria-label="stamp"]').click()
  await wait(800)
  await A.locator(`img[alt="${stampName}"]`).first().click()
  await wait(2200)

  log('\n########## 1〜4: サイズとレイアウト ##########')
  const chatBoxWidth = await A.evaluate(() => {
    // ChatBoxはスクロール可能な吹き出しリストの入れ物（overflow-y:auto）
    const boxes = [...document.querySelectorAll('div')].filter((d) => getComputedStyle(d).overflowY === 'auto')
    const box = boxes.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]
    return box ? Math.round(box.getBoundingClientRect().width) : null
  })
  log(`   ChatBoxの実測幅: ${chatBoxWidth}px`)

  const img = await A.evaluate((name) => {
    const el = [...document.querySelectorAll('img')].find((i) => i.alt === name)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), naturalW: el.naturalWidth, naturalH: el.naturalHeight }
  }, stampName)
  log('   スタンプ画像の実測: ' + JSON.stringify(img))
  check(!!img, 'スタンプ画像が見つかった', '画像が見つからない')

  if (img && chatBoxWidth) {
    const halfChatBox = chatBoxWidth * 0.5
    check(img.w <= 200 && img.w >= 160 - 20, `幅が160〜200px程度に収まっている（実測${img.w}px）`, `想定外の幅: ${img.w}px`)
    // ChatBox幅の50%(halfChatBox)がmax-width(180px)を上回る場合は、180px側で頭打ちになるのが正しい挙動
    if (halfChatBox > 180) {
      check(img.w === 180, `ChatBoxの50%(${Math.round(halfChatBox)}px)がmax-widthを超えるため180pxで頭打ちになっている`, `頭打ちになっていない: ${img.w}px`)
    } else {
      const diff = Math.abs(img.w - halfChatBox)
      check(diff <= 4, `ChatBoxの約50%(${Math.round(halfChatBox)}px)になっている（実測${img.w}px）`, `50%になっていない: 期待${Math.round(halfChatBox)}px 実測${img.w}px`)
    }
  }

  if (img) {
    const expectedRatio = img.naturalW / img.naturalH // 200/100 = 2.0
    const actualRatio = img.w / img.h
    log(`   縦横比: 元画像=${expectedRatio.toFixed(2)} 表示=${actualRatio.toFixed(2)}`)
    check(Math.abs(expectedRatio - actualRatio) < 0.05, '縦横比(2:1)が維持されている', `縦横比が崩れている: 元${expectedRatio.toFixed(2)} 表示${actualRatio.toFixed(2)}`)
  }

  log('\n== 通常メッセージ・アバターのレイアウトが崩れていないか ==')
  const afterAvatar = await A.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) => /^[A-Za-z]$/.test(d.textContent?.trim() || '') && d.getBoundingClientRect().width > 30 && d.getBoundingClientRect().width < 50)
    return el ? { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null
  })
  log('   スタンプ送信後のアバターサイズ: ' + JSON.stringify(afterAvatar))
  check(
    !!beforeAvatar && !!afterAvatar && beforeAvatar.w === afterAvatar.w && beforeAvatar.h === afterAvatar.h,
    'アバターのサイズはスタンプ送信の前後で変わらない（レイアウト崩れなし）',
    `アバターサイズが変わった: ${JSON.stringify(beforeAvatar)} → ${JSON.stringify(afterAvatar)}`
  )

  const normalBubbleOk = await A.evaluate((tag) => {
    const el = [...document.querySelectorAll('div')].find((d) => d.textContent.trim() === `通常メッセージ${tag}` && d.children.length === 0)
    if (!el) return null
    const st = getComputedStyle(el)
    return { hasBg: st.backgroundColor !== 'rgba(0, 0, 0, 0)', w: Math.round(el.getBoundingClientRect().width) }
  }, TAG)
  log('   通常メッセージの吹き出し状態: ' + JSON.stringify(normalBubbleOk))
  check(!!normalBubbleOk?.hasBg, '通常メッセージの吹き出しは今までどおり表示されている', '通常メッセージの吹き出しが崩れている')

  await A.screenshot({ path: '_e2e_out/stamp-size.png' })

  log('\n########## 5: 送信音（ポン）##########')
  await wait(500)
  const beepsA = await A.evaluate(() => window.__beeps)
  const beepsB = await B.evaluate(() => window.__beeps)
  log('   Aで鳴った周波数: ' + JSON.stringify(beepsA))
  log('   Bで鳴った周波数: ' + JSON.stringify(beepsB))

  // playStampSound = beep(700, 1050, ...) なので 700 が最初の周波数として記録されるはず。
  // playChatSound(560,640)しか鳴っていない場合はスタンプ用の音に置き換わっていない
  check(beepsA.includes(700), '送信した本人の画面で「ポン」(700Hz始まり)が鳴った', `ポンが鳴っていない: ${JSON.stringify(beepsA)}`)
  check(!beepsA.includes(560), '通常のチャット通知音(560Hz)とは重複して鳴っていない', `通常音も鳴ってしまっている: ${JSON.stringify(beepsA)}`)
  check(beepsB.includes(700), '相手の画面でも「ポン」が鳴った', `相手で鳴っていない: ${JSON.stringify(beepsB)}`)

  log('\n== 通常のテキストメッセージは今までどおりの音のままか（回帰）==')
  await A.evaluate(() => { window.__beeps = [] })
  await input.click()
  await input.fill(`回帰確認${TAG}`)
  await A.keyboard.press('Enter')
  await wait(1500)
  const beepsText = await A.evaluate(() => window.__beeps)
  log('   通常メッセージで鳴った周波数: ' + JSON.stringify(beepsText))
  check(beepsText.includes(560), '通常メッセージは今までどおりの通知音のまま', `通常音が鳴っていない/変わった: ${JSON.stringify(beepsText)}`)

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
