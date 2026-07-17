import React, { useEffect, useState } from 'react'
import styled, { keyframes } from 'styled-components'
import { useAppSelector } from '../hooks'
import { resolveServerUrl } from '../services/serverUrl'
import { clearReconnectIntent } from '../util/reconnect'

/**
 * サーバーから切断されたときの画面。
 *
 * 切断はサーバーの再起動（デプロイ）やRender無料枠のスピンダウン、通信の瞬断で起きる。
 * 多くは十数秒〜1分ほどで復帰するため、黙って待って自動で戻る。
 * 画面内で繋ぎ直すと前のセッションのキャラやWebRTCの残骸が残りやすいので、
 * サーバーの復帰を確かめてから読み込み直す（戻る部屋はutil/reconnectが覚えている）。
 *
 * 「同じブラウザの別タブで開いた」場合だけは自動で戻らない。
 * 戻すと向こうを追い出すことになり、タブ同士で奪い合いになるため。
 */
const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 20000;
  background: rgba(8, 12, 24, 0.82);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
`

const Panel = styled.div`
  background: #1e2438;
  border: 1px solid rgba(140, 170, 255, 0.35);
  border-radius: 14px;
  padding: 26px 30px;
  max-width: 460px;
  color: #e6ebff;
  font-family: 'Roboto', sans-serif;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  text-align: center;

  h2 {
    margin: 0 0 12px;
    font-size: 19px;
    color: #ffd9a0;
  }
  p {
    margin: 0 0 8px;
    font-size: 14px;
    line-height: 1.7;
    color: #c9d2f0;
  }
  .hint {
    font-size: 12px;
    color: #8f9abc;
    margin-top: 12px;
  }
  button {
    margin-top: 18px;
    background: #3ddc97;
    color: #10261c;
    border: none;
    border-radius: 8px;
    padding: 11px 26px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    &:hover { background: #57e8aa; }
  }
`

const spin = keyframes`to { transform: rotate(360deg) }`
const Spinner = styled.div`
  width: 34px;
  height: 34px;
  margin: 4px auto 14px;
  border: 3px solid rgba(255, 255, 255, 0.18);
  border-top-color: #3ddc97;
  border-radius: 50%;
  animation: ${spin} 0.9s linear infinite;
`

// サーバーが戻るまで待つ間隔と、あきらめて手動に切り替えるまでの回数
const RETRY_INTERVAL_MS = 3000
const MAX_TRIES = 20 // 約1分

export default function DisconnectedNotice() {
  const reason = useAppSelector((state) => state.room.disconnectReason)
  const [tries, setTries] = useState(0)
  const [gaveUp, setGaveUp] = useState(false)

  const otherTab = reason === 'other-tab'
  const reconnecting = reason === 'lost' && !gaveUp

  useEffect(() => {
    if (!reconnecting) return
    let cancelled = false

    const attempt = async () => {
      try {
        // サーバーが応答するようになったら読み込み直す（再起動中は失敗し続ける）
        const res = await fetch(resolveServerUrl('/api/storage-status'), { cache: 'no-store' })
        if (!cancelled && res.ok) {
          window.location.reload()
          return
        }
      } catch {}
      if (cancelled) return
      setTries((t) => {
        const next = t + 1
        if (next >= MAX_TRIES) setGaveUp(true)
        return next
      })
    }

    const id = window.setTimeout(attempt, tries === 0 ? 800 : RETRY_INTERVAL_MS)
    return () => { cancelled = true; window.clearTimeout(id) }
  }, [reconnecting, tries])

  if (!reason) return null

  if (otherTab) {
    return (
      <Backdrop>
        <Panel>
          <h2>別のタブで開いたため切断しました</h2>
          <p>
            同じ部屋を別のタブでも開いたため、このタブの接続を切りました。
            キャラクターが二重に現れるのを防ぐため、1つのブラウザにつき1接続にしています。
          </p>
          <p>
            このタブではもう操作できません（看板の設置・削除やチャットも届きません）。
            新しく開いたタブをお使いいただくか、下のボタンでこのタブに戻せます。
          </p>
          <div className="hint">※ 戻すと、今度はもう一方のタブが切断されます</div>
          <button onClick={() => { clearReconnectIntent(); window.location.reload() }}>
            このタブで再接続する
          </button>
        </Panel>
      </Backdrop>
    )
  }

  if (reconnecting) {
    return (
      <Backdrop>
        <Panel>
          <Spinner />
          <h2>再接続しています…</h2>
          <p>
            サーバーとの接続が切れました。復帰し次第、自動で元の部屋に戻ります。
            そのままお待ちください。
          </p>
          <div className="hint">
            サーバーの更新や再起動の直後によく起きます（{tries} 回試行中）
          </div>
        </Panel>
      </Backdrop>
    )
  }

  return (
    <Backdrop>
      <Panel>
        <h2>再接続できませんでした</h2>
        <p>
          しばらく試しましたが、サーバーに繋がりませんでした。
          時間をおいてから再接続してください。
        </p>
        <button onClick={() => window.location.reload()}>再接続する</button>
      </Panel>
    </Backdrop>
  )
}
