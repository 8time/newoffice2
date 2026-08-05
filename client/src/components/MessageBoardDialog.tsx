import React, { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { useAppDispatch, useAppSelector } from '../hooks'
import { closeBoardDialog } from '../stores/BoardStore'
import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'

const CONTENT_MAX = 33 // 1マスに縦書き3行で収まる文字数（サーバー上限60より小さければOK）
const NAME_MAX = 16

// 伝言板の字体（各自の表示設定。端末に保存する）
const LS_FONT = 'board_font'
const FONT_STD = "'Yu Gothic', 'Hiragino Sans', 'M PLUS 1p', sans-serif"
// Chalk JP を先頭に。無い漢字や未配置時はゴシックへ自動フォールバック
const FONT_CHALK = "'Chalk JP', 'Yu Gothic', 'Hiragino Sans', 'M PLUS 1p', sans-serif"
type BoardFont = 'standard' | 'chalk'
function loadFont(): BoardFont {
  return (typeof localStorage !== 'undefined' && localStorage.getItem(LS_FONT)) === 'chalk' ? 'chalk' : 'standard'
}

// チョークの色（駅の伝言板っぽく、書き込みごとに色を変える）
const CHALK_COLORS = ['#f4f4f0', '#ffe27a', '#ff9ec4', '#9be59b', '#8fd3ff', '#ffb27a']
function colorFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return CHALK_COLORS[h % CHALK_COLORS.length]
}
function mmdd(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 16000;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`

const Board = styled.div<{ $font: BoardFont }>`
  width: min(1200px, 96vw);
  height: min(680px, 92vh);
  background: #21402f;
  background-image:
    radial-gradient(circle at 25% 15%, rgba(255,255,255,0.05), transparent 55%),
    radial-gradient(circle at 75% 85%, rgba(255,255,255,0.04), transparent 55%);
  border: 14px solid #7a5a34;
  border-radius: 8px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), inset 0 0 80px rgba(0,0,0,0.4);
  color: #f4f4f0;
  font-family: ${(p) => (p.$font === 'chalk' ? FONT_CHALK : FONT_STD)};
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
`

const TopBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 20px;
  flex-shrink: 0;
  border-bottom: 2px solid rgba(255, 255, 255, 0.35);

  .title {
    font-size: 30px;
    font-weight: 700;
    letter-spacing: 16px;
    text-indent: 16px;
  }
  .right { display: flex; align-items: center; gap: 14px; }
  .font-toggle {
    display: flex; align-items: center; gap: 4px;
    font-size: 13px; color: rgba(255,255,255,0.75);
    button {
      background: none; border: 1px solid rgba(255,255,255,0.35); color: #f4f4f0;
      border-radius: 5px; padding: 3px 9px; cursor: pointer; font-size: 13px;
      &:hover { background: rgba(255,255,255,0.1); }
      &.on { background: rgba(255,255,255,0.9); color: #1a3326; font-weight: 700; border-color: transparent; }
    }
  }
  .month {
    font-size: 22px; font-weight: 700;
    border: 2px solid rgba(255,255,255,0.6); border-radius: 6px;
    padding: 2px 10px;
  }
  .close {
    background: none; border: 1px solid rgba(255,255,255,0.4); color: #f4f4f0;
    border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 14px;
    &:hover { background: rgba(255,255,255,0.12); }
  }
`

// 右から並べ、増えると左へ流れる（横スクロール）。列は右端から詰める。
const Columns = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
  justify-content: flex-end; /* 少ないときは右に寄せる（＝右から書く） */
  align-items: stretch;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0;

  &::-webkit-scrollbar { height: 8px; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.25); border-radius: 4px; }
`

const Empty = styled.div`
  flex: 1; display: flex; align-items: center; justify-content: center;
  color: rgba(255,255,255,0.55); font-size: 16px;
