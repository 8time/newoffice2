import React, { useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'

import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import { useAppDispatch, useAppSelector } from '../hooks'
import { closeStampManager, STAMP_CATEGORIES } from '../stores/StampStore'
import { resolveServerUrl } from '../services/serverUrl'
import { getClientId } from '../util/clientId'

/**
 * スタンプメーカー。自分たちで使うスタンプを登録・削除する。
 *
 * 画像は既存の /api/files に上げ、台帳（サーバーの stamps）にはURLだけを持つ。
 * 新しいアップロードの仕組みは作らない（重複排除・永続化・自動削除からの保護が
 * すべて /api/files 側に既にあるため）。
 */

// スタンプ1枚の上限。アニメは重くなりがちなので、ここで歯止めをかける
const MAX_STAMP_SIZE = 1024 * 1024 // 1MB
const NAME_MAX = 30

const Row = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
  flex-wrap: wrap;
`

const CatSelect = styled.select`
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid #ccc;
  font-size: 14px;
`

const Preview = styled.div`
  width: 84px;
  height: 84px;
  border: 1px dashed #bbb;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
  background: repeating-conic-gradient(#f0f0f0 0% 25%, #fff 0% 50%) 50% / 12px 12px;

  img { max-width: 100%; max-height: 100%; }
  span { font-size: 11px; color: #999; }
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 10px;
  margin-top: 6px;
`

const Item = styled.div`
  position: relative;
  border: 1px solid #e3e3e3;
  border-radius: 8px;
  padding: 6px;
  text-align: center;
  background: repeating-conic-gradient(#f6f6f6 0% 25%, #fff 0% 50%) 50% / 10px 10px;

  img { width: 100%; height: 72px; object-fit: contain; }
  .n {
    font-size: 11px;
    color: #555;
    margin-top: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .del {
    position: absolute;
    top: 2px;
    right: 2px;
    background: rgba(180, 40, 40, 0.9);
    color: #fff;
    border: none;
    border-radius: 50%;
    width: 22px;
    height: 22px;
    font-size: 13px;
    cursor: pointer;
    line-height: 1;
    &:hover { background: #d33; }
  }
`

const CatTitle = styled.p`
  margin: 16px 0 4px;
  font-size: 13px;
  font-weight: 700;
  color: #666;
`

const Hint = styled.p`
  margin: 2px 0 12px;
  font-size: 12px;
  color: #888;
  line-height: 1.7;
`

const ErrorText = styled.p`
  margin: 4px 0;
  color: #c33;
  font-size: 13px;
`

export default function StampManagerDialog() {
  const dispatch = useAppDispatch()
  const open = useAppSelector((state) => state.stamp.managerOpen)
  const stamps = useAppSelector((state) => state.stamp.stamps)

  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState<string>(STAMP_CATEGORIES[0])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const myKey = getClientId()
  const getNetwork = () => (phaserGame.scene.keys.game as Game)?.network

  const pick = (f: File | null) => {
    setError('')
    if (!f) return
    if (!f.type.startsWith('image/')) {
      setError('画像ファイルを選んでください')
      return
    }
    if (f.size > MAX_STAMP_SIZE) {
      setError(`スタンプは1MB以下にしてください（選んだ画像: ${(f.size / 1024 / 1024).toFixed(1)}MB）`)
      return
    }
    setFile(f)
    setPreviewUrl(URL.createObjectURL(f))
    if (!name) setName(f.name.replace(/\.[^/.]+$/, '').slice(0, NAME_MAX))
  }

  const save = async () => {
    if (!file || !name.trim()) return
    setBusy(true)
    setError('')
    try {
      // ここで画像を縮小してはいけない。縮小処理はアニメの1コマ目しか読めず、
      // 動くスタンプが静止画になってしまう。1MB上限があるので原本のまま送る。
      const form = new FormData()
      form.append('file', file, file.name)
      const res = await fetch(resolveServerUrl('/api/files'), { method: 'POST', body: form })
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json()
      // 台帳にはサーバーが返した /files/xxx の形のまま渡す。
      // この形で保存されることで、古いファイルの自動削除から守られる
      getNetwork()?.addStamp({ name: name.trim(), category, url: json.url, type: file.type })
      reset()
    } catch (e) {
      console.error('[Stamp] 登録に失敗:', e)
      setError('登録に失敗しました。時間をおいて試してください')
    }
    setBusy(false)
  }

  const reset = () => {
    setFile(null)
    setPreviewUrl('')
    setName('')
    setError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const remove = (id: string, stampName: string) => {
    if (!window.confirm(`スタンプ「${stampName}」を削除します。よろしいですか？`)) return
    getNetwork()?.removeStamp(id)
  }

  const byCategory = useMemo(() => {
    const map = new Map<string, [string, typeof stamps[string]][]>()
    STAMP_CATEGORIES.forEach((c) => map.set(c, []))
    Object.entries(stamps)
      .sort((a, b) => b[1].createdAt - a[1].createdAt)
      .forEach(([id, s]) => {
        const list = map.get(s.category) || map.get('その他')!
        list.push([id, s])
      })
    return map
  }, [stamps])

  const total = Object.keys(stamps).length

  return (
    <Dialog open={open} onClose={() => dispatch(closeStampManager())} maxWidth="sm" fullWidth>
      <DialogTitle>スタンプを管理（{total}個）</DialogTitle>
      <DialogContent>
        <Hint>
          PNG・GIF・WebP・APNG が使えます（動くスタンプもそのまま動きます）。
          1枚1MBまで・320×320px程度が目安です。登録したスタンプは全員が使えます。
        </Hint>

        <Row>
          <Preview>
            {previewUrl ? <img src={previewUrl} alt="preview" /> : <span>画像なし</span>}
          </Preview>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Row>
              <Button variant="outlined" component="label" size="small">
                画像を選ぶ
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/png,image/gif,image/webp,image/apng"
                  hidden
                  onChange={(e) => pick(e.target.files?.[0] || null)}
                />
              </Button>
              <CatSelect value={category} onChange={(e) => setCategory(e.target.value)}>
                {STAMP_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </CatSelect>
            </Row>
            <TextField
              fullWidth
              size="small"
              label="スタンプの名前"
              value={name}
              onChange={(e) => setName(e.target.value)}
              inputProps={{ maxLength: NAME_MAX }}
            />
          </div>
          <Button
            variant="contained"
            color="secondary"
            onClick={save}
            disabled={!file || !name.trim() || busy}
          >
            {busy ? '登録中…' : '登録'}
          </Button>
        </Row>
        {error && <ErrorText>{error}</ErrorText>}

        {STAMP_CATEGORIES.map((c) => {
          const list = byCategory.get(c) || []
          if (list.length === 0) return null
          return (
            <div key={c}>
              <CatTitle>{c}（{list.length}）</CatTitle>
              <Grid>
                {list.map(([id, s]) => (
                  <Item key={id} title={`${s.name}（登録: ${s.authorName || '不明'}）`}>
                    {/* 自分が登録したものだけ消せる。サーバー側でも本人か確認している */}
                    {s.author === myKey && (
                      <button className="del" onClick={() => remove(id, s.name)} title="削除">
                        ×
                      </button>
                    )}
                    <img src={resolveServerUrl(s.url)} alt={s.name} />
                    <div className="n">{s.name}</div>
                  </Item>
                ))}
              </Grid>
            </div>
          )
        })}

        {total === 0 && <Hint>まだスタンプがありません。上から登録してください。</Hint>}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => dispatch(closeStampManager())} color="inherit">閉じる</Button>
      </DialogActions>
    </Dialog>
  )
}
