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
        <a className="excel-badge" style={{ background: '#d32f2f' }} href={file.url} target="_blank" rel="noopener noreferrer">
          PDFを開く（別タブ）
        </a>
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
}

function Message({ chatMessage, messageType, file, colorIndex, myName, sessionId }: MessageProps) {
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

  return (
    <BubbleRow isMine={isMine}>
      {!isMine && (
        <Avatar bg={avatarBg}>
          {chatMessage.author.charAt(0).toUpperCase()}
        </Avatar>
      )}

      <BubbleGroup isMine={isMine}>
        {!isMine && <AuthorName color="#bbb">{chatMessage.author}</AuthorName>}

        <MessageBody isMine={isMine}>
          <Bubble isMine={isMine}>
            {messageType === MessageType.FILE_MESSAGE && file ? (
              <FilePreview file={file} textColor="#111" />
            ) : (
              chatMessage.content
            )}
          </Bubble>
          <MetaContainer isMine={isMine}>
            {isMine && readCount > 0 && <ReadLabel>既読 {readCount}</ReadLabel>}
            <TimeLabel>{timeFmt.format(chatMessage.createdAt)}</TimeLabel>
          </MetaContainer>
        </MessageBody>
      </BubbleGroup>
    </BubbleRow>
  )
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

// ドラッグ対象として有効なMIMEタイプ
const DROPPABLE_TYPES = /^(image\/|video\/|audio\/|application\/pdf)/

// 送信可能な最大ファイルサイズ（base64化で約1.37倍になる。サーバのmaxPayloadと整合させること）
const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB

// ファイルをbase64 data URLとして読み込み、ローカル表示＋全員へ送信する。
// blob: URL は生成元ブラウザでしか開けないため、相手に届けるには data URL 化が必須。
function readAndSendFile(file: File, myName: string, dispatch: any) {
  if (file.size > MAX_FILE_SIZE) {
    alert(`ファイルが大きすぎて送信できません（最大 ${MAX_FILE_SIZE / 1024 / 1024}MB）: ${file.name}`)
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const attachment: FileAttachment = {
      name: file.name,
      type: file.type || 'application/octet-stream',
      url: reader.result as string,
      size: file.size,
    }
    // 一意IDを付与し、受信側での重複表示を防ぐ
    const id = `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    dispatch(pushFileMessage({ author: myName, file: attachment, id }))
    const game = phaserGame.scene.keys.game as Game
    game.network.sendFileMessage(attachment, id)
  }
  reader.readAsDataURL(file)
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
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
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
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, showChat])

  return (
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
              {chatMessages.map(({ messageType, chatMessage, file }, index) => (
                <Message
                  key={index}
                  chatMessage={chatMessage}
                  messageType={messageType}
                  file={file}
                  colorIndex={getColorIndex(chatMessage.author)}
                  myName={myName}
                  sessionId={sessionId}
                />
              ))}
              <div ref={messagesEndRef} />

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
                aria-label="emoji"
                onClick={() => setShowEmojiPicker((v) => !v)}
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
  )
}
