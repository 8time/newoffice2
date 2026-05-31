import React, { useRef, useState } from 'react'
import styled from 'styled-components'

import { useAppDispatch } from '../hooks'
import { closeSignboardDialog } from '../stores/SignboardStore'
import { phaserEvents, Event } from '../events/EventCenter'

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  z-index: 2000;
`

const Panel = styled.div`
  width: 420px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  background: #222639;
  color: #eee;
  border-radius: 16px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
  padding: 24px;
  font-family: 'Roboto', 'Inter', sans-serif;
`

const Title = styled.h3`
  margin: 0 0 16px;
  font-size: 22px;
  text-align: center;
`

const Label = styled.label`
  display: block;
  font-size: 14px;
  color: #aab;
  margin: 14px 0 6px;
`

const TextArea = styled.textarea`
  width: 100%;
  box-sizing: border-box;
  min-height: 80px;
  resize: vertical;
  border-radius: 8px;
  border: 1px solid #3a3f57;
  background: #1a1d2e;
  color: #fff;
  font-size: 15px;
  padding: 10px 12px;
  outline: none;
  &:focus { border-color: #5599ee; }
`

const Input = styled.input`
  width: 100%;
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid #3a3f57;
  background: #1a1d2e;
  color: #fff;
  font-size: 15px;
  padding: 10px 12px;
  outline: none;
  &:focus { border-color: #5599ee; }
`

const ImageRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const FileButton = styled.button`
  border: none;
  border-radius: 8px;
  background: #3a3f57;
  color: #fff;
  font-size: 14px;
  padding: 10px 16px;
  cursor: pointer;
  white-space: nowrap;
  &:hover { background: #4a5070; }
`

const Preview = styled.img`
  max-width: 120px;
  max-height: 80px;
  border-radius: 6px;
  border: 1px solid #3a3f57;
  object-fit: contain;
  background: #000;
`

const RemoveImg = styled.button`
  border: none;
  background: transparent;
  color: #e57373;
  cursor: pointer;
  font-size: 13px;
`

const Actions = styled.div`
  display: flex;
  gap: 12px;
  margin-top: 24px;
`

const Button = styled.button<{ primary?: boolean }>`
  flex: 1;
  border: none;
  border-radius: 8px;
  padding: 12px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  color: #fff;
  background: ${({ primary }) => (primary ? '#1a6b2a' : '#3a3f57')};
  &:hover { background: ${({ primary }) => (primary ? '#208035' : '#4a5070')}; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`

const Hint = styled.p`
  font-size: 12px;
  color: #888;
  margin: 6px 0 0;
`

// 画像を縮小して base64(JPEG) に変換（サーバ同期のためサイズを抑える）
function fileToDownscaledDataUrl(file: File, maxSize = 480): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('canvas context unavailable'))
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.75))
      }
      img.onerror = reject
      img.src = reader.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function SignboardDialog() {
  const dispatch = useAppDispatch()
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [image, setImage] = useState('')

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const dataUrl = await fileToDownscaledDataUrl(file)
      setImage(dataUrl)
    } catch (err) {
      console.error('画像の読み込みに失敗:', err)
    }
    e.target.value = ''
  }

  const canSubmit = text.trim().length > 0 || image.length > 0

  const handleSubmit = () => {
    if (!canSubmit) return
    let normalizedUrl = url.trim()
    if (normalizedUrl && !/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = 'https://' + normalizedUrl
    }
    phaserEvents.emit(Event.SIGNBOARD_PLACE, {
      text: text.trim(),
      image,
      url: normalizedUrl,
    })
    dispatch(closeSignboardDialog())
  }

  return (
    <Backdrop onMouseDown={() => dispatch(closeSignboardDialog())}>
      <Panel onMouseDown={(e) => e.stopPropagation()}>
        <Title>看板を設置</Title>

        <Label>メモ / テキスト</Label>
        <TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="例：本日17時から全体MTG／〇〇の資料はこちら など"
        />

        <Label>画像（任意）</Label>
        <ImageRow>
          <FileButton type="button" onClick={() => fileRef.current?.click()}>
            画像を選択
          </FileButton>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFile}
          />
          {image && (
            <>
              <Preview src={image} alt="preview" />
              <RemoveImg type="button" onClick={() => setImage('')}>
                削除
              </RemoveImg>
            </>
          )}
        </ImageRow>

        <Label>リンクURL（任意・クリックで開く）</Label>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
        />

        <Hint>「入力&看板設置」を押すと、今いる場所に看板が設置されます（全員に表示）。</Hint>

        <Actions>
          <Button onClick={() => dispatch(closeSignboardDialog())}>キャンセル</Button>
          <Button primary disabled={!canSubmit} onClick={handleSubmit}>
            入力&看板設置
          </Button>
        </Actions>
      </Panel>
    </Backdrop>
  )
}
