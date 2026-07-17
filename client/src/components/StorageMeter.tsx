import React, { useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'
import { resolveServerUrl } from '../services/serverUrl'

/**
 * MAPの左下に出す容量メーター。
 *
 * アップロードした画像やPDFはサーバーに溜まり続け、Supabaseの無料枠(1GB)を超えると
 * 新しくアップロードできなくなる。これまでは残量を知る方法が無かったため、
 * 常に見える形で示し、危険域では色と通知で気づけるようにする。
 * クリックすると内訳が開き、大きいものから自分で消せる。
 */

// 何%から色を変えるか。90%まで放置すると気づいたときには手遅れなので早めに警告する
const WARN_PERCENT = 60
const DANGER_PERCENT = 85
const REFRESH_MS = 60000

export interface UsageFile {
  id: string
  name: string
  type: string
  size: number
  created: number
  inUse: boolean
}
export interface Usage {
  limitBytes: number
  usedBytes: number
  docBytes: number
  percent: number
  fileCount: number
  retentionDays: number
  files: UsageFile[]
}

const levelColor = (percent: number) =>
  percent >= DANGER_PERCENT ? '#ff5252' : percent >= WARN_PERCENT ? '#ffb300' : '#3ddc97'

const Wrapper = styled.div`
  position: fixed;
  left: 12px;
  /* 画面下部の操作バー（画面共有・看板を設置…）が下端いっぱいに広がるため、その上に置く */
  bottom: 210px;
  z-index: 900;
  background: rgba(12, 18, 32, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 10px;
  padding: 7px 10px;
  width: 168px;
  color: #dfe6ff;
  font-family: 'Roboto', sans-serif;
  font-size: 11px;
  cursor: pointer;
  backdrop-filter: blur(6px);
  user-select: none;

  &:hover { border-color: rgba(255, 255, 255, 0.4); }
`

const Row = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
  .label { color: #aab4d4; }
  .value { font-weight: 700; }
`

const Bar = styled.div`
  height: 7px;
  background: rgba(255, 255, 255, 0.13);
  border-radius: 4px;
  overflow: hidden;
`
const Fill = styled.div<{ $percent: number }>`
  height: 100%;
  width: ${(p) => Math.max(2, p.$percent)}%;
  background: ${(p) => levelColor(p.$percent)};
  transition: width 0.4s ease, background 0.4s ease;
`

const Toast = styled.div`
  position: fixed;
  left: 12px;
  bottom: 272px;
  z-index: 901;
  width: 260px;
  background: #b3271e;
  color: #fff;
  border-radius: 10px;
  padding: 11px 13px;
  font-size: 12.5px;
  line-height: 1.6;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
  cursor: pointer;
  .t { font-weight: 700; margin-bottom: 3px; }
`

export const fmtSize = (bytes: number) => {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return bytes + ' B'
}

interface Props {
  onOpen: (usage: Usage) => void
  usage: Usage | null
  setUsage: (u: Usage) => void
}

export default function StorageMeter({ onOpen, usage, setUsage }: Props) {
  const [warned, setWarned] = useState(false)
  const [showToast, setShowToast] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(resolveServerUrl('/api/storage-usage'), { cache: 'no-store' })
      if (res.ok) setUsage(await res.json())
    } catch {}
  }, [setUsage])

  useEffect(() => {
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  // 危険域に入ったら一度だけ知らせる。毎回出すと邪魔になるので、
  // 危険域を抜けるまでは繰り返さない
  useEffect(() => {
    if (!usage) return
    if (usage.percent >= DANGER_PERCENT && !warned) {
      setWarned(true)
      setShowToast(true)
    }
    if (usage.percent < DANGER_PERCENT && warned) setWarned(false)
  }, [usage, warned])

  if (!usage) return null

  return (
    <>
      {showToast && (
        <Toast
          onClick={() => { setShowToast(false); onOpen(usage) }}
          title="クリックで内訳を開く"
        >
          <div className="t">⚠️ 保存容量が残りわずかです（{usage.percent}%）</div>
          このままだと画像やファイルをアップロードできなくなります。
          クリックして不要なファイルを消してください。
        </Toast>
      )}
      <Wrapper onClick={() => onOpen(usage)} title="クリックすると内訳が開きます">
        <Row>
          <span className="label">保存容量</span>
          <span className="value" style={{ color: levelColor(usage.percent) }}>
            {usage.percent}%
          </span>
        </Row>
        <Bar>
          <Fill $percent={usage.percent} />
        </Bar>
        <Row style={{ marginTop: 5, marginBottom: 0 }}>
          <span className="label">
            {fmtSize(usage.usedBytes)} / {fmtSize(usage.limitBytes)}
          </span>
          <span className="label">{usage.fileCount}件</span>
        </Row>
      </Wrapper>
    </>
  )
}
