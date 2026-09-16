/**
 * PC(1440px) / タブレット(900px) の作業前ベースラインスクリーンショット
 */
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const OUT = path.join(__dirname, '..', '_e2e_out', 'phone-baseline')
const TARGET_URL = process.env.BASELINE_URL || 'https://newoffice2.pages.dev/'

async function capture(viewport, filename, hasTouch) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport,
    hasTouch: !!hasTouch,
    isMobile: !!hasTouch,
    userAgent: hasTouch
      ? 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'
      : undefined,
  })
  const page = await ctx.newPage()
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(3000)
  await page.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await page.waitForTimeout(8000)
  const nameInput = page.getByRole('textbox', { name: '名前' })
  if (await nameInput.isVisible().catch(() => false)) {
    await nameInput.fill('baseline')
    await page.getByRole('button', { name: '入室する' }).click({ force: true })
    await page.waitForTimeout(12000)
  }
  await page.screenshot({ path: path.join(OUT, filename), fullPage: false })
  await browser.close()
  console.log('saved', filename, viewport)
}

async function captureRegression(label) {
  await capture({ width: 1440, height: 900 }, `${label}-pc-1440x900.png`, false)
  await capture({ width: 900, height: 1200 }, `${label}-tablet-900x1200.png`, true)
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const label = process.env.CAPTURE_LABEL || 'baseline'
  if (label === 'baseline') {
    await captureRegression('baseline')
    await capture({ width: 767, height: 1024 }, 'baseline-phone-767x1024.png', true)
    await capture({ width: 667, height: 375 }, 'baseline-phone-667x375.png', true)
  } else {
    await captureRegression(label)
    await capture({ width: 767, height: 1024 }, `${label}-phone-767x1024.png`, true)
    await capture({ width: 667, height: 375 }, `${label}-phone-667x375.png`, true)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
