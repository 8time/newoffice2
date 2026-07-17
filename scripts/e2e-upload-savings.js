/**
 * 保存容量を減らす2つの仕組みを検証する。
 *  1. アップロード前の画像縮小（大きい写真をそのまま保存しない）
 *  2. 重複排除（同じ内容のファイルは保存し直さず使い回す）
 */
const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }

const SERVER = 'http://localhost:2567'

async function main() {
  const browser = await chromium.launch()
  const p = await (await browser.newContext()).newPage()
  await p.goto('http://localhost:5173')
  await wait(2000)

  log('== 1. アップロード前に画像が縮小されるか ==')
  // 4000x3000 の大きな画像を作り、縮小の有無を比べる
  const r1 = await p.evaluate(async () => {
    const make = async (w, h) => {
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      const ctx = c.getContext('2d')
      // 単色だと圧縮が効きすぎるので、写真らしいノイズを描く
      const img = ctx.createImageData(w, h)
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i] = (i / 97) % 255
        img.data[i + 1] = (i / 31) % 255
        img.data[i + 2] = (i / 13) % 255
        img.data[i + 3] = 255
      }
      ctx.putImageData(img, 0, 0)
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'))
      return new File([blob], 'photo.png', { type: 'image/png' })
    }
    const big = await make(4000, 3000)
    const { shrinkImageFile } = await import('/src/util/imageShrink.ts')
    const small = await shrinkImageFile(big)
    // 縮小後の実寸も確認する
    const bmp = await createImageBitmap(small)
    return {
      beforeBytes: big.size, afterBytes: small.size,
      afterW: bmp.width, afterH: bmp.height, afterType: small.type,
    }
  })
  log(`   ${Math.round(r1.beforeBytes / 1024)}KB (4000x3000) → ${Math.round(r1.afterBytes / 1024)}KB (${r1.afterW}x${r1.afterH}, ${r1.afterType})`)
  check(r1.afterW <= 1600 && r1.afterH <= 1600, '長辺1600px以下に縮小された', `縮小されていない: ${r1.afterW}x${r1.afterH}`)
  check(r1.afterBytes < r1.beforeBytes / 2, `容量が半分以下になった（${Math.round((1 - r1.afterBytes / r1.beforeBytes) * 100)}%削減）`, '容量が減っていない')

  log('\n== 小さい画像は触らない（再エンコードで逆に太らせない）==')
  const r2 = await p.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 100; c.height = 80
    c.getContext('2d').fillRect(0, 0, 100, 80)
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'))
    const f = new File([blob], 'small.png', { type: 'image/png' })
    const { shrinkImageFile } = await import('/src/util/imageShrink.ts')
    const out = await shrinkImageFile(f)
    return { same: out === f, before: f.size, after: out.size }
  })
  log(`   ${r2.before}B → ${r2.after}B (そのまま: ${r2.same})`)
  check(r2.after <= r2.before, '小さい画像は太らせない', `太った: ${r2.before}→${r2.after}`)

  log('\n== 2. 同じ内容のファイルは使い回すか ==')
  const before = await (await fetch(`${SERVER}/api/storage-usage`)).json()
  const r3 = await p.evaluate(async (server) => {
    const body = new Uint8Array(60000).map((_, i) => (i * 7) % 251)
    const send = async (name) => {
      const form = new FormData()
      form.append('file', new Blob([body], { type: 'application/octet-stream' }), name)
      const res = await fetch(server + '/api/files', { method: 'POST', body: form })
      return res.json()
    }
    const a = await send('dup-a.bin')
    const b = await send('dup-b.bin') // 中身は同じ
    return { a: a.id, b: b.id, size: a.size }
  }, SERVER)
  await wait(1200)
  const after = await (await fetch(`${SERVER}/api/storage-usage`)).json()
  log(`   1回目: ${r3.a}\n   2回目: ${r3.b}`)
  log(`   ファイル数: ${before.fileCount} → ${after.fileCount} / 使用量の増加: ${Math.round((after.usedBytes - before.usedBytes) / 1024)}KB`)
  check(r3.a === r3.b, '2回目は同じファイルが返された（保存し直していない）', `別々に保存された: ${r3.a} vs ${r3.b}`)
  check(after.fileCount === before.fileCount + 1, '2回送ってもファイルは1つしか増えない', `${after.fileCount - before.fileCount}件増えた`)

  log('\n== 中身が違えば別ファイルとして保存されるか ==')
  const r4 = await p.evaluate(async (server) => {
    const send = async (name, seed) => {
      const body = new Uint8Array(50000).map((_, i) => (i * seed) % 251)
      const form = new FormData()
      form.append('file', new Blob([body], { type: 'application/octet-stream' }), name)
      return (await fetch(server + '/api/files', { method: 'POST', body: form })).json()
    }
    const a = await send('x.bin', 3)
    const b = await send('y.bin', 11)
    return { a: a.id, b: b.id }
  }, SERVER)
  check(r4.a !== r4.b, '中身が違うファイルはちゃんと別々に保存された', '★別の内容が同じ扱いにされた')

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
