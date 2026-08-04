// colyseus.js で本番(Tunnel経由)へ直接join。プロトコルが通るか純粋に検証。
const { Client } = require('colyseus.js')
const log = console.log
async function tryJoin(label, method, roomName) {
  const client = new Client('wss://colyseus.8timeworks.com')
  log(`\n== ${label}: ${method}('${roomName}') ==`)
  const t = Date.now()
  try {
    const room = await Promise.race([
      client[method](roomName, { clientId: 'nodetest_' + Date.now() }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT 15s')), 15000)),
    ])
    log(`   [OK] joined roomId=${room.id} sessionId=${room.sessionId} (${Date.now()-t}ms)`)
    room.onLeave((code) => log(`   [onLeave] code=${code}`))
    await new Promise((r) => setTimeout(r, 3000))
    log(`   3秒後も接続維持: connection.isOpen=${room.connection?.isOpen}`)
    room.leave()
    return true
  } catch (e) {
    log(`   [FAIL] ${e.message || e} (${Date.now()-t}ms)`)
    return false
  }
}
async function main() {
  await tryJoin('ロビー', 'joinOrCreate', 'lobby')
  await tryJoin('パブリック', 'joinOrCreate', 'skyoffice')
  process.exit(0)
}
main().catch((e) => { log('FATAL ' + e); process.exit(1) })
