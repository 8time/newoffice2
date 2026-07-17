/**
 * 会議室の左のメモ欄（リッチテキスト）を検証する。
 * ツールバー: ＋ / T（見出し・装飾・文字色）/ 箇条書き / 番号付き / チェック
 *  - 書式が「記号」ではなく実際の見た目に反映されるか
 *  - 文字色が付くか
 *  - 相手にも同じ見た目で届くか
 *  - 危険なHTMLが混ざっても取り除かれるか（内容は全員に配信されるため）
 */
const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }

async function enter(browser, name) {
  const p = await (await browser.newContext({
    permissions: ['camera', 'microphone'], viewport: { width: 1600, height: 950 },
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
  // 前回の実行で残ったメモを消しておく（残っていると判定が汚れる）
  await p.evaluate(() => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('skyoffice_meeting_doc_'))
      .forEach((k) => localStorage.removeItem(k))
  })
  await p.evaluate(() => {
    const g = window.game.scene.keys.game
    g.myPlayer.setPosition(473, 440)
    g.myPlayer.playerContainer.setPosition(473, 410)
  })
  await p.waitForFunction(() => window.__store.getState().meetingRoom.activeRoom !== null, { timeout: 20000 })
  await wait(4000)
  return p
}

const ed = (p) => p.locator('[contenteditable]').first()
const html = (p) => p.evaluate(() => document.querySelector('[contenteditable]').innerHTML)
const clear = async (p) => {
  await ed(p).click()
  await p.keyboard.press('Control+a')
  await p.keyboard.press('Delete')
  await wait(300)
}

async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const A = await enter(browser, 'メモA')
  // 前回の内容（localStorage・サーバー両方）が残っていると判定が汚れるので、空にしてから始める
  await clear(A)
  await wait(2000)
  const initial = await html(A)
  if (initial.replace(/<br>|<div>|<\/div>|\s/g, '') !== '') {
    log('   ※ 前回の内容が残っています: ' + JSON.stringify(initial))
  }

  log('== 見出し（Tメニュー）==')
  await clear(A)
  await ed(A).type('タイトル')
  await A.getByTitle('文字のスタイル', { exact: true }).click(); await wait(500)
  await A.locator('text=見出し2').click(); await wait(700)
  let h = await html(A)
  log('   ' + JSON.stringify(h))
  check(/<h2>/i.test(h), '見出しが実際のH2になった（記号ではない）', `H2になっていない: ${h}`)

  // 中身と選択範囲をこちらで確定させてから書式を試す。
  // （前回の内容が残っていると判定できないため、毎回この形に揃える）
  const setAndSelectAll = async (p, text) => {
    await p.evaluate((t) => {
      const el = document.querySelector('[contenteditable]')
      el.innerHTML = `<div>${t}</div>`
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      // エディタ側に「今の選択」を覚えさせる
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    }, text)
    await wait(500)
  }

  log('\n== 文字色 ==')
  await setAndSelectAll(A, '色のテスト')
  await A.getByTitle('文字のスタイル', { exact: true }).click(); await wait(500)
  await A.getByTitle('赤', { exact: true }).click(); await wait(700)
  h = await html(A)
  log('   ' + JSON.stringify(h))
  check(/color:\s*(rgb\(224,\s*49,\s*49\)|#e03131)/i.test(h), '選択した文字に赤色が付いた', `色が付いていない: ${h}`)

  log('\n== 太字 ==')
  await setAndSelectAll(A, '太字のテスト')
  await A.getByTitle('文字のスタイル', { exact: true }).click(); await wait(500)
  await A.getByTitle('太字', { exact: true }).click(); await wait(700)
  h = await html(A)
  log('   ' + JSON.stringify(h))
  check(/font-weight|<b>|<strong>/i.test(h), '選択した文字が太字になった', `太字になっていない: ${h}`)

  log('\n== 箇条書き・番号付き・チェック ==')
  await clear(A); await ed(A).type('項目'); await wait(300)
  await A.getByTitle('箇条書きリスト', { exact: true }).click(); await wait(600)
  check(/<ul[^>]*>[\s\S]*<li/i.test(await html(A)), '箇条書きリストになった', `違う: ${await html(A)}`)

  await clear(A); await ed(A).type('項目'); await wait(300)
  await A.getByTitle('番号付きリスト', { exact: true }).click(); await wait(600)
  check(/<ol[^>]*>[\s\S]*<li/i.test(await html(A)), '番号付きリストになった', `違う: ${await html(A)}`)

  await clear(A); await ed(A).type('やること'); await wait(300)
  await A.getByTitle('チェックリスト', { exact: true }).click(); await wait(600)
  h = await html(A)
  log('   ' + JSON.stringify(h))
  check(/data-check/i.test(h), 'チェックリストになった', `違う: ${h}`)

  log('\n== チェックの印を押すと済/未が切り替わるか ==')
  const li = A.locator('ul[data-check] li').first()
  const box = await li.boundingBox()
  if (box) {
    await A.mouse.click(box.x + 10, box.y + box.height / 2)
    await wait(600)
    check(/data-done="1"/.test(await html(A)), 'チェックを付けられた', `付かない: ${await html(A)}`)
  } else {
    check(false, '', 'チェック項目が見つからない')
  }

  log('\n== 相手にも同じ見た目で届くか ==')
  const B = await enter(browser, 'メモB')
  await wait(3000)
  const hb = await html(B)
  log('   B側: ' + JSON.stringify(hb))
  check(/data-check/i.test(hb), '相手の画面にも書式付きで届いた', `届いていない: ${hb}`)

  log('\n== 危険なHTMLが取り除かれるか（全員に配信されるため）==')
  await A.evaluate(() => {
    const el = document.querySelector('[contenteditable]')
    el.innerHTML = '<img src=x onerror="window.__XSS=1"><b>安全な文字</b>'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await wait(2500)
  const saved = await A.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('skyoffice_meeting_doc_'))
    return localStorage.getItem(k)
  })
  log('   保存された内容: ' + JSON.stringify(saved))
  check(!/onerror|<script|<img/i.test(saved || ''), '危険なタグ・属性が取り除かれた', `★危険なHTMLが残った: ${saved}`)
  check(/安全な文字/.test(saved || ''), '通常の文字は残っている', '文字まで消えた')
  await A.screenshot({ path: '_e2e_out/doc-richtext.png' })

  // 検証で入れた内容を残すと次回の判定を汚すため片付ける
  await clear(A)
  await wait(1500)

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
