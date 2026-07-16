import React from 'react'
import styled from 'styled-components'
import { useAppSelector } from '../hooks'

/**
 * サーバーから切断されたことを知らせる。
 *
 * 特に「同じブラウザの別タブで同じ部屋を開いた」場合、サーバーは古いタブを追い出す
 * （1ブラウザ=1キャラを保つため）。この通知が無いと、古いタブはマップを描き続ける一方で
 * 送信だけが届かず、「看板が置けない・消せない・操作が効かない」という
 * 原因の分からない状態に見えてしまう。理由と復帰方法を明示する。
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

export default function DisconnectedNotice() {
  const reason = useAppSelector((state) => state.room.disconnectReason)
  if (!reason) return null

  const otherTab = reason === 'other-tab'
  return (
    <Backdrop>
      <Panel>
        <h2>{otherTab ? '別のタブで開いたため切断しました' : 'サーバーとの接続が切れました'}</h2>
        {otherTab ? (
          <>
            <p>
              同じ部屋を別のタブでも開いたため、このタブの接続を切りました。
              キャラクターが二重に現れるのを防ぐため、1つのブラウザにつき1接続にしています。
            </p>
            <p>
              このタブではもう操作できません（看板の設置・削除やチャットも届きません）。
              新しく開いたタブをお使いいただくか、下のボタンでこのタブに戻せます。
            </p>
            <div className="hint">※ 戻すと、今度はもう一方のタブが切断されます</div>
          </>
        ) : (
          <p>
            接続が切れました。サーバーの再起動や通信の一時的な不調が考えられます。
            再接続してください。
          </p>
        )}
        <button onClick={() => window.location.reload()}>
          {otherTab ? 'このタブで再接続する' : '再接続する'}
        </button>
      </Panel>
    </Backdrop>
  )
}
