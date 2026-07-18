/**
 * 2つの改善を検証する。
 *  問題1: カメラ・マイク未接続のとき、通話を始める導線が目立つ場所に出る
 *         （以前は左上の小さな英語アラートで気づかれなかった）
 *  問題2: 退社したあと、自動で入り直さない
 *         （以前は再入室の覚え書きが残って自動入室していた）
 */
const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }

const INTENT_KEY = 'skyoffice_reconnect_intent'

async function bootToLobby(p) {
  await p.goto('http://localhost:5173')
  await p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await p.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
}

async function enterPublic(p, name) {
  await p.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await p.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  await p.locator('input[type="text"]').first().fill(name)
  await p.getByRole('button', { name: '入室する' }).click()
  await p.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(2500)
}

async function part1_connectPrompt() {
  log('\n===== 問題1: 通話の接続導線が目立つか（カメラ未接続で確認）=====')
  // フェイクデバイスを渡さず、カメラ権限も与えない → videoConnected=false になる
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ permissions: [], viewport: { width: 1400, height: 900 } })
  const p = await ctx.newPage()
  await bootToLobby(p)
  await enterPublic(p, 'カメラ無A')

  const vc = await p.evaluate(() => window.__store.getState().user.videoConnected)
  log('   videoConnected: ' + vc)
  check(vc === false, 'カメラ未接続の状態を作れた', `videoConnectedがtrueで前提が崩れた: ${vc}`)

  // 目立つ接続カードが出ているか（日本語・大きなボタン）
  const cardVisible = await p.locator('text=近くの人と話すには接続してください').isVisible().catch(() => false)
  check(cardVisible, '「近くの人と話すには接続してください」カードが表示されている', 'カードが出ていない')
  const btnVisible = await p.getByRole('button', { name: 'カメラ・マイクを接続する' }).isVisible().catch(() => false)
  check(btnVisible, '大きな「カメラ・マイクを接続する」ボタンがある', '接続ボタンが見当たらない')

  // カードが画面中央寄り（左上に埋もれていない）か。左端から十分離れていることを見る
  const box = await p.locator('text=近くの人と話すには接続してください').boundingBox().catch(() => null)
  log('   カード位置: ' + JSON.stringify(box && { x: Math.round(box.x), y: Math.round(box.y) }))
  check(!!box && box.x > 200, 'カードが左上ではなく中央寄りに出ている', `左上に寄りすぎ: ${JSON.stringify(box)}`)

  await p.screenshot({ path: '_e2e_out/connect-prompt.png' })

  // 「あとで」で畳むと、常設の小さな「通話をはじめる」ピルが残る（完全には消えない）
  await p.getByRole('button', { name: 'あとで' }).click()
  await wait(500)
  const pillVisible = await p.getByRole('button', { name: '通話をはじめる' }).isVisible().catch(() => false)
  check(pillVisible, '「あとで」で畳んでも「通話をはじめる」ピルが残る', '畳んだら導線が完全に消えた')
  const cardGone = await p.locator('text=近くの人と話すには接続してください').isVisible().catch(() => false)
  check(!cardGone, '畳むと大きいカードは消える', 'カードが消えていない')

  await browser.close()
}

async function part2_exitNoRejoin() {
  log('\n===== 問題2: 退社後に自動入室しないか =====')
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1400, height: 900 } })
  const p = await ctx.newPage()

  // --- まず「覚え書きがあると自動入室する」ことを確認（バグの再現条件）---
  await bootToLobby(p)
  await p.evaluate((k) => sessionStorage.setItem(k, JSON.stringify({ roomKey: null })), INTENT_KEY)
  await p.reload()
  await p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  const autoJoined = await p.waitForFunction(
    () => window.__store?.getState().room.roomJoined === true, { timeout: 15000 }
  ).then(() => true).catch(() => false)
  check(autoJoined, '覚え書きがあると自動入室する（＝この覚え書きが原因）', '前提: 覚え書きで自動入室しなかった')

  // 一旦ちゃんとログインし直して、退社の起点を作る
  await p.evaluate((k) => sessionStorage.removeItem(k), INTENT_KEY)
  await p.reload()
  await bootToLobby(p)
  await enterPublic(p, '退社太郎')
  const beforeExit = await p.evaluate((k) => sessionStorage.getItem(k), INTENT_KEY)
  log('   退社前の覚え書き: ' + beforeExit)

  // --- 退社を実行（退社ゾーンの代わりにダイアログを直接開く）---
  await p.evaluate(() => window.__store.dispatch({ type: 'ui/openExitDialog' }))
  await p.waitForSelector('text=退社しますか？', { timeout: 5000 })
  await p.getByRole('button', { name: '退社する' }).click()

  // reloadが走る。ロビー接続まで待ち、その後 自動入室しない ことを確認する
  await p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  const intentAfter = await p.evaluate((k) => sessionStorage.getItem(k), INTENT_KEY)
  log('   退社後の覚え書き: ' + intentAfter)
  check(!intentAfter, '退社で再入室の覚え書きが消えている', `覚え書きが残っている: ${intentAfter}`)

  // 数秒待っても roomJoined / loggedIn にならない＝ルーム選択画面のまま
  await wait(4000)
  const st = await p.evaluate(() => {
    const s = window.__store.getState()
    return { roomJoined: s.room.roomJoined, loggedIn: s.user.loggedIn }
  })
  log('   退社後の状態: ' + JSON.stringify(st))
  check(!st.roomJoined && !st.loggedIn, '退社後は自動入室せずルーム選択画面のまま', `自動入室してしまった: ${JSON.stringify(st)}`)
  // ルーム選択のボタンが出ていることも確認
  const selectionShown = await p.getByRole('button', { name: 'パブリックロビーに接続' }).isVisible().catch(() => false)
  check(selectionShown, 'ルーム選択画面が表示されている', 'ルーム選択画面が出ていない')

  await p.screenshot({ path: '_e2e_out/exit-no-rejoin.png' })
  await browser.close()
}

async function main() {
  await part1_connectPrompt()
  await part2_exitNoRejoin()
  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
