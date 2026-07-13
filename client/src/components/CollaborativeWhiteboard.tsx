import React, { useEffect, useMemo, useRef } from 'react'
import { createGlobalStyle } from 'styled-components'
import { Excalidraw, reconcileElements } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'

import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import { phaserEvents, Event as PhaserEvent } from '../events/EventCenter'

/* ── Excalidraw ツールバーをグローバルに上書き ─────────────────────────────── */
export const ExcalidrawGlobal = createGlobalStyle`
  /* テーマカラー & ボタンサイズ（縦並びでも大きめに。溢れたらスクロール） */
  .excalidraw {
    --color-primary: #926f45 !important;
    --color-primary-darker: #684d2e !important;
    --color-primary-darkest: #4c3722 !important;
    --color-primary-light: #f4e2c2 !important;
    --default-button-size: 3.5rem !important;
    --default-icon-size: 2rem !important;
    --lg-button-size: 3.5rem !important;
    --lg-icon-size: 2rem !important;
    --space-factor: 0.4rem !important;
  }

  /* アイコンサイズ */
  .excalidraw .ToolIcon__icon svg,
  .excalidraw .App-toolbar svg {
    width: 1.9rem !important;
    height: 1.9rem !important;
  }

  /* ズーム/Undo・Redo・ライブラリ等のUIも拡大 */
  .excalidraw .zoom-actions,
  .excalidraw .undo-redo-buttons,
  .excalidraw .App-menu_bottom {
    font-size: 1.2rem !important;
  }

  /* ===== メインツールバー（図形ツール）を左端・縦中央に ====================
     図形ツールは画面幅に関わらず常に .App-toolbar > .Stack_horizontal（既定は
     上部の横並び grid）に描画される。これを縦並びにし、入れ物を左端へ寄せる。
     Excalidraw はキャンバスサイズで2レイアウトに切り替わり、左寄せの基準となる
     入れ物クラスが異なる：
       ・広幅 → デスクトップ: section.shapes-section
       ・狭幅 → モバイル:     .App-toolbar--mobile
     どちらも全キャンバスを覆う .FixedSideContainer を基準に絶対配置するため、
     メモ幅を変えてキャンバス左端が動くとツールバーも追従する。 */

  .excalidraw .shapes-section,
  .excalidraw .App-toolbar--mobile {
    position: absolute !important;
    left: 8px !important;
    top: 50% !important;
    transform: translateY(-50%) !important;
    width: auto !important;
    height: auto !important;
    max-height: calc(100% - 16px) !important;
    overflow-y: auto !important;
    overflow-x: hidden !important;
    z-index: 5 !important;
  }

  /* ボタンの横並び grid を縦並びに */
  .excalidraw .App-toolbar > .Stack.Stack_horizontal {
    grid-auto-flow: row !important;
    grid-template-columns: auto !important;
    grid-template-rows: none !important;
    justify-items: center !important;
  }
  .excalidraw .App-toolbar {
    width: auto !important;
  }

  /* ツールバー内のヒント文は縦並びだと位置が崩れるため非表示 */
  .excalidraw .App-toolbar .HintViewer {
    display: none !important;
  }

  /* 区切り線を縦→横に変換 */
  .excalidraw .App-toolbar__divider {
    width: 70% !important;
    height: 1px !important;
    margin: 4px auto !important;
    align-self: center !important;
  }

  /* 図形/テキストのプロパティパネル（線・塗り・線の太さ・フォントサイズ等）は
     既定で左側に出てツールバーと重なるため、右側へ移動して両方使えるようにする。
     ※モバイルではこのパネルは出ず、下部バーのパレットから開くので影響なし。 */
  .excalidraw .App-menu__left {
    left: auto !important;
    right: 8px !important;
    max-height: calc(100% - 16px) !important;
    overflow-y: auto !important;
  }

  /* 「ライブラリ」ボタンは社内ホワイトボードでは使わないため非表示 */
  .excalidraw .default-sidebar-trigger,
  .excalidraw .sidebar-trigger {
    display: none !important;
  }

  /* ズーム＋元に戻す/やり直しは、既定の左下だと左端の縦ツールバーと重なるため
     下部中央へ移動する。 */
  .excalidraw .layer-ui__wrapper__footer-left {
    position: absolute !important;
    left: 50% !important;
    bottom: 0 !important;
    transform: translateX(-50%) !important;
  }
`

const STORAGE_PREFIX = 'skyoffice_meeting_whiteboard_'

function getNetwork() {
  const game = phaserGame.scene.keys.game as Game
  return game?.network
}

// ─── Collaborative Whiteboard ─────────────────────────────────────────────────
// ミーティングルームのホワイトボードと、マップ設置のホワイトボード（roomIdが
// `board_<whiteboardId>`）の両方から使われる共通コンポーネント。

