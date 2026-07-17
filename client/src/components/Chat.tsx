import React, { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import styled from 'styled-components'
import Box from '@mui/material/Box'
import Fab from '@mui/material/Fab'
import IconButton from '@mui/material/IconButton'
import InputBase from '@mui/material/InputBase'
import InsertEmoticonIcon from '@mui/icons-material/InsertEmoticon'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import CloseIcon from '@mui/icons-material/Close'
import 'emoji-mart/css/emoji-mart.css'
import { Picker } from 'emoji-mart'
import * as XLSX from 'xlsx'

import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'

import { useAppDispatch, useAppSelector } from '../hooks'
import { MessageType, FileAttachment, setFocused, setShowChat, pushFileMessage } from '../stores/ChatStore'
import { playChatSound, playStampSound } from '../util/sound'
import { resolveServerUrl } from '../services/serverUrl'
import { shrinkImageFile } from '../util/imageShrink'
import { isEmojiOnlyMessage, parseStampMessage, buildStampMessage } from '../util/stampMode'
import { Stamp } from '../stores/StampStore'
import StampPicker from './StampPicker'
import StickyNote2Icon from '@mui/icons-material/StickyNote2'
import ChatMessageContent from './ChatMessageContent'

// ─── 吹き出し色パレット（3色ループ） ─────────────────────────────────────────
// 話者が現れた順に割り当て、4人目から①に戻る
const BUBBLE_PALETTE: { bg: string; text: string }[] = [
  { bg: '#ffffff', text: '#111111' }, // ① 白
  { bg: '#c8f7c5', text: '#111111' }, // ② うすい緑
  { bg: '#fff9c4', text: '#111111' }, // ③ うすい黄
]

// ─── Layout ───────────────────────────────────────────────────────────────────

const Backdrop = styled.div`
  position: fixed;
  bottom: 60px;
  left: 0;
  height: 400px;
  width: 500px;
  max-height: 50%;
  max-width: 100%;
`

const Wrapper = styled.div`
  position: relative;
  height: 100%;
  padding: 16px;
  display: flex;
  flex-direction: column;
`

const FabWrapper = styled.div`
  margin-top: auto;
`

const ChatHeader = styled.div`
  position: relative;
  height: 48px;
  background: #1a6b2a;
  border-radius: 10px 10px 0 0;

  h3 {
    color: #fff;
    margin: 0;
    padding: 10px 0;
    font-size: 20px;
    font-weight: 700;
    text-align: center;
  }

  .close {
    position: absolute;
    top: 6px;
    right: 0;
    color: #fff;
  }
`

const ChatBox = styled(Box)<{ isDragging?: boolean }>`
  height: 100%;
  width: 100%;
  overflow-y: auto;
  background: #1a1a2e;
  border: 2px solid ${({ isDragging }) => (isDragging ? '#42eacb' : '#00000029')};
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
  transition: border-color 0.15s;

  /* スタンプ画像を「チャットメッセージエリア(このボックス)の横幅の50%」で
     出すためのコンテナクエリの基準にする。このボックスは既に width:100% で
     幅が確定しているため、内包する要素のサイズに幅が引っ張られる循環は起きない。
     inline-size は幅方向だけのcontainmentなので、既存のoverflow-y:autoの
     縦スクロールや高さの挙動には影響しない。 */
  container-type: inline-size;
  container-name: chat-messages;
`

const DropOverlay = styled.div`
  position: absolute;
  inset: 0;
  background: rgba(66, 234, 203, 0.15);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  z-index: 10;
  pointer-events: none;
  border-radius: 4px;

  .drop-icon { font-size: 52px; }
  .drop-text {
    font-size: 20px;
    font-weight: 700;
    color: #42eacb;
    text-shadow: 0 1px 4px rgba(0,0,0,0.6);
  }
`

// ─── 通知（入退室） ────────────────────────────────────────────────────────────

const NotificationRow = styled.div`
  text-align: center;
  font-size: 13px;
  color: #888;
  padding: 2px 0;
`

// ─── 日付区切り ────────────────────────────────────────────────────────────────

const DateDivider = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 8px 0 4px;

  span {
    background: rgba(255, 255, 255, 0.12);
    color: #cfd3e0;
    font-size: 12px;
    padding: 3px 14px;
    border-radius: 12px;
  }
`

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

// メッセージのタイムスタンプを「今日 / 昨日 / M月D日(曜)」に整形する
function formatDateLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, today)) return '今日'
  if (sameDay(d, yesterday)) return '昨日'
  return `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`
}

// 2つのタイムスタンプが別の日かどうか
function isDifferentDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return da.getFullYear() !== db.getFullYear() || da.getMonth() !== db.getMonth() || da.getDate() !== db.getDate()
}

// ─── 吹き出し行 ──────────────────────────────────────────────────────────────

// isMine=true → 自分：左寄せ（row）  isMine=false → 他者：右寄せ（row-reverse）
const BubbleRow = styled.div<{ isMine: boolean }>`
  display: flex;
  flex-direction: ${({ isMine }) => (isMine ? 'row' : 'row-reverse')};
  align-items: flex-start;
  gap: 10px;
`

// アバター円（名前の先頭文字）
const Avatar = styled.div<{ bg: string }>`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: ${({ bg }) => bg};
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 800;
  color: #111;
  margin-top: 4px;
`

// 名前と吹き出しをまとめるカラム
const BubbleGroup = styled.div<{ isMine: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: ${({ isMine }) => (isMine ? 'flex-start' : 'flex-end')};
  max-width: calc(100% - 60px);
`

const AuthorName = styled.span<{ color: string }>`
  font-size: 15px;
  color: ${({ color }) => color};
  margin-bottom: 4px;
  padding: 0 4px;
`

// 吹き出しとメタ情報（既読・時刻）を並べる
const MessageBody = styled.div<{ isMine: boolean }>`
  display: flex;
  flex-direction: ${({ isMine }) => (isMine ? 'row' : 'row-reverse')};
  align-items: flex-end;
  gap: 4px;
`

// 吹き出し本体
const Bubble = styled.div<{ isMine: boolean }>`
  position: relative;
  background: ${({ isMine }) => (isMine ? '#85e249' : '#ffffff')};
  color: #111111;
  border-radius: 14px;
  padding: 10px 14px;
  font-size: 18px;
  line-height: 1.4;
  word-break: break-word;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  max-width: 100%;

  /* しっぽ */
  &::before {
    content: '';
    position: absolute;
    top: 10px;
    left: ${({ isMine }) => (isMine ? '-6px' : 'auto')};
    right: ${({ isMine }) => (isMine ? 'auto' : '-6px')};
    border: 6px solid transparent;
    border-top-color: ${({ isMine }) => (isMine ? '#85e249' : '#ffffff')};
    border-bottom: 0;
    border-right: ${({ isMine }) => (isMine ? '6px solid transparent' : '0')};
    border-left: ${({ isMine }) => (isMine ? '0' : '6px solid transparent')};
    margin-top: -2px;
  }
`

// スタンプ表示。吹き出し・背景・影を出さず、絵文字だけを大きく見せる。
// 周りに余白を持たせて存在感を出す（LINE・Discordと同じ考え方）
const StampBody = styled.div`
  font-size: 64px;
  line-height: 1.1;
  padding: 4px 6px 2px;
  user-select: none;
  /* 絵文字が並んだときに折り返せるようにしておく */
  word-break: break-word;
`

// 登録スタンプの表示。吹き出しに入れず、そのまま大きく見せる（LINEのスタンプ相当のサイズ感）。
// 横幅は「チャットメッセージエリア(ChatBox)の横幅の約50%」を基準にし、
// 画面が広いときのために160〜200px程度で頭打ちにする。縦横比はheight:autoで保つ。
// 50% は ChatBox に設定した container-type:inline-size を基準にした 50cqw で計算する
// （BubbleGroup/MessageBodyは内容に合わせて伸縮する箱なので、そこを基準に%指定すると
//   スタンプ自身のサイズに応じて基準の幅も変わってしまい、意図した50%にならない）。
const StampImage = styled.img`
  display: block;
  width: 50%;      /* コンテナクエリ非対応環境向けの控え。基本は下のcqw指定が効く */
  width: 50cqw;
  max-width: 180px;
  min-width: 72px;  /* 極端に狭い画面でスタンプが判読できないほど縮まないように */
  height: auto;     /* 縦横比を維持する */
  padding: 4px 6px 2px;
  user-select: none;
`

const DeletedStamp = styled.span`
  font-size: 13px;
  color: #999;
  padding: 4px 6px;
`

const MetaContainer = styled.div<{ isMine: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: ${({ isMine }) => (isMine ? 'flex-start' : 'flex-end')};
  justify-content: flex-end;
  min-width: 32px;
  margin-bottom: 2px;
`

const ReadLabel = styled.span`
  font-size: 12px;
  color: #888;
`

const TimeLabel = styled.span`
  font-size: 12px;
  color: #888;
`

// ─── ファイルプレビュー ────────────────────────────────────────────────────────

const FilePreviewWrapper = styled.div`
  background: rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  padding: 8px 10px;
  max-width: 260px;

  .file-name {
    font-size: 13px;
    font-weight: bold;
    margin-bottom: 6px;
    word-break: break-all;
  }

  img { max-width: 240px; max-height: 180px; border-radius: 6px; display: block; }
  video { max-width: 240px; max-height: 160px; border-radius: 6px; display: block; }
  audio { width: 220px; margin-top: 4px; }

  .csv-table {
    overflow: auto; max-height: 140px; font-size: 12px;
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #bbb; padding: 2px 5px; white-space: nowrap; }
    th { background: #e0e0e0; }
  }

  .excel-badge {
    display: inline-block; background: #1e7e34; color: #fff;
    padding: 4px 10px; border-radius: 4px; font-size: 13px; margin-top: 4px;
  }

  .pdf-preview {
    width: 240px; height: 200px; border: 1px solid #ccc;
    border-radius: 6px; background: #fff; display: block; margin-bottom: 6px;
  }
`

const FullScreenViewer = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  cursor: zoom-out;

  img, video {
    max-width: 90vw;
    max-height: 90vh;
    object-fit: contain;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    cursor: default;
  }
`

const InputWrapper = styled.form`
  box-shadow: 10px 10px 10px #00000018;
  border: 1px solid #42eacb;
  border-radius: 0 0 10px 10px;
  display: flex;
  flex-direction: row;
  background: linear-gradient(180deg, #000000c1, #242424c0);
`

const InputTextField = styled(InputBase)`
  font-size: 16px;
  input {
    padding: 8px;
    font-size: 16px;
    color: #e0e0e0;
  }
`

const EmojiPickerWrapper = styled.div`
  position: absolute;
  bottom: 54px;
  right: 16px;
`

// ─── 定数 ─────────────────────────────────────────────────────────────────────

const ACCEPT_TYPES =
  'image/*,video/*,audio/*,.xlsx,.xls,.csv,.pdf,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.ms-excel,application/pdf'

const timeFmt = new Intl.DateTimeFormat('ja', { timeStyle: 'short' })

// アバター背景色（吹き出し色と同じパレット）
const AVATAR_COLORS = BUBBLE_PALETTE.map((p) => p.bg)

function parseCSV(text: string): string[][] {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => line.split(',').map((c) => c.trim().replace(/^"|"$/g, '')))
}

// ─── FilePreview ──────────────────────────────────────────────────────────────

function FilePreview({ file, textColor }: { file: FileAttachment; textColor: string }) {
  const [csvRows, setCsvRows] = useState<string[][] | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)

  useEffect(() => {
    if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
      fetch(file.url).then((r) => r.text()).then((t) => setCsvRows(parseCSV(t)))
    } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      fetch(file.url)
        .then((r) => r.arrayBuffer())
        .then((ab) => {
          const wb = XLSX.read(ab, { type: 'array' })
          const wsname = wb.SheetNames[0]
          const ws = wb.Sheets[wsname]
          const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })
          setCsvRows(data)
        })
        .catch(err => console.error("Excel parse error:", err))
    }
  }, [file])

  const isImage = file.type.startsWith('image/')
  const isVideo = file.type.startsWith('video/')
  const isAudio = file.type.startsWith('audio/')
  const isCSV = file.type === 'text/csv' || file.name.endsWith('.csv')
  const isPDF = file.type === 'application/pdf' || file.name.endsWith('.pdf')
  const isExcel =
    file.name.endsWith('.xlsx') || file.name.endsWith('.xls') ||
    file.type.includes('spreadsheet') || file.type.includes('excel')

  return (
    <FilePreviewWrapper style={{ color: textColor }}>
      <div className="file-name">{file.name}</div>
      {isImage && (
        <>
          <img 
            src={file.url} 
            alt={file.name} 
            style={{ cursor: 'zoom-in' }}
            onClick={() => setViewerOpen(true)} 
          />
          {viewerOpen && createPortal(
            <FullScreenViewer onClick={() => setViewerOpen(false)}>
              <img src={file.url} alt={file.name} onClick={(e) => e.stopPropagation()} />
            </FullScreenViewer>,
            document.body
          )}
        </>
      )}
      {isVideo && (
        <>
          <video 
            src={file.url} 
            style={{ cursor: 'zoom-in' }}
            onClick={(e) => {
              e.preventDefault()
              setViewerOpen(true)
            }} 
          />
          {viewerOpen && createPortal(
            <FullScreenViewer onClick={() => setViewerOpen(false)}>
              <video src={file.url} controls autoPlay onClick={(e) => e.stopPropagation()} />
            </FullScreenViewer>,
            document.body
          )}
        </>
      )}
      {isAudio && <audio src={file.url} controls />}
      {isCSV && csvRows && (
        <div className="csv-table">
          <table>
            <thead><tr>{csvRows[0]?.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>
              {csvRows.slice(1, 11).map((row, ri) => (
                <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
          {csvRows.length > 11 && (
            <p style={{ fontSize: 11 }}>…他 {csvRows.length - 11} 行</p>
          )}
        </div>
      )}
      {isPDF && (
        <>
          {/* data: URLはブラウザが別タブで開けないため、サーバー配信のURLのときだけ埋め込む */}
          {!file.url.startsWith('data:') && (
            <iframe className="pdf-preview" src={file.url} title={file.name} />
          )}
          <a className="excel-badge" style={{ background: '#d32f2f' }} href={file.url} target="_blank" rel="noopener noreferrer">
            PDFを開く（別タブ）
          </a>
        </>
      )}
      {isExcel && (
        <a className="excel-badge" href={file.url} target="_blank" rel="noopener noreferrer">
          Excel を開く（別タブ）
        </a>
      )}
    </FilePreviewWrapper>
  )
}

// ─── Message ──────────────────────────────────────────────────────────────────

interface MessageProps {
  chatMessage: any
  messageType: MessageType
  file?: FileAttachment
  colorIndex: number
  myName: string
  sessionId: string
  onRequestUnsend: (target: { id: string; x: number; y: number }) => void
  // 登録スタンプの画像を引くための台帳（本文の [stamp:xxx] から解決する）
  stamps: Record<string, Stamp>
}

function Message({ chatMessage, messageType, file, colorIndex, myName, sessionId, onRequestUnsend, stamps }: MessageProps) {
  const isSystem =
    messageType === MessageType.PLAYER_JOINED || messageType === MessageType.PLAYER_LEFT

  useEffect(() => {
    // 自分以外のメッセージで、まだ自分が既読にしていない場合は既読を送信
    if (!isSystem && chatMessage.author !== myName && chatMessage.id) {
      if (!chatMessage.readers?.includes(sessionId)) {
        const game = phaserGame.scene.keys.game as Game
        game.network.markAsRead(chatMessage.id)
      }
    }
  }, [chatMessage, isSystem, myName, sessionId])

  if (isSystem) {
    return (
      <NotificationRow>
        {chatMessage.author} {chatMessage.content}
      </NotificationRow>
    )
  }

  const isMine = chatMessage.author === myName
  const avatarBg = AVATAR_COLORS[colorIndex % AVATAR_COLORS.length]
  const readCount = chatMessage.readers ? chatMessage.readers.length : 0
  // ファイル添付はスタンプ扱いしない（本文が空でも画像を出す必要があるため）
  const stampId =
    messageType !== MessageType.FILE_MESSAGE ? parseStampMessage(chatMessage.content) : null
  const stamp = stampId ? stamps[stampId] : undefined
  const isEmojiStamp =
    messageType !== MessageType.FILE_MESSAGE && isEmojiOnlyMessage(chatMessage.content)
  const isStamp = !!stampId || isEmojiStamp

  // 自分の発言を右クリックすると「送信取消」を出す。
  // 消せるのは全員に配られる本文だけなので、他人の発言では出さない
  const handleContextMenu = (e: React.MouseEvent) => {
    if (!isMine || !chatMessage.id) return
    e.preventDefault()
    e.stopPropagation()
    onRequestUnsend({ id: chatMessage.id, x: e.clientX, y: e.clientY })
  }

  return (
    <BubbleRow isMine={isMine} onContextMenu={handleContextMenu}>
      {!isMine && (
        <Avatar bg={avatarBg}>
          {chatMessage.author.charAt(0).toUpperCase()}
        </Avatar>
      )}

      <BubbleGroup isMine={isMine}>
        {!isMine && <AuthorName color="#bbb">{chatMessage.author}</AuthorName>}

        <MessageBody isMine={isMine}>
          {/* 絵文字だけの発言は吹き出しに入れず、スタンプのように大きく出す。
              文中の絵文字（「了解👍」）は今までどおり吹き出しの中に文字の大きさで出す */}
          {stampId ? (
            // 登録スタンプ。台帳から画像を引く。GIF/アニメWebPはimgのまま動く
            stamp ? (
              <StampImage src={resolveServerUrl(stamp.url)} alt={stamp.name} title={stamp.name} />
            ) : (
              <DeletedStamp>(削除されたスタンプ)</DeletedStamp>
            )
          ) : isEmojiStamp ? (
            <StampBody>{chatMessage.content}</StampBody>
          ) : (
            <Bubble isMine={isMine}>
              {messageType === MessageType.FILE_MESSAGE && file ? (
                <FilePreview file={file} textColor="#111" />
              ) : (
                <ChatMessageContent content={chatMessage.content} />
              )}
            </Bubble>
          )}
          <MetaContainer isMine={isMine}>
            {isMine && readCount > 0 && <ReadLabel>既読 {readCount}</ReadLabel>}
            <TimeLabel>{timeFmt.format(chatMessage.createdAt)}</TimeLabel>
          </MetaContainer>
        </MessageBody>
      </BubbleGroup>
    </BubbleRow>
  )
}

// 発言を右クリックしたときに出る小さなメニュー
const ContextMenu = styled.div<{ x: number; y: number }>`
  position: fixed;
  top: ${(p) => p.y}px;
  left: ${(p) => p.x}px;
  z-index: 30000;
  background: #2a3050;
  border: 1px solid rgba(150, 175, 255, 0.4);
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);

  button {
    display: block;
    width: 100%;
    background: none;
    border: none;
    color: #ff8f8f;
    font-size: 13px;
    padding: 8px 16px;
    text-align: left;
    cursor: pointer;
    border-radius: 5px;
    white-space: nowrap;
    &:hover { background: rgba(255, 255, 255, 0.08); }
  }
`

// ─── Chat ─────────────────────────────────────────────────────────────────────

// ドラッグ対象として有効なMIMEタイプ
const DROPPABLE_TYPES = /^(image\/|video\/|audio\/|application\/pdf)/

// 送信可能な最大ファイルサイズ（サーバーの /api/files の上限と揃えること）
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

// ファイルをサーバーへアップロードし、WebSocketにはURLだけを流す。
// 以前はbase64のdata URLをWebSocketに乗せていたが、これには2つの問題があった：
//   1. 数MBが1メッセージになり、転送中はチャットや移動など他の同期が全部詰まる
//   2. ブラウザは data: URL へのトップレベル遷移をブロックするため、PDF等を
//      「別タブで開く」ことがサイズに関係なく永久にできない
async function readAndSendFile(original: File, myName: string, dispatch: any) {
  if (original.size > MAX_FILE_SIZE) {
    alert(`ファイルが大きすぎて送信できません（最大 ${MAX_FILE_SIZE / 1024 / 1024}MB）: ${original.name}`)
    return
  }

  // 写真は数MBあるのに吹き出しでは数百px幅でしか表示されない。
  // 送る前に縮小して、保存容量・通信量・相手の読み込み時間をまとめて減らす
  const file = await shrinkImageFile(original)

  const id = `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  try {
    const form = new FormData()
    form.append('file', file, file.name)
    const res = await fetch(resolveServerUrl('/api/files'), { method: 'POST', body: form })
    if (!res.ok) throw new Error(`upload failed: ${res.status}`)
    const json = await res.json()

    const attachment: FileAttachment = {
      // 表示名は元のファイル名のまま（縮小で拡張子が変わっても利用者には関係ない）
      name: original.name,
      type: file.type || json.type || 'application/octet-stream',
      url: resolveServerUrl(json.url),
      size: file.size,
    }
    dispatch(pushFileMessage({ author: myName, file: attachment, id }))
    const game = phaserGame.scene.keys.game as Game
    game.network.sendFileMessage(attachment, id)
  } catch (e) {
    console.error('[Chat] ファイルのアップロードに失敗:', e)
    alert(`ファイルの送信に失敗しました: ${original.name}`)
  }
}

function processDroppedFiles(files: FileList, myName: string, dispatch: any) {
  Array.from(files).forEach((file) => {
    if (!DROPPABLE_TYPES.test(file.type) &&
        !file.name.match(/\.(xlsx?|csv|pdf)$/i)) return
    readAndSendFile(file, myName, dispatch)
  })
}

export default function Chat() {
  const [inputValue, setInputValue] = useState('')
  // 右クリックした自分の発言（送信取消メニューの表示位置と対象）
  const [unsendTarget, setUnsendTarget] = useState<{ id: string; x: number; y: number } | null>(null)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showStampPicker, setShowStampPicker] = useState(false)
  const stamps = useAppSelector((state) => state.stamp.stamps)
  const [readyToSubmit, setReadyToSubmit] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 話者ごとの色インデックスを管理（出現順に 0, 1, 2, 0, 1, 2 ...）
  const speakerColorMap = useRef(new Map<string, number>())

  const chatMessages = useAppSelector((state) => state.chat.chatMessages)
  const focused = useAppSelector((state) => state.chat.focused)
  const showChat = useAppSelector((state) => state.chat.showChat)
  const sessionId = useAppSelector((state) => state.user.sessionId)
  const myName = useAppSelector((state) => state.user.playerName || 'あなた')
  const dispatch = useAppDispatch()
  const game = phaserGame.scene.keys.game as Game

  // 各メッセージの話者に色インデックスを割り当てる
  const getColorIndex = (author: string): number => {
    if (!speakerColorMap.current.has(author)) {
      const idx = speakerColorMap.current.size % BUBBLE_PALETTE.length
      speakerColorMap.current.set(author, idx)
    }
    return speakerColorMap.current.get(author)!
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      inputRef.current?.blur()
      dispatch(setShowChat(false))
    }
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!readyToSubmit) { setReadyToSubmit(true); return }
    inputRef.current?.blur()
    const val = inputValue.trim()
    setInputValue('')
    if (val) {
      game.network.addChatMessage(val)
      game.myPlayer.updateDialogBubble(val)
    }
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    readAndSendFile(file, myName, dispatch)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ─── ドラッグ&ドロップ ─────────────────────────────────────────────────────

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current += 1
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current -= 1
    if (dragCounterRef.current === 0) setIsDragging(false)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) {
      processDroppedFiles(e.dataTransfer.files, myName, dispatch)
      // チャットが閉じていれば開く
      dispatch(setShowChat(true))
    }
  }

  useEffect(() => { if (focused) inputRef.current?.focus() }, [focused])

  // 送信取消メニューは、どこかをクリックしたら閉じる
  useEffect(() => {
    if (!unsendTarget) return
    const close = () => setUnsendTarget(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [unsendTarget])

  // スタンプは本文に印を入れた普通のチャットとして送る。
  // これで履歴・既読・送信取消がそのまま効く
  const sendStamp = (id: string) => {
    game.network.addChatMessage(buildStampMessage(id))
    game.myPlayer.updateDialogBubble('')
    // チャットに送るだけでなく、既存のエモート経路(SEND_EMOTE)に乗せて
    // アバターの頭上にも約2秒スタンプを表示する。誰がリアクションしたのか、
    // チャット欄を見ていなくても部屋の中で分かるようにするため
    game.network.sendEmote('', id)
    setShowStampPicker(false)
  }

  const handleUnsend = () => {
    if (!unsendTarget) return
    game.network.removeChatMessage(unsendTarget.id)
    setUnsendTarget(null)
  }

  // 過去にさかのぼって読んでいる間は自動で最下部へ飛ばさない。
  // 最下部付近にいるとき（＝最新を追っている）だけ新着でスクロールする。
  const chatBoxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = chatBoxRef.current
    if (!box) return
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120
    if (nearBottom) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  // チャットを開いた瞬間は最新（最下部）を表示する
  useEffect(() => {
    if (showChat) {
      requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView())
    }
  }, [showChat])

  // 新着チャット（テキスト/ファイル）で控えめな通知音。初回ロードと入退室通知は鳴らさない
  const prevMsgCountRef = useRef<number | null>(null)
  useEffect(() => {
    if (prevMsgCountRef.current === null) {
      prevMsgCountRef.current = chatMessages.length
      return
    }
    if (chatMessages.length > prevMsgCountRef.current) {
      const last = chatMessages[chatMessages.length - 1]
      if (last && last.messageType !== MessageType.PLAYER_JOINED && last.messageType !== MessageType.PLAYER_LEFT) {
        // スタンプは通常のチャット通知音ではなく「ポン」を鳴らす。
        // この効果は自分がスタンプを送ったときも(サーバーからの反映を経て)発火するため、
        // ここだけで送信者・受信者どちらの「ポン」もまかなえる
        // （送信直後にも別途鳴らすと二重に音が鳴ってしまうので、ここ一箇所に集約する）
        if (parseStampMessage(last.chatMessage.content)) {
          playStampSound()
        } else {
          playChatSound()
        }
      }
    }
    prevMsgCountRef.current = chatMessages.length
  }, [chatMessages])

  return (
    <>
      {unsendTarget && (
        <ContextMenu
          x={unsendTarget.x}
          y={unsendTarget.y}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button onClick={handleUnsend}>🗑 送信取消</button>
        </ContextMenu>
      )}
    <Backdrop>
      <Wrapper>
        {showChat ? (
          <>
            <ChatHeader>
              <h3>チャット</h3>
              <IconButton
                aria-label="close dialog"
                className="close"
                onClick={() => dispatch(setShowChat(false))}
                size="small"
              >
                <CloseIcon />
              </IconButton>
            </ChatHeader>

            <ChatBox
              ref={chatBoxRef}
              isDragging={isDragging}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              {isDragging && (
                <DropOverlay>
                  <span className="drop-icon">📂</span>
                  <span className="drop-text">ここにドロップして送信</span>
                </DropOverlay>
              )}
              {chatMessages.map(({ messageType, chatMessage, file }, index) => {
                // 日付が変わる境目に日付区切りを挿入する
                const prev = chatMessages[index - 1]
                const showDate =
                  chatMessage.createdAt &&
                  (index === 0 || !prev?.chatMessage?.createdAt || isDifferentDay(prev.chatMessage.createdAt, chatMessage.createdAt))
                return (
                  <React.Fragment key={index}>
                    {showDate && (
                      <DateDivider>
                        <span>{formatDateLabel(chatMessage.createdAt)}</span>
                      </DateDivider>
                    )}
                    <Message
                      chatMessage={chatMessage}
                      messageType={messageType}
                      file={file}
                      colorIndex={getColorIndex(chatMessage.author)}
                      myName={myName}
                      sessionId={sessionId}
                      onRequestUnsend={setUnsendTarget}
                      stamps={stamps}
                    />
                  </React.Fragment>
                )
              })}
              <div ref={messagesEndRef} />

              {showStampPicker && <StampPicker onPick={sendStamp} />}

              {showEmojiPicker && (
                <EmojiPickerWrapper>
                  <Picker
                    theme="dark"
                    showSkinTones={false}
                    showPreview={false}
                    onSelect={(emoji) => {
                      setInputValue((v) => v + emoji.native)
                      setShowEmojiPicker(false)
                      dispatch(setFocused(true))
                    }}
                    exclude={['recent', 'flags']}
                  />
                </EmojiPickerWrapper>
              )}
            </ChatBox>

            <InputWrapper onSubmit={handleSubmit}>
              <InputTextField
                inputRef={inputRef}
                autoFocus={focused}
                fullWidth
                placeholder="エンターキーでチャット"
                value={inputValue}
                onKeyDown={handleKeyDown}
                onChange={(e) => setInputValue(e.target.value)}
                onFocus={() => {
                  if (!focused) { dispatch(setFocused(true)); setReadyToSubmit(true) }
                }}
                onBlur={() => {
                  dispatch(setFocused(false)); setReadyToSubmit(false)
                }}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_TYPES}
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <IconButton
                aria-label="attach file"
                onClick={() => fileInputRef.current?.click()}
                style={{ padding: '10px' }}
              >
                <AttachFileIcon style={{ fontSize: 32 }} />
              </IconButton>
              <IconButton
                aria-label="stamp"
                title="スタンプ"
                onClick={() => { setShowStampPicker((v) => !v); setShowEmojiPicker(false) }}
                style={{ padding: '10px' }}
              >
                <StickyNote2Icon style={{ fontSize: 32 }} />
              </IconButton>
              <IconButton
                aria-label="emoji"
                onClick={() => { setShowEmojiPicker((v) => !v); setShowStampPicker(false) }}
                style={{ padding: '10px' }}
              >
                <InsertEmoticonIcon style={{ fontSize: 32 }} />
              </IconButton>
            </InputWrapper>
          </>
        ) : (
          <FabWrapper>
            <Fab
              color="secondary"
              aria-label="showChat"
              onClick={() => { dispatch(setShowChat(true)); dispatch(setFocused(true)) }}
            >
              <ChatBubbleOutlineIcon />
            </Fab>
          </FabWrapper>
        )}
      </Wrapper>
    </Backdrop>
    </>
  )
}
