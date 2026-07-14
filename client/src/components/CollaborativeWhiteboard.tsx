import React, { useEffect, useMemo, useRef } from 'react'
import { createGlobalStyle } from 'styled-components'
import { Excalidraw, reconcileElements, CaptureUpdateAction } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'

import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import { phaserEvents, Event as PhaserEvent } from '../events/EventCenter'
import { resolveServerUrl } from '../services/serverUrl'

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

// 送信スロットル間隔。要素の差分だけを送るようになったのでペイロードは小さく、
// 80msなら10人接続でも帯域・CPUともに余裕がある（体感の追従性を優先）
const SYNC_INTERVAL_MS = 80

// localStorageへのキャッシュ書き込み間隔。以前はonChangeのたびに
// 画像base64込みの全シーンをJSON.stringifyしておりメインスレッドを
// 大きくブロックしていた（描画がカクつく主因）。画像は含めず、間隔も空ける。
const LOCAL_SAVE_INTERVAL_MS = 1000

function getNetwork() {
  const game = phaserGame.scene.keys.game as Game
  return game?.network
}

// ─── 画像のHTTP転送 ───────────────────────────────────────────────────────────
// 画像のbase64をWebSocketに乗せると、1メッセージ数MBの直列化・順番待ちで
// ホワイトボードだけでなくオフィス全体の同期（移動・チャット）までラグが波及する。
// そこで画像本体はHTTP（/api/files）でアップロードし、WebSocketには
// { id, mimeType, created, url } の小さな記述子だけを流す。
// 受信側はurlをfetchしてdataURL化してからaddFilesする
// （Excalidrawに直接URLを渡すとcanvasが汚染されて画像エクスポートが壊れるため）。