export default function CollaborativeWhiteboard({ roomId }: { roomId: string }) {
  const apiRef = useRef<any>(null)
  const applyingRemote = useRef(false)
  const pendingPayload = useRef<any>(null)
  const sendTimer = useRef<number>()
  const storageKey = `${STORAGE_PREFIX}${roomId}`

  // 画像ファイルを累積管理
  const filesRef = useRef<Record<string, any>>({})
  // すでにサーバーへ送信済み（またはサーバー/他クライアント由来で既知）のfileId。
  // これに含まれる画像はbase64を再送しない。
  const sentFileIds = useRef<Set<string>>(new Set())
  // 前回送信以降に新規追加された未送信ファイル（次回バッチでまとめて送る）
  const pendingNewFiles = useRef<Record<string, any>>({})

  const initialData = useMemo(() => {
    // 図形はデフォルトで角丸ではなく直角にする
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.files && typeof parsed.files === 'object') {
          filesRef.current = { ...parsed.files }
          // ローカルキャッシュにある画像はサーバーにも既にある想定なので送信済み扱い
          Object.keys(parsed.files).forEach((id) => sentFileIds.current.add(id))
        }
        return { ...parsed, appState: { ...parsed.appState, currentItemRoundness: 'sharp' } }
      }
    } catch {}
    return { elements: [], appState: { viewBackgroundColor: '#fffaf0', currentItemRoundness: 'sharp' }, files: {} }
  }, [storageKey])

  useEffect(() => {
    const handler = (remoteRoomId: string, payload: any) => {
      if (remoteRoomId !== roomId || !apiRef.current) return
      applyingRemote.current = true
      if (payload.files && typeof payload.files === 'object') {
        filesRef.current = { ...filesRef.current, ...payload.files }
        Object.keys(payload.files).forEach((id) => sentFileIds.current.add(id))
        // 画像はupdateSceneのfilesでは反映されないため、addFilesで明示的に追加する
        const fileArr = Object.values(payload.files)
        if (fileArr.length > 0) apiRef.current.addFiles(fileArr)
      }
      // 全置換ではなく、id/version/versionNonceで両者をマージする
      // （Excalidraw公式コラボ実装と同じreconcileElementsを使用。同時編集で片方の描画が消えるのを防ぐ）
      const localElements = apiRef.current.getSceneElementsIncludingDeleted()
      const reconciled = reconcileElements(localElements, payload.elements || [], apiRef.current.getAppState())
      apiRef.current.updateScene({
        elements: reconciled,
        appState: payload.appState || {},
      })
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ elements: reconciled, appState: payload.appState || {}, files: filesRef.current })
        )
      } catch {}
      window.requestAnimationFrame(() => { applyingRemote.current = false })
    }
    phaserEvents.on(PhaserEvent.MEETING_WHITEBOARD_REMOTE_UPDATE, handler)
    getNetwork()?.requestMeetingWhiteboardSnapshot(roomId)
    return () => {
      phaserEvents.off(PhaserEvent.MEETING_WHITEBOARD_REMOTE_UPDATE, handler)
      if (sendTimer.current) window.clearTimeout(sendTimer.current)
    }
  }, [roomId, storageKey])

  const scheduleSync = (payload: any) => {
    pendingPayload.current = payload
    if (sendTimer.current) return
    sendTimer.current = window.setTimeout(() => {
      if (pendingPayload.current) {
        getNetwork()?.sendMeetingWhiteboardUpdate(roomId, pendingPayload.current)
        // 今回送信した画像はsent済みとして記録し、以後は再送しない
        Object.keys(pendingPayload.current.files || {}).forEach((id) => sentFileIds.current.add(id))
        pendingNewFiles.current = {}
      }
      pendingPayload.current = null
      sendTimer.current = undefined
    }, 160)
  }

  const handleChange = (elements: readonly any[], appState: any, newFiles: any) => {
    if (applyingRemote.current) return
    // onChangeのfiles引数は不安定なため、APIからも確実に画像ファイルを取得して同期する
    const apiFiles = apiRef.current?.getFiles?.()
    if (apiFiles && typeof apiFiles === 'object') {
      filesRef.current = { ...filesRef.current, ...apiFiles }
    }
    if (newFiles && typeof newFiles === 'object' && Object.keys(newFiles).length > 0) {
      filesRef.current = { ...filesRef.current, ...newFiles }
    }
    // 未送信の画像だけを今回バッチに積む（送信済みのbase64は二度と載せない）
    Object.entries(filesRef.current).forEach(([id, file]) => {
      if (!sentFileIds.current.has(id)) pendingNewFiles.current[id] = file
    })

    // 要素はreconcileElementsで同時編集を解消するため、常に全量を送ってよい
    const payload = {
      elements,
      appState: { viewBackgroundColor: appState.viewBackgroundColor, theme: appState.theme, gridSize: appState.gridSize },
      files: pendingNewFiles.current,
      updatedAt: Date.now(),
    }
    // ローカルキャッシュには画像を全量含めて保存する（再読み込み時に復元するため）
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ elements, appState: payload.appState, files: filesRef.current })
      )
    } catch {}
    scheduleSync(payload)
  }

  return (
    <Excalidraw
      initialData={initialData}
      excalidrawAPI={(api) => {
        apiRef.current = api
      }}
      onChange={handleChange}
      // マウント時にフォーカスを取得しないとテキストツール等でキー入力が効かない
      autoFocus
      handleKeyboardGlobally
      UIOptions={{
        tools: { image: true },
        canvasActions: {
          saveAsImage: true,
          export: { saveFileToDisk: true },
          loadScene: true,
          saveToActiveFile: true,
        },
      }}
      langCode="ja-JP"
    />
  )
}
