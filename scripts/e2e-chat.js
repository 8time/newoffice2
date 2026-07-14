/**
 * チャットのPDF送信とYouTubeプレビューを2ブラウザで検証する。
 *  - AがPDFを送る → Bで受信し、リンクが data: ではなくサーバーURLになっているか
 *  - そのURLが実際にPDFとして開けるか（Content-Type / Content-Disposition: inline）
 *  - AがYouTubeのURLを送る → Bの吹き出しにプレイヤー(iframe)が出るか
 */
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const OUT_DIR = path.join(__dirname, '..', '_e2e_out')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

async function open(browser, name) {
  const page = await (await browser.newContext({
    permissions: ['camera', 'microphone'],
    viewport: { width: 1500, height: 950 },
  })).newPage()
  await page.goto('http://localhost:5173')
  await page.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await page.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await page.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await page.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  await page.locator('input[type="text"]').first().fill(name)
  await page.getByRole('button', { name: '入室する' }).click()
  await page.waitForSelector('text=チャット', { timeout: 20000 })
  return page
}

// 最小構成の本物のPDFを生成する
function makePdf(file) {
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 60>>stream
BT /F1 20 Tf 40 100 Td (E2E PDF TEST) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>`
  fs.writeFileSync(file, pdf, 'latin1')
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const pdfPath = path.join(OUT_DIR, 'e2e.pdf')
  makePdf(pdfPath)

  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  })
  const A = await open(browser, 'Aさん')
  const B = await open(browser, 'Bさん')
  await wait(1500)

  // ─── テスト1: PDF送信 ───
  log('== テスト1: PDFの送信 ==')
  await A.locator('input[type="file"]').first().setInputFiles(pdfPath)
  await wait(4000)

  const bPdf = await B.evaluate(() => {
    const links = [...document.querySelectorAll('a')].filter((a) => a.textContent.includes('PDFを開く'))
    const iframes = [...document.querySelectorAll('iframe.pdf-preview')]
    return {
      linkCount: links.length,
      href: links[0]?.href || null,
      previewCount: iframes.length,
    }
  })
  log(`   B側: リンク=${bPdf.linkCount}個 プレビュー=${bPdf.previewCount}個`)
  log(`   href=${(bPdf.href || '').slice(0, 80)}`)

  if (!bPdf.href) {
    log('[FAIL] BにPDFのリンクが出ていない')
  } else if (bPdf.href.startsWith('data:')) {
    log('[FAIL] まだdata: URLのまま（ブラウザが別タブで開けない）')
  } else {
    log('[PASS] BのPDFリンクがサーバーURLになっている（別タブで開ける形式）')
    // 実際にそのURLを開いてPDFとして配信されるか確認
    const res = await B.request.get(bPdf.href)
    const ct = res.headers()['content-type'] || ''
    const cd = res.headers()['content-disposition'] || ''
    log(`   応答: ${res.status()} Content-Type=${ct} Content-Disposition=${cd}`)
    log(res.ok() && ct.includes('application/pdf') && cd.startsWith('inline')
      ? '[PASS] PDFがinlineで配信されている（ダウンロードではなくブラウザ内で表示される）'
      : '[FAIL] PDFとして正しく配信されていない')
    log(bPdf.previewCount > 0 ? '[PASS] チャット内にPDFのプレビューが出ている' : '[FAIL] プレビューが出ていない')
  }
  await B.screenshot({ path: path.join(OUT_DIR, 'chat-01-B-pdf.png') })

  // ─── テスト2: YouTubeプレビュー ───
  log('\n== テスト2: YouTubeのURLプレビュー ==')
  const ytUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  await A.locator('input[placeholder="エンターキーでチャット"]').fill(`これ見て ${ytUrl}`)
  await A.keyboard.press('Enter')
  await wait(3000)

  const bYt = await B.evaluate(() => {
    const iframes = [...document.querySelectorAll('iframe')].filter((f) => f.src.includes('youtube'))
    const links = [...document.querySelectorAll('a')].filter((a) => a.href.includes('youtube.com/watch'))
    return { embeds: iframes.map((f) => f.src), linkCount: links.length }
  })
  log(`   B側: 埋め込み=${bYt.embeds.length}個 リンク=${bYt.linkCount}個`)
  if (bYt.embeds.length > 0) log(`   src=${bYt.embeds[0]}`)
  log(bYt.embeds.length > 0 && bYt.embeds[0].includes('youtube-nocookie.com/embed/dQw4w9WgXcQ')
    ? '[PASS] Bの吹き出しにYouTubeプレイヤーが埋め込まれている'
    : '[FAIL] YouTubeプレビューが出ていない')
  log(bYt.linkCount > 0 ? '[PASS] URLがクリック可能なリンクになっている' : '[FAIL] リンク化されていない')

  await B.screenshot({ path: path.join(OUT_DIR, 'chat-02-B-youtube.png') })
  log(`\nスクリーンショット: ${OUT_DIR}`)
  await browser.close()
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
