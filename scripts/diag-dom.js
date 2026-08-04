const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const ctx = await browser.newContext({ permissions: ['camera','microphone'], viewport: { width: 1200, height: 800 } })
  const p = await ctx.newPage()
  await p.goto('https://newoffice2.pages.dev', { waitUntil: 'domcontentloaded' })
  // window.game(本番でも公開)でpreload完了を待つ
  await p.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 40000 }).catch(()=>log('preload待ちタイムアウト'))
  log('1) ルーム選択画面: ' + (await p.getByRole('button', { name: 'パブリックロビーに接続' }).isVisible().catch(()=>false)))
  await p.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  // 名前入力画面が出るか（DOMで判定）
  const nameShown = await p.getByRole('button', { name: '入室する' }).waitFor({ timeout: 15000 }).then(()=>true).catch(()=>false)
  log('2) 名前入力画面(入室するボタン)が出た: ' + nameShown)
  if (nameShown) {
    await p.locator('input[type="text"]').first().fill('DOM診断')
    await p.getByRole('button', { name: '入室する' }).click()
    // オフィス画面(サイドバーの「チャット」)が出るか
    const inOffice = await p.getByText('チャット', { exact: false }).first().waitFor({ timeout: 20000 }).then(()=>true).catch(()=>false)
    log('3) オフィス入室(チャット表示): ' + inOffice)
    // 別タブ切断の通知が出ていないか
    const kicked = await p.getByText('別のタブで開いたため').isVisible().catch(()=>false)
    log('   別タブ切断通知が出ている: ' + kicked)
    await wait(2000)
    await p.screenshot({ path: '_e2e_out/prod-dom.png' })
  }
  await browser.close()
}
main().catch((e)=>{log('FATAL '+e); process.exit(1)})
