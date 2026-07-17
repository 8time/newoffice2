/**
 * 古いファイルの自動削除を実サーバーで検証する。
 * 削除は取り消せないため、特に「使用中のホワイトボード画像を消さないこと」を必ず確かめる。
 * データファイルは検証後に元へ戻す。
 *  A) 古くて未参照 → 消える
 *  B) 古いがホワイトボードから参照中 → 消えない（これが一番大事）
 *  C) 新しくて未参照 → 消えない
 */
const fs = require('fs'), path = require('path'), { execSync, spawn } = require('child_process')
const ROOT = path.join(__dirname, '..')
const UP = path.join(ROOT, 'server', 'uploads')
const IDX = path.join(UP, 'index.json')
const WB = path.join(ROOT, 'meeting-whiteboards.json')
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const OLD = Date.now() - 60 * 24 * 60 * 60 * 1000  // 60日前
const NEW = Date.now()

// 退避
const bakIdx = fs.readFileSync(IDX, 'utf8')
const bakWb = fs.existsSync(WB) ? fs.readFileSync(WB, 'utf8') : null

const A = 'f_test_old_unused', B = 'f_test_old_used', C = 'f_test_new_unused'
try {
  const idx = JSON.parse(bakIdx)
  for (const [id, created] of [[A, OLD], [B, OLD], [C, NEW]]) {
    fs.writeFileSync(path.join(UP, id), Buffer.from('dummy-' + id))
    idx[id] = { name: id + '.png', type: 'image/png', size: 1000, created }
  }
  fs.writeFileSync(IDX, JSON.stringify(idx))

  // Bだけホワイトボードから参照させる
  const wb = bakWb ? JSON.parse(bakWb) : {}
  wb['cleanup_test_room'] = { elements: [], files: { x1: { id: 'x1', url: '/files/' + B, mimeType: 'image/png' } } }
  fs.writeFileSync(WB, JSON.stringify(wb))

  console.log('仕込み: A=古い未参照 / B=古い参照中 / C=新しい未参照')

  // サーバー再起動（起動時に片付けが走る）
  try {
    const out = execSync('netstat -ano | findstr ":2567" | findstr LISTENING', { encoding: 'utf8' })
    ;[...new Set(out.trim().split('\n').map(l => l.trim().split(/\s+/).pop()))]
      .forEach(pid => { try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' }) } catch {} })
  } catch {}

  const log = path.join(ROOT, '_cleanup_test.log')
  const fd = fs.openSync(log, 'w')
  const p = spawn('npm', ['start'], { cwd: ROOT, shell: true, detached: true, stdio: ['ignore', fd, fd] })
  p.unref()

  ;(async () => {
    for (let i = 0; i < 40; i++) {
      await wait(1000)
      const t = fs.readFileSync(log, 'utf8')
      if (/\[Cleanup\]/.test(t)) break
    }
    await wait(2000)
    const out = fs.readFileSync(log, 'utf8')
    console.log('サーバーlog: ' + (out.match(/\[Cleanup\].*/g) || []).join(' | '))

    const idx2 = JSON.parse(fs.readFileSync(IDX, 'utf8'))
    const exists = (id) => fs.existsSync(path.join(UP, id))
    let failed = 0
    const check = (c, ok, ng) => { console.log(c ? '[PASS] ' + ok : '[FAIL] ' + ng); if (!c) failed++ }

    check(!exists(A) && !idx2[A], 'A: 古くて未参照 → 削除された', 'A: 削除されていない')
    check(exists(B) && !!idx2[B], 'B: 古いが使用中 → 消さずに残した（重要）', 'B: ★使用中を消してしまった')
    check(exists(C) && !!idx2[C], 'C: 新しい → 消さずに残した', 'C: 新しいのに消された')

    // 後片付け
    ;[A, B, C].forEach(id => { try { fs.unlinkSync(path.join(UP, id)) } catch {} })
    fs.writeFileSync(IDX, bakIdx)
    if (bakWb !== null) fs.writeFileSync(WB, bakWb)
    try { fs.unlinkSync(log) } catch {}
    console.log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
    process.exit(failed === 0 ? 0 : 1)
  })()
} catch (e) {
  fs.writeFileSync(IDX, bakIdx); if (bakWb !== null) fs.writeFileSync(WB, bakWb)
  console.error('FATAL', e); process.exit(1)
}
