import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { getDisconnectLog, clearDisconnectLog, codeLabel, formatGap, DisconnectEntry } from '../util/disconnectLog'

/**
 * 接続の切断履歴をページ内で確認するためのパネル。
 * コンソールに入力できない環境でも、左端のタブを押せば履歴を見られる。
 * window.showDisconnectLog() でも開ける。
 */

// 左端中央に出す小さなタブ（上=ビデオ・下=保存容量メーターと被らない位置）
const Tab = styled.button`
  position: fixed;
  left: 0;
  top: 45%;
  z-index: 15000;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  background: rgba(30, 36, 56, 0.9);
  color: #cdd6f4;
  border: 1px solid rgba(140, 170, 255, 0.35);
  border-left: none;
  border-radius: 0 10px 10px 0;
  padding: 8px 6px;
  font-size: 11px;
  cursor: pointer;
  box-shadow: 2px 2px 10px rgba(0, 0, 0, 0.4);
  writing-mode: vertical-rl;
  &:hover { background: rgba(45, 54, 80, 0.95); }

  .badge {
    writing-mode: horizontal-tb;
    background: #e6a23c;
    color: #1a1a1a;
    border-radius: 8px;
    padding: 0 5px;
    font-size: 10px;
    font-weight: 700;
  }
`

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 15001;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
`

const Panel = styled.div`
  width: min(560px, 92vw);
  max-height: 80vh;
  background: #1b2033;
  border: 1px solid rgba(140, 170, 255, 0.4);
  border-radius: 14px;
  color: #e6ebff;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
  overflow: hidden;

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: #232a42;
    border-bottom: 1px solid rgba(140, 170, 255, 0.2);
  }
  header .title { font-weight: 700; font-size: 15px; }
  header .actions { display: flex; gap: 8px; }
  header button {
    background: rgba(255, 255, 255, 0.08);
    color: #cdd6f4;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 7px;
    padding: 5px 10px;
    font-size: 13px;
    cursor: pointer;
  }
  header button:hover { background: rgba(255, 255, 255, 0.16); }

  .body { overflow-y: auto; padding: 8px 12px; }
  .empty { color: #8b93b0; text-align: center; padding: 24px 0; }

  ul { list-style: none; margin: 0; padding: 0; }
  li {
    padding: 9px 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .row1 { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
  .code {
    font-weight: 700;
    font-size: 13px;
    padding: 2px 8px;
    border-radius: 6px;
    background: rgba(230, 162, 60, 0.18);
    color: #ffd28a;
    white-space: nowrap;
  }
  .code.peer { background: rgba(120, 200, 150, 0.18); color: #a6e3c0; }
  .time { color: #aeb6d6; font-size: 12px; }
  .reason { color: #c9d0ee; font-size: 12px; margin-top: 3px; line-height: 1.5; }
  .gap { color: #e6a23c; font-size: 12px; margin-top: 2px; }

  footer {
    padding: 10px 16px;
    font-size: 11px;
    color: #8b93b0;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    line-height: 1.6;
  }
`

export default function DisconnectLogPanel() {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<DisconnectEntry[]>([])

  const refresh = () => setEntries(getDisconnectLog())

  useEffect(() => {
    refresh()
    const openHandler = () => { refresh(); setOpen(true) }
    window.addEventListener('show-disconnect-log', openHandler)
    // コンソールに入力できなくても開けるよう、関数も残しておく
    ;(window as unknown as { showDisconnectLog?: () => void }).showDisconnectLog = () =>
      window.dispatchEvent(new Event('show-disconnect-log'))
    return () => window.removeEventListener('show-disconnect-log', openHandler)
  }, [])

  const openPanel = () => { refresh(); setOpen(true) }

  return (
    <>
      <Tab onClick={openPanel} title="接続の切断履歴を見る">
        接続ログ
        {entries.length > 0 && <span className="badge">{entries.length}</span>}
      </Tab>

      {open && (
        <Overlay onClick={() => setOpen(false)}>
          <Panel onClick={(e) => e.stopPropagation()}>
            <header>
              <span className="title">接続の切断履歴（{entries.length}件）</span>
              <div className="actions">
                <button onClick={refresh}>更新</button>
                <button onClick={() => { clearDisconnectLog(); refresh() }}>消去</button>
                <button onClick={() => setOpen(false)}>閉じる</button>
              </div>
            </header>

            <div className="body">
              {entries.length === 0 ? (
                <p className="empty">まだ切断は記録されていません</p>
              ) : (
                <ul>
                  {entries.map((e, i) => {
                    const prev = i > 0 ? entries[i - 1].t : 0
                    const gap = prev ? Math.round((e.t - prev) / 1000) : null
                    return (
                      <li key={i}>
                        <div className="row1">
                          <span className={`code${e.code === -1 ? ' peer' : ''}`}>
                            {codeLabel(e.code)}（code={e.code}）
                          </span>
                          <span className="time">{new Date(e.t).toLocaleString()}</span>
                        </div>
                        <div className="reason">{e.reason}</div>
                        {gap != null && <div className="gap">前回の切断から {formatGap(gap)}</div>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <footer>
              種別の意味: -1=通話の署名サーバー(PeerJS)切断 / 1006=経路が無言で切断(アイドル切断が濃厚) /
              1001=離脱 / 1011・1012=サーバー側 / 4001=別タブ<br />
              「消去」で履歴をリセットしてから使うと、以降の切断だけを観察できます。
            </footer>
          </Panel>
        </Overlay>
      )}
    </>
  )
}
