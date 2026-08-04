/**
 * 看板(画像)をクリックで選択すると✕削除ボタンが出て、押すと削除確認→削除できるか検証する。
 * canvas座標クリックは不安定なので、実際に登録されたハンドラを直接発火して検証する。
 */
const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }

async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--disable-gpu','--no-sandbox'] })
  const p = await (await browser.newContext({ permissions:['camera','microphone'], viewport:{width:1400,height:900} })).newPage()
  await p.goto('http://localhost:5173', { timeout: 40000 })
  await p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await p.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await p.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await p.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 20000 })
  await wait(2000)
  await p.locator('input[type="text"]').first().fill('削除テスト')
  await p.getByRole('button', { name: '入室する' }).click()
  await p.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(1500)

  // 画像看板を1枚置く
  await p.evaluate(async () => {
    const g = window.game.scene.keys.game
    for (const id of [...g.signboardMap.keys()]) g.network.removeSignboard(id)
    const c = document.createElement('canvas'); c.width=100;c.height=60; const x=c.getContext('2d'); x.fillStyle='#3498db'; x.fillRect(0,0,100,60)
    g.network.addSignboard({ x: 700, y: 600, text:'', image:c.toDataURL('image/png'), url:'' })
  })
  await wait(2500)
  check(await p.evaluate(() => window.game.scene.keys.game.signboardMap.size) === 1, '画像看板を設置できた', '設置できていない')

  log('== 看板を左クリック（選択）→ ✕削除ボタンが出るか ==')
  const afterSelect = await p.evaluate(() => {
    const g = window.game.scene.keys.game
    const c = [...g.signboardMap.values()][0]
    // 実際の左クリックpointerdownハンドラを発火（選択される）
    c.emit('pointerdown', { rightButtonDown: () => false, x: 100, y: 100 })
    return { selected: g.signSelected, delVisible: g.signDeleteButton?.visible, handleVisible: g.signResizeHandle?.visible }
  })
  log('   ' + JSON.stringify(afterSelect))
  check(afterSelect.selected === true, 'クリックで選択状態になる', '選択されない')
  check(afterSelect.delVisible === true, '✕削除ボタンが表示される', '削除ボタンが出ない')
  check(afterSelect.handleVisible === true, 'リサイズつまみも表示される', 'リサイズつまみが出ない')

  log('== ✕削除ボタンを押す → 確認ダイアログ ==')
  await p.evaluate(() => {
    const g = window.game.scene.keys.game
    g.signDeleteButton.emit('pointerdown', { x: 200, y: 200 })
  })
  const dialogShown = await p.getByText('看板を削除しますか').isVisible({ timeout: 3000 }).catch(() => false)
  check(dialogShown, '削除確認ダイアログが出た', 'ダイアログが出ない')
  if (dialogShown) {
    await p.getByRole('button', { name: 'はい・削除' }).click()
    await wait(1500)
    check(await p.evaluate(() => window.game.scene.keys.game.signboardMap.size) === 0, '看板が削除された', 'まだ残っている')
  }

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
