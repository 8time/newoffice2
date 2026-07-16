/**
 * ジュークボックスの「みんなのMAPでも流す」トグルの検証。
 *  - ON（既定）でAが曲を選ぶと、BのMAPでも同じ曲が鳴る
 *  - OFFにすると、Bの再生が止まる（自分だけで聴く状態に戻る）
 *  - OFFのままAが別の曲を選んでも、Bには流れない
 *  - 再度ONにすると、いま鳴っている曲がBにも流れ始める
 */
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const OUT_DIR = path.join(__dirname, '..', '_e2e_out')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)
let failed = 0
const check = (cond, ok, ng) => { log(cond ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!cond) failed++ }

async function open(browser) {
  const page = await (await browser.newContext({
    permissions: ['camera', 'microphone'],
    viewport: { width: 1400, height: 900 },
  })).newPage()
  await page.goto('http://localhost:5173')
  await page.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await page.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await page.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await page.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  return page
}

async function login(page, name) {
  await page.locator('input[type="text"]').first().fill(name)
  await page.getByRole('button', { name: '入室する' }).click()
  await page.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(2500)
}

// そのクライアントで実際に音が鳴っているか（Phaserのサウンド状態を見る）
const nowPlaying = (p) => p.evaluate(() => {
  const st = window.__store.getState().jukebox
  return { playing: st.playing, song: st.currentSongName, broadcast: st.broadcast }
})

// mp3のロードに数秒かかるため、再生が始まるまで待つ（固定待ちだとロード中を誤検知する）
async function waitPlaying(page, songName, timeout = 20000) {
  try {
    await page.waitForFunction((expected) => {
      const st = window.__store.getState().jukebox
      return st.playing === true && (!expected || st.currentSongName === expected)
    }, songName, { timeout })
    return true
  } catch {
    return false
  }
}

// UIを介してジュークボックスを開く
async function openJukebox(page) {
  await page.evaluate(() => window.__store.dispatch({ type: 'jukebox/openJukeboxDialog' }))
  await page.waitForSelector('text=BGM JUKEBOX', { timeout: 10000 })
  await wait(800)
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  })

  const A = await open(browser)
  await login(A, 'Aさん')
  const B = await open(browser)
  await login(B, 'Bさん')

  await openJukebox(A)
  await A.screenshot({ path: path.join(OUT_DIR, 'jb-01-toggle-on.png') })

  // ─── 1. 既定ONで、Aが選んだ曲がBでも鳴るか ───
  log('\n== 1. トグルON（既定）: Aが曲を選ぶ ==')
  const initial = await nowPlaying(A)
  check(initial.broadcast === true, 'トグルの既定はON（従来どおり全員に流れる）', `既定がONでない: ${initial.broadcast}`)

  await A.locator('text=SoundHelix Song 1').first().click()
  const aPlays1 = await waitPlaying(A, 'SoundHelix Song 1')
  const bPlays1 = await waitPlaying(B, 'SoundHelix Song 1')
  let a = await nowPlaying(A), b = await nowPlaying(B)
  log(`   A=${JSON.stringify(a)}\n   B=${JSON.stringify(b)}`)
  check(aPlays1, 'Aで曲が再生された', 'Aで再生が始まらない')
  check(bPlays1 && b.song === a.song, 'ONのときBのMAPでも同じ曲が鳴った', 'Bに曲が流れていない')

  // ─── 2. OFFにするとBが止まるか ───
  log('\n== 2. トグルOFF: 自分だけで聴く ==')
  await A.getByRole('checkbox').first().click() // BroadcastRowのSwitchが先頭
  await wait(2500)
  a = await nowPlaying(A); b = await nowPlaying(B)
  log(`   A=${JSON.stringify(a)}\n   B=${JSON.stringify(b)}`)
  check(a.broadcast === false, 'トグルがOFFになった', 'トグルがOFFにならない')
  check(a.playing, 'OFFにしても自分の再生は続いている', '自分の再生まで止まった')
  check(!b.playing, 'OFFにするとBの再生が止まった', 'Bの再生が止まっていない')
  await A.screenshot({ path: path.join(OUT_DIR, 'jb-02-toggle-off.png') })

  // ─── 3. OFFのまま別の曲を選んでもBには流れないか ───
  log('\n== 3. OFFのままAが別の曲を選ぶ ==')
  await A.locator('text=SoundHelix Song 2').first().click()
  const aPlays2 = await waitPlaying(A, 'SoundHelix Song 2')
  await wait(3000) // Bに漏れて届かないことを確かめるための猶予
  a = await nowPlaying(A); b = await nowPlaying(B)
  log(`   A=${JSON.stringify(a)}\n   B=${JSON.stringify(b)}`)
  check(aPlays2, 'Aは新しい曲を再生できている', 'Aが再生できていない')
  check(!b.playing, 'OFFの間はBに流れない', 'OFFなのにBに流れてしまった')

  // ─── 4. 再度ONにすると今の曲がBにも流れ始めるか ───
  log('\n== 4. 再度ON: いま鳴っている曲がBにも流れ始めるか ==')
  await A.getByRole('checkbox').first().click()
  const bPlays2 = await waitPlaying(B, 'SoundHelix Song 2')
  a = await nowPlaying(A); b = await nowPlaying(B)
  log(`   A=${JSON.stringify(a)}\n   B=${JSON.stringify(b)}`)
  check(bPlays2 && b.song === a.song, 'ONに戻すとBでも同じ曲が鳴り始めた', 'ONに戻してもBに流れない')
  await A.screenshot({ path: path.join(OUT_DIR, 'jb-03-toggle-on-again.png') })

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