function dataURLToBlob(dataURL: string): Blob {
  const [meta, b64] = dataURL.split(',')
  const mime = meta.match(/data:(.*?)(;|$)/)?.[1] || 'application/octet-stream'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

async function uploadWhiteboardImage(file: any): Promise<any> {
  const blob = dataURLToBlob(file.dataURL)
  const ext = (file.mimeType || 'image/png').split('/')[1] || 'png'
  const form = new FormData()
  form.append('file', blob, `${file.id}.${ext}`)
  const res = await fetch(resolveServerUrl('/api/files'), { method: 'POST', body: form })
  if (!res.ok) throw new Error(`upload failed: ${res.status}`)
  const json = await res.json()
  return { id: file.id, mimeType: file.mimeType, created: file.created || Date.now(), url: json.url }
}

async function fetchRemoteImage(desc: any): Promise<any | null> {
  try {
    const res = await fetch(resolveServerUrl(desc.url))
    if (!res.ok) return null
    const blob = await res.blob()
    const dataURL = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    return { id: desc.id, mimeType: desc.mimeType || blob.type || 'image/png', dataURL, created: desc.created || Date.now() }
  } catch {
    return null
  }
}

// ─── Collaborative Whiteboard ─────────────────────────────────────────────────
// ミーティングルームのホワイトボードと、マップ設置のホワイトボード（roomIdが
// `board_<whiteboardId>`）の両方から使われる共通コンポーネント。

export default function CollaborativeWhiteboard({ roomId }: { roomId: string }) {
  const apiRef = useRef<any>(null)
  const pendingPayload = useRef<any>(null)
  const sendTimer = useRef<number>()
  const lastSentAt = useRef(0)
  const storageKey = `${STORAGE_PREFIX}${roomId}`

  // 各要素の「最後にサーバーと同期がとれたバージョン」。id -> version。
  // 送信時はこれと差分がある要素だけを送り、受信時はリモートが採用された要素をここに記録する。
  // これによりエコー（受け取ったばかりの内容を自分の変更として送り返してしまうこと）を防ぐ。
  // 以前はrequestAnimationFrameで解除する真偽値フラグを使っていたが、Excalidrawの
  // onChangeはthrottleされておりrAFより後に発火することがあるため確実に機能しなかった。
  const lastSyncedVersions = useRef<Map<string, number>>(new Map())

  // 画像ファイルを累積管理
  const filesRef = useRef<Record<string, any>>({})
  // すでに同期済み（アップロード完了・サーバー/他クライアント由来で既知）のfileId
  const sentFileIds = useRef<Set<string>>(new Set())
  // アップロード進行中のfileId（二重アップロード防止）
  const uploadingFileIds = useRef<Set<string>>(new Set())
  // 次回送信に含める未送信ファイル（アップロード成功時はURL記述子、失敗時はbase64フォールバック）
  const pendingNewFiles = useRef<Record<string, any>>({})

  // localStorageへのデバウンス書き込み（画像は含めない）
  const localSaveTimer = useRef<number>()
  const localSavePending = useRef<any>(null)

  const scheduleLocalSave = (elements: readonly any[], appState: any) => {
    localSavePending.current = { elements, appState }
    if (localSaveTimer.current !== undefined) return
    localSaveTimer.current = window.setTimeout(() => {
      localSaveTimer.current = undefined
      if (!localSavePending.current) return
      try {
        localStorage.setItem(storageKey, JSON.stringify(localSavePending.current))
      } catch {}
      localSavePending.current = null
    }, LOCAL_SAVE_INTERVAL_MS)
  }

  const flushLocalSave = () => {
    if (localSaveTimer.current !== undefined) {
      window.clearTimeout(localSaveTimer.current)
      localSaveTimer.current = undefined
    }
    if (localSavePending.current) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(localSavePending.current))
      } catch {}
      localSavePending.current = null
    }
  }

  const initialData = useMemo(() => {
    // 図形はデフォルトで角丸ではなく直角にする
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        // 旧形式のキャッシュには画像base64が含まれていることがある（現在は書き込まない）。
        // あれば即時表示に使うが、以後の保存では持ち歩かない
        if (parsed.files && typeof parsed.files === 'object') {
          filesRef.current = { ...parsed.files }
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
      if (payload.files && typeof payload.files === 'object') {
        // 新形式（URL記述子）とレガシー（base64込み）を分けて処理する
        const legacyFiles: any[] = []
        const descriptors: any[] = []
        Object.values(payload.files).forEach((f: any) => {
          if (!f || !f.id) return
          sentFileIds.current.add(f.id)
          if (typeof f.url === 'string') {
            descriptors.push(f)
          } else if (typeof f.dataURL === 'string') {
            legacyFiles.push(f)
            filesRef.current[f.id] = f
          }
        })
        // 画像はupdateSceneのfilesでは反映されないため、addFilesで明示的に追加する
        if (legacyFiles.length > 0) apiRef.current.addFiles(legacyFiles)
        if (descriptors.length > 0) {
          // 画像本体はHTTPで並列取得する（WebSocketを塞がない）。到着次第表示される
          Promise.all(descriptors.map(fetchRemoteImage)).then((files) => {
            const loaded = files.filter(Boolean)
            if (loaded.length > 0 && apiRef.current) apiRef.current.addFiles(loaded)
          })
        }
      }
      // 全置換ではなく、id/version/versionNonceで両者をマージする
      // （Excalidraw公式コラボ実装と同じreconcileElementsを使用。同時編集で片方の描画が消えるのを防ぐ）
      const remoteElements = payload.elements || []
      const localElements = apiRef.current.getSceneElementsIncludingDeleted()
      const reconciled = reconcileElements(localElements, remoteElements, apiRef.current.getAppState())

      // リモートの内容が採用された要素だけを「同期済み」として記録する。
      // ローカルの方が新しくreconcile側がローカルを残した要素は、まだ自分からサーバーへ
      // 送っていない（送信待ちの）可能性があるため、ここではマークしない。
      const remoteVersionById = new Map(remoteElements.map((el: any) => [el.id, el.version]))
      reconciled.forEach((el: any) => {
        if (remoteVersionById.get(el.id) === el.version) {
          lastSyncedVersions.current.set(el.id, el.version)
        }
      })

      // captureUpdate: NEVER を指定し、リモート由来の変更が自分のUndo履歴に積まれないようにする
      apiRef.current.updateScene({
        elements: reconciled,
        appState: payload.appState || {},
        captureUpdate: CaptureUpdateAction.NEVER,
      })
      scheduleLocalSave(reconciled, payload.appState || {})
    }
    phaserEvents.on(PhaserEvent.MEETING_WHITEBOARD_REMOTE_UPDATE, handler)
    getNetwork()?.requestMeetingWhiteboardSnapshot(roomId)
    return () => {
      phaserEvents.off(PhaserEvent.MEETING_WHITEBOARD_REMOTE_UPDATE, handler)
      // 未送信の差分・ローカルキャッシュを確実に書き出してから離れる
      flushSend()
      flushLocalSave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, storageKey])

  const flushSend = () => {
    if (sendTimer.current !== undefined) {
      window.clearTimeout(sendTimer.current)
      sendTimer.current = undefined
    }
    if (!pendingPayload.current) return
    getNetwork()?.sendMeetingWhiteboardUpdate(roomId, pendingPayload.current)
    // 今回送信した要素・画像は同期済みとして記録し、リモートからのエコーで再送しない
    ;(pendingPayload.current.elements || []).forEach((el: any) => {
      lastSyncedVersions.current.set(el.id, el.version)
    })
    Object.keys(pendingPayload.current.files || {}).forEach((id) => sentFileIds.current.add(id))
    pendingNewFiles.current = {}
    pendingPayload.current = null
    lastSentAt.current = Date.now()
  }

  // leading-edge付きスロットル：前回送信からSYNC_INTERVAL_MS以上経っていれば即送信、
  // そうでなければ残り時間後にまとめて送信する（単発の操作が160ms待たされていたのを解消）
  const scheduleSync = (payload: any) => {
    pendingPayload.current = payload
    if (sendTimer.current !== undefined) return
    const wait = Math.max(0, SYNC_INTERVAL_MS - (Date.now() - lastSentAt.current))
    sendTimer.current = window.setTimeout(flushSend, wait)
  }

  // アップロード完了した画像記述子を送るためだけの送信（要素の差分が無いときに使う）。
  // 送信待ちのpayloadがある場合、そのfilesはpendingNewFiles.currentと同一参照なので相乗りできる
  const queueFilesOnlySync = () => {
    if (pendingPayload.current) return
    if (Object.keys(pendingNewFiles.current).length === 0) return
    scheduleSync({ elements: [], appState: {}, files: pendingNewFiles.current, updatedAt: Date.now() })
  }

  const handleChange = (elements: readonly any[], appState: any, newFiles: any) => {
    // onChangeのfiles引数は不安定なため、APIからも確実に画像ファイルを取得して同期する
    const apiFiles = apiRef.current?.getFiles?.()
    if (apiFiles && typeof apiFiles === 'object') {
      filesRef.current = { ...filesRef.current, ...apiFiles }
    }
    if (newFiles && typeof newFiles === 'object' && Object.keys(newFiles).length > 0) {
      filesRef.current = { ...filesRef.current, ...newFiles }
    }

    // 新しく追加された画像はHTTPでアップロードし、完了したらURL記述子を同期する。
    // base64をWebSocketに流さないことで、転送中に他の同期が詰まるのを防ぐ
    Object.entries(filesRef.current).forEach(([id, file]: [string, any]) => {
      if (sentFileIds.current.has(id) || uploadingFileIds.current.has(id)) return
      if (typeof file?.dataURL !== 'string' || !file.dataURL.startsWith('data:')) return
      uploadingFileIds.current.add(id)
      uploadWhiteboardImage(file)
        .then((desc) => {
          pendingNewFiles.current[id] = desc
        })
        .catch(() => {
          // サーバーに置けなかった場合は従来どおりbase64を直接送る（機能は落とさない）
          pendingNewFiles.current[id] = file
        })
        .then(() => {
          sentFileIds.current.add(id)
          uploadingFileIds.current.delete(id)
          queueFilesOnlySync()
        })
    })

    // 前回サーバーと同期がとれたバージョンから変化した要素だけを送る。
    // これにより「リモート更新を受けてupdateSceneした結果、onChangeが再発火して
    // 同じ内容を送り返してしまう」エコーを防ぐ（変化なしなら空になり送信対象から外れる）。
    const changedElements = elements.filter(
      (el: any) => lastSyncedVersions.current.get(el.id) !== el.version
    )

    const appStateToSync = { viewBackgroundColor: appState.viewBackgroundColor, theme: appState.theme, gridSize: appState.gridSize }

    // ローカルキャッシュはデバウンスして書く（画像は含めない。復元はサーバースナップショットが担う）
    scheduleLocalSave(elements, appStateToSync)

    // 変化した要素も新規画像もなければ送信しない（エコー・無駄な送信の防止）
    if (changedElements.length === 0 && Object.keys(pendingNewFiles.current).length === 0) return

    const payload = {
      elements: changedElements,
      appState: appStateToSync,
      files: pendingNewFiles.current,
      updatedAt: Date.now(),
    }
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
