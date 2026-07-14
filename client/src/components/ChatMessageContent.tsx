import React from 'react'
import styled from 'styled-components'

// チャット本文の描画。URLをリンク化し、YouTubeのURLがあれば再生プレイヤーを埋め込む。
// XSS防止のため dangerouslySetInnerHTML は使わず、必ずReact要素として組み立てる。

const Link = styled.a`
  color: #0b57d0;
  text-decoration: underline;
  word-break: break-all;
`

const EmbedWrapper = styled.div`
  margin-top: 8px;
  border-radius: 8px;
  overflow: hidden;
  width: 240px;
  max-width: 100%;

  iframe {
    display: block;
    width: 240px;
    height: 135px; /* 16:9 */
    border: 0;
    background: #000;
  }
`

const URL_REGEX = /(https?:\/\/[^\s<>"']+)/g
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/

interface YouTubeRef {
  id: string
  start?: number
}

// 秒数指定（?t=90 / ?t=1m30s / &start=90）を秒に正規化する
function parseStartSeconds(value: string | null): number | undefined {
  if (!value) return undefined
  if (/^\d+$/.test(value)) return Number(value)
  const m = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)
}

export function parseYouTube(rawUrl: string): YouTubeRef | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\./, '')
  let id: string | null = null

  if (host === 'youtu.be') {
    id = url.pathname.slice(1)
  } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') {
      id = url.searchParams.get('v')
    } else if (url.pathname.startsWith('/shorts/')) {
      id = url.pathname.slice('/shorts/'.length)
    } else if (url.pathname.startsWith('/embed/')) {
      id = url.pathname.slice('/embed/'.length)
    } else if (url.pathname.startsWith('/live/')) {
      id = url.pathname.slice('/live/'.length)
    }
  }

  if (!id) return null
  id = id.split('/')[0]
  // 動画IDは11文字の英数字・ハイフン・アンダースコアのみ。想定外の文字列を埋め込まない
  if (!YOUTUBE_ID.test(id)) return null

  const start = parseStartSeconds(url.searchParams.get('t') || url.searchParams.get('start'))
  return { id, start }
}

export default function ChatMessageContent({ content }: { content: string }) {
  const parts = content.split(URL_REGEX)
  let firstVideo: YouTubeRef | null = null

  const nodes = parts.map((part, i) => {
    // splitの結果、URLにマッチした部分は奇数番目に入る
    if (i % 2 === 1) {
      const yt = parseYouTube(part)
      if (yt && !firstVideo) firstVideo = yt
      return (
        <Link key={i} href={part} target="_blank" rel="noopener noreferrer">
          {part}
        </Link>
      )
    }
    return <React.Fragment key={i}>{part}</React.Fragment>
  })

  // 吹き出しが縦に伸びすぎないよう、埋め込みは最初の1件だけにする
  const video = firstVideo as YouTubeRef | null

  return (
    <>
      {nodes}
      {video && (
        <EmbedWrapper>
          <iframe
            // プライバシー強化ドメイン（視聴履歴を残さない）
            src={`https://www.youtube-nocookie.com/embed/${video.id}${video.start ? `?start=${video.start}` : ''}`}
            title="YouTube"
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </EmbedWrapper>
      )}
    </>
  )
}
