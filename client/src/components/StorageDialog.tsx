import React, { useState } from 'react'
import styled from 'styled-components'
import { resolveServerUrl } from '../services/serverUrl'
import { fmtSize, Usage, UsageFile } from './StorageMeter'

/**
 * 保存されているファイルの内訳を見て、不要なものを自分で消す画面。
 *
 * 大きいものから並べる（消すなら効果の大きいものから選びたいため）。
 * ホワイトボードで使用中のファイルは消すとダミー画像になって直せないので、
 * 画面上でも消せないようにし、サーバー側でも拒否している。
 */
const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 21000;
  background: rgba(6, 10, 20, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
`
const Panel = styled.div`
  background: #1b2136;
  border: 1px solid rgba(140, 170, 255, 0.3);
  border-radius: 14px;
  width: 620px;
  max-width: 94vw;
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  color: #e6ebff;
  font-family: 'Roboto', sans-serif;
  box-shadow: 0 14px 44px rgba(0, 0, 0, 0.55);
`
const Head = styled.div`
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  justify-content: space-between;
  align-items: center;
  h2 { margin: 0; font-size: 17px; }
  button {
    background: none; border: none; color: #9aa4c8; font-size: 20px; cursor: pointer;
    &:hover { color: #fff; }
  }
`
const Summary = styled.div`
  padding: 12px 20px;
  font-size: 12.5px;
  color: #aab4d4;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  line-height: 1.7;
  b { color: #e6ebff; }
`
const List = styled.div`
  overflow-y: auto;
  padding: 8px 12px;
  flex: 1;
`
const Item = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 8px;
  border-radius: 8px;
  font-size: 13px;
  &:hover { background: rgba(255, 255, 255, 0.05); }

  .name {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .size { color: #9fb0e0; font-variant-numeric: tabular-nums; }
  .date { color: #78829f; font-size: 11px; width: 84px; text-align: right; }
  .used {
    font-size: 10.5px; color: #7fd6a8; border: 1px solid rgba(127, 214, 168, 0.5);
    border-radius: 5px; padding: 1px 5px; white-space: nowrap;
  }
  a { color: #8fb4ff; text-decoration: none; &:hover { text-decoration: underline; } }
`
const DelBtn = styled.button<{ $disabled?: boolean }>`
  background: ${(p) => (p.$disabled ? 'rgba(255,255,255,0.06)' : '#8f2f2f')};
  color: ${(p) => (p.$disabled ? '#6f7793' : '#ffd9d9')};
  border: none;
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 11.5px;
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  white-space: nowrap;
  &:hover { background: ${(p) => (p.$disabled ? 'rgba(255,255,255,0.06)' : '#b03b3b')}; }
`

const dateFmt = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' })

interface Props {
  usage: Usage
  onClose: () => void
  onChanged: () => void
}

export default function StorageDialog({ usage, onClose, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const remove = async (f: UsageFile) => {
    if (f.inUse) return
    if (!window.confirm(`「${f.name}」を削除します。元に戻せません。よろしいですか？`)) return
    setBusy(f.id)
    setError(null)
    try {
      const res = await fetch(resolveServerUrl(`/api/files/${f.id}`), { method: 'DELETE' })
      if (res.status === 409) setError('このファイルは使用中のため削除できません')
      else if (!res.ok) setError('削除に失敗しました')
      else onChanged()
    } catch {
      setError('削除に失敗しました')
    }
    setBusy(null)
  }

  const inUseCount = usage.files.filter((f) => f.inUse).length

  return (
    <Backdrop onMouseDown={onClose}>
      <Panel onMouseDown={(e) => e.stopPropagation()}>
        <Head>
          <h2>保存容量の内訳</h2>
          <button onClick={onClose}>×</button>
        </Head>
        <Summary>
          ファイル <b>{usage.fileCount}件</b> で <b>{fmtSize(usage.usedBytes)}</b> を使用中（上限{' '}
          {fmtSize(usage.limitBytes)} の <b>{usage.percent}%</b>）。
          チャットや看板などの文字データは {fmtSize(usage.docBytes)} です。
          <br />
          大きい順に並んでいます。<b>{usage.retentionDays}日</b>以上前で使われていないものは自動で消えますが、
          すぐ空けたいときはここから消せます。
          {inUseCount > 0 && <>（うち{inUseCount}件はホワイトボードで使用中のため消せません）</>}
          {error && <div style={{ color: '#ff9b9b', marginTop: 6 }}>{error}</div>}
        </Summary>
        <List>
          {usage.files.length === 0 && (
            <div style={{ padding: 20, color: '#8a93b4', fontSize: 13 }}>保存されているファイルはありません</div>
          )}
          {usage.files.map((f) => (
            <Item key={f.id}>
              <span className="name">
                <a href={resolveServerUrl(`/files/${f.id}`)} target="_blank" rel="noreferrer" title={f.name}>
                  {f.name}
                </a>
              </span>
              {f.inUse && <span className="used">使用中</span>}
              <span className="size">{fmtSize(f.size)}</span>
              <span className="date">{dateFmt.format(f.created)}</span>
              <DelBtn
                $disabled={f.inUse || busy === f.id}
                disabled={f.inUse || busy === f.id}
                onClick={() => remove(f)}
                title={f.inUse ? 'ホワイトボードで使用中のため削除できません' : '削除する'}
              >
                {busy === f.id ? '削除中…' : '削除'}
              </DelBtn>
            </Item>
          ))}
        </List>
      </Panel>
    </Backdrop>
  )
}