`

const Column = styled.div<{ chalk: string }>`
  position: relative;
  flex: 0 0 auto;
  width: 122px; /* 縦書き3行ぶんの幅 */
  border-left: 1px solid rgba(255, 255, 255, 0.28); /* 区切り線 */
  padding: 8px 6px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  &:last-child { border-right: 1px solid rgba(255, 255, 255, 0.28); }

  &:hover .del { opacity: 1; }

  .date {
    writing-mode: horizontal-tb;
    font-size: 15px;
    color: ${(p) => p.chalk};
    opacity: 0.8;
    margin-bottom: 6px;
  }
  .body {
    writing-mode: vertical-rl;
    -webkit-writing-mode: vertical-rl;
    text-orientation: upright;
    -webkit-text-orientation: upright;
    flex: 1;
    min-height: 0;
    width: 100%;          /* 幅いっぱい＝最大3行。これを超える分は隠す */
    font-size: 24px;
    line-height: 1.42;    /* 縦書きでは行同士の横間隔。3行が幅に収まるよう調整 */
    letter-spacing: 2px;
    color: ${(p) => p.chalk};
    overflow: hidden;     /* はみ出してもレイアウトを崩さない */
    white-space: pre-wrap;
    word-break: break-all;
    text-shadow: 0 0 1px rgba(0,0,0,0.5);
  }
  .name {
    writing-mode: vertical-rl;
    -webkit-writing-mode: vertical-rl;
    text-orientation: upright;
    -webkit-text-orientation: upright;
    margin-top: 10px;
    font-size: 19px;
    color: ${(p) => p.chalk};
    opacity: 0.95;
    max-height: 32%;
    overflow: hidden;
  }
  .del {
    position: absolute; top: 2px; right: 2px;
    opacity: 0; transition: opacity 0.12s;
    background: rgba(120, 20, 20, 0.85); color: #fff; border: none;
    width: 18px; height: 18px; border-radius: 50%; font-size: 12px; line-height: 1;
    cursor: pointer;
    &:hover { background: #d33; }
  }
`

const Composer = styled.div`
  flex-shrink: 0;
  border-top: 2px solid rgba(255, 255, 255, 0.35);
  padding: 10px 18px;
  display: flex;
  gap: 10px;
  align-items: flex-start;
  flex-wrap: wrap;

  textarea {
    flex: 1;
    min-width: 220px;
    height: 58px;
    resize: none;
    background: rgba(0,0,0,0.22);
    color: #f4f4f0;
    border: 1px solid rgba(255,255,255,0.3);
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 22px;
    line-height: 1.4;
    font-family: inherit;
  }
  input.name {
    width: 150px;
    background: rgba(0,0,0,0.22);
    color: #f4f4f0;
    border: 1px solid rgba(255,255,255,0.3);
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 20px;
  }
  .count { font-size: 15px; color: rgba(255,255,255,0.7); align-self: center; }
  button.write {
    background: #3ddc97; color: #10261c; border: none; border-radius: 8px;
    padding: 12px 22px; font-size: 18px; font-weight: 700; cursor: pointer;
    &:hover { filter: brightness(1.08); }
    &:disabled { opacity: 0.5; cursor: default; }
  }
`

export default function MessageBoardDialog() {
  const dispatch = useAppDispatch()
  const open = useAppSelector((s) => s.board.dialogOpen)
  const messages = useAppSelector((s) => s.board.messages)
  const myName = useAppSelector((s) => s.user.playerName) || ''

  const [content, setContent] = useState('')
  const [name, setName] = useState('')
  const [font, setFont] = useState<BoardFont>(loadFont)
  const columnsRef = useRef<HTMLDivElement>(null)

  const chooseFont = (f: BoardFont) => {
    setFont(f)
    try {
      localStorage.setItem(LS_FONT, f)
    } catch {
      /* 保存できなくても表示は切り替わる */
    }
  }

  const getNetwork = () => (phaserGame.scene.keys.game as Game)?.network

  // 開いたら署名を自分の名前で初期化
  useEffect(() => {
    if (open) setName((n) => n || myName)
  }, [open, myName])

  // 開いたとき・新しい書き込みが来たとき、右端（最新）へスクロール
  useEffect(() => {
    if (!open) return
    const el = columnsRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [open, messages.length])

  if (!open) return null

  const write = () => {
    const c = content.trim()
    if (!c) return
    getNetwork()?.addBoardMessage((name.trim() || myName || '名無し').slice(0, NAME_MAX), c.slice(0, CONTENT_MAX))
    setContent('')
  }

  const remove = (id: string) => {
    if (!window.confirm('この伝言を消しますか？')) return
    getNetwork()?.removeBoardMessage(id)
  }

  const month = new Date().getMonth() + 1

  return (
    <Backdrop onClick={() => dispatch(closeBoardDialog())}>
      <Board $font={font} onClick={(e) => e.stopPropagation()}>
        <TopBar>
          <span className="title">伝言板</span>
          <span className="right">
            <span className="font-toggle" title="自分の画面の字体（端末に保存されます）">
              字体
              <button className={font === 'standard' ? 'on' : ''} onClick={() => chooseFont('standard')}>標準</button>
              <button className={font === 'chalk' ? 'on' : ''} onClick={() => chooseFont('chalk')}>チョーク</button>
            </span>
            <span className="month">{month}月</span>
            <button className="close" onClick={() => dispatch(closeBoardDialog())}>閉じる</button>
          </span>
        </TopBar>

        {messages.length === 0 ? (
          <Empty>まだ伝言はありません。下の欄から書き込んでみてください。</Empty>
        ) : (
          <Columns ref={columnsRef}>
            {messages.map((m) => (
              <Column key={m.id} chalk={colorFor(m.id)}>
                <button className="del" title="消す" onClick={() => remove(m.id)}>×</button>
                <div className="date">{mmdd(m.createdAt)}</div>
                <div className="body">{m.content}</div>
                <div className="name">{m.name}</div>
              </Column>
            ))}
          </Columns>
        )}

        <Composer>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value.slice(0, CONTENT_MAX))}
            placeholder="伝言を書く（縦書きで表示されます。日付は自動）"
            maxLength={CONTENT_MAX}
          />
          <input
            className="name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
            placeholder="署名"
            maxLength={NAME_MAX}
          />
          <span className="count">{content.length}/{CONTENT_MAX}</span>
          <button className="write" onClick={write} disabled={!content.trim()}>書き込む</button>
        </Composer>
      </Board>
    </Backdrop>
  )
}
