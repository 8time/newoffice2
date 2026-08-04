import React, { Suspense } from 'react'

// Excalidraw(＋mermaid/katex/cytoscape等)は非常に大きく、初回ロードを重くしていた。
// ホワイトボードは会議室で開いたときだけ必要なので、動的importで遅延ロードする。
// これで初回の「入るまで」のダウンロード量が数MB減る。
const CollaborativeWhiteboard = React.lazy(() => import('./CollaborativeWhiteboard'))

const Fallback = () => (
  <div
    style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#888',
      fontSize: 14,
    }}
  >
    ホワイトボードを読み込み中…
  </div>
)

export default function LazyWhiteboard({ roomId }: { roomId: string }) {
  return (
    <Suspense fallback={<Fallback />}>
      <CollaborativeWhiteboard roomId={roomId} />
    </Suspense>
  )
}
