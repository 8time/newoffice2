import Peer from 'peerjs'
import Network from '../services/Network'
import store from '../stores'
import { setVideoConnected } from '../stores/UserStore'
import { phaserEvents, Event } from '../events/EventCenter'
import { AUDIO_PROCESSING } from '../util/audioConstraints'
import { preferOpusDtxFec } from '../util/sdpOpus'
import { recordDisconnect } from '../util/disconnectLog'

// 切断履歴で「PeerJS(通話の署名サーバー)の切断」を表す擬似コード。
// WebSocketのcloseコード(1000番台/4000番台)と被らない負の値にする。
const PEERJS_DISCONNECT_CODE = -1
import Adam from '../images/login/Adam_login.png'
import Ash from '../images/login/Ash_login.png'
import Lucy from '../images/login/Lucy_login.png'
import Nancy from '../images/login/Nancy_login.png'
import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'

const avatarMap: Record<string, string> = {
  adam: Adam,
  ash: Ash,
  lucy: Lucy,
  nancy: Nancy,
}

function getOtherPlayerInfo(peerId: string) {
  const game = phaserGame.scene.keys.game as Game
  if (game) {
    for (const otherPlayer of game.otherPlayerMap.values()) {
      const sanitized = otherPlayer.playerId.replace(/[^0-9a-z]/gi, 'G')
      if (sanitized === peerId) {
        return {
          avatarName: otherPlayer.texture.key,
          playerName: otherPlayer.playerName.text,
        }
      }
    }
  }
  return null
}

export interface PeerVideoEntry {
  peerId: string
  video: HTMLVideoElement
  isScreenShare?: boolean
}

export default class WebRTC {
  private myPeer: Peer
  private peers = new Map<string, { call: Peer.MediaConnection; video: HTMLVideoElement; wrapper: HTMLDivElement }>()
  private onCalledPeers = new Map<string, { call: Peer.MediaConnection; video: HTMLVideoElement; wrapper: HTMLDivElement }>()
  private myVideo = document.createElement('video')
  myStream?: MediaStream
  private screenStream?: MediaStream
  private network: Network

  // 公開状態フラグ（VideoOverlayからアクセスできるよう public）
  isAudioMuted = false
  isVideoOff = false
  isSharingScreen = false

  attachLocalVideo(containerId = 'my-video-mount') {
    const mount = document.getElementById(containerId)
    if (!mount || !this.myStream) return
    this.myVideo.style.width = '100%'
    this.myVideo.style.height = '100%'
    this.myVideo.style.objectFit = 'cover'
    this.myVideo.style.transform = 'scaleX(-1)'
    if (this.myVideo.parentElement !== mount) {
      mount.appendChild(this.myVideo)
    }
    this.myVideo.srcObject = this.myStream
    this.myVideo.playsInline = true
    this.myVideo.play().catch(() => undefined)
    this.applyVideoFallback(this.myVideo, this.isVideoOff)
  }

  // マウント先を登録すると、以後addVideoStreamで新規に追加されるピア映像も
  // このコンテナへ直接appendされる（従来のMutationObserverでの後追い監視が不要になる）
  private activeMountTarget: HTMLElement | null = null

  mountPeerVideos(container: HTMLElement) {
    this.activeMountTarget = container
    this.peers.forEach(({ wrapper }) => {
      if (wrapper.parentElement !== container) container.appendChild(wrapper)
    })
    this.onCalledPeers.forEach(({ wrapper }) => {
      if (wrapper.parentElement !== container) container.appendChild(wrapper)
    })
  }

  // 呼び出し元がアンマウントされる際に登録を解除する（他の画面のmountPeerVideosと競合しないように）
  unmountPeerVideos(container: HTMLElement) {
    if (this.activeMountTarget === container) this.activeMountTarget = null
  }

  // ─── 画面共有の大きな表示（会議室） ────────────────────────────────────────

  // 画面共有トラックは既存のピア映像要素（wrapper）にreplaceTrackで差し替わっているだけなので、
  // 新しいvideo要素を作らず、既存のwrapperを大きな表示用コンテナへ移動する。
  // 相手の共有画面を大きく表示する。カメラ列にある相手のタイルは動かさずそのまま残し、
  // 同じストリームを参照する別のvideo要素を大きい表示エリアに作る
  // （以前はタイルごと移動していたため、カメラ列から相手のアイコンが消えていた）。
  // 音声はカメラ列のタイル側が再生するので、こちらはミュートして二重再生を防ぐ。
  mountScreenShareVideo(peerSessionId: string, container: HTMLElement) {
    const sanitizedId = this.replaceInvalidId(peerSessionId)
    const peer = this.peers.get(sanitizedId) || this.onCalledPeers.get(sanitizedId)
    if (!peer) return
    const stream = peer.video.srcObject as MediaStream | null
    if (!stream) return

    let video = container.querySelector('video') as HTMLVideoElement | null
    if (!video) {
      video = document.createElement('video')
      video.style.width = '100%'
      video.style.height = '100%'
      video.style.objectFit = 'contain' // 共有画面は切り取らず全体を見せる
      video.playsInline = true
      video.muted = true
      container.appendChild(video)
    }
    if (video.srcObject !== stream) video.srcObject = stream
    video.play().catch(() => undefined)

    // 共有画面は大きい表示だけに出し、カメラ列/上部の小さいタイルは相手のキャラ（アバター）を
    // 出したままにする。こうしないと小さいタイルが共有画面で埋まり「キャラが消えた」ように見える。
    this.applyVideoFallback(peer.video, true)
  }

  unmountScreenShareVideo(peerSessionId: string) {
    const sanitizedId = this.replaceInvalidId(peerSessionId)
    const peer = this.peers.get(sanitizedId) || this.onCalledPeers.get(sanitizedId)
    if (!peer) return
    const isVideoOff = this.network.getPlayerState(peerSessionId)?.isVideoOff ?? false
    this.applyVideoFallback(peer.video, this.isPeerVideoHidden(peerSessionId, isVideoOff))
  }

  // 自分が画面共有中のとき、自分のプレビューを表示する（通常のmyVideoはカメラのままなので別要素を使う）
  attachLocalScreenPreview(container: string | HTMLElement) {
    const mount = typeof container === 'string' ? document.getElementById(container) : container
    if (!mount || !this.screenStream) return
    let video = mount.querySelector('video') as HTMLVideoElement | null
    if (!video) {
      video = document.createElement('video')
      video.style.width = '100%'
      video.style.height = '100%'
      video.style.objectFit = 'contain'
      video.muted = true
      mount.appendChild(video)
    }
    video.srcObject = this.screenStream
    video.playsInline = true
    video.play().catch(() => undefined)
  }

  // ピアビデオの受け皿（WebRTCのDOMアペンド先 → VideoOverlayのMutationObserverが監視）
  private get videoGrid() {
    return document.getElementById('webrtc-video-source')
  }
  // ボタングリッド（レガシー用、VideoOverlayのReact制御に移行済みのため使わない）
  private get buttonGrid() {
    return document.getElementById('webrtc-button-source')
  }

  constructor(userId: string, network: Network) {
    // 開発時のみ、E2EからOpus SDP変換の実関数を検証できるように公開する
    // （本番ビルドでは import.meta.env.DEV が false 畳み込みで除去される）
    if (import.meta.env.DEV) {
      ;(window as unknown as { __preferOpusDtxFec?: typeof preferOpusDtxFec }).__preferOpusDtxFec = preferOpusDtxFec
    }
    const sanitizedId = this.replaceInvalidId(userId)
    this.myPeer = new Peer(sanitizedId)
    this.network = network

    // 通話の署名サーバー(PeerJS)との接続が切れたら、同じIDで自動的に繋ぎ直す。
    // 既定の公開クラウド(0.peerjs.com)は不安定で頻繁に切れる。放置すると以降の
    // 近接通話が始められなくなる（既存の通話はP2Pなので維持されるが、新規の
    // 呼び出し/応答には署名サーバーが要る）。以前は error を出すだけで再接続が無かった。
    let peerReconnectDelay = 1000
    this.myPeer.on('disconnected', () => {
      if (this.myPeer.destroyed) return
      // ゲーム(Colyseus)の切断と区別できるよう履歴にも残す。頻度が分かる
      recordDisconnect(PEERJS_DISCONNECT_CODE, 'PeerJS署名サーバー切断（通話の仲介）— 自動で繋ぎ直します')
      const delay = peerReconnectDelay
      peerReconnectDelay = Math.min(peerReconnectDelay * 2, 30000) // 連続失敗で間隔を伸ばす
      console.warn(`[WebRTC] 通話の署名サーバーから切断。${delay}ms後に繋ぎ直します`)
      setTimeout(() => {
        if (this.myPeer.destroyed) return
        try {
          this.myPeer.reconnect() // 同じIDで繋ぎ直す（disconnected状態のときだけ有効）
        } catch (e) {
          console.error('[WebRTC] 署名サーバーへの再接続に失敗', e)
        }
      }, delay)
    })
    this.myPeer.on('open', () => {
      peerReconnectDelay = 1000 // 復帰したら間隔をリセット
    })
    this.myPeer.on('error', (err) => {
      // 'network'/'socket-error' は上の disconnected→reconnect で回復を試みる。
      // 'peer-unavailable'(相手が居ない)等は通話ごとの一時的なもので放置してよい。
      console.warn(`[WebRTC] PeerJSエラー type=${(err as { type?: string }).type}: ${err.message || err}`)
    })

    this.myVideo.muted = true
    this.initialize()

    // 近接イベントで自動マイクON/OFF
    phaserEvents.on(Event.PROXIMITY_ENTER, this.handleProximityEnter, this)
    phaserEvents.on(Event.PROXIMITY_LEAVE, this.handleProximityLeave, this)
    phaserEvents.on(Event.PLAYER_UPDATED, this.handlePlayerUpdated, this)
  }

  // 相手が画面共有中かどうか（sessionIdベース）。画面共有はカメラのvideoトラックを
  // 差し替える形で届くため、相手がカメラOFFだとアバターのフォールバックが被さって
  // 共有画面が見えなくなる。共有中はカメラのON/OFFに関わらず映像を表示する必要がある。
  private peerScreenSharing = new Set<string>()

  private isPeerVideoHidden(sessionId: string, isVideoOff: boolean) {
    // カメラOFF、または画面共有中はタイル映像を隠してアバター（キャラ）を出す。
    // 画面共有の映像は大きい表示エリアの方に出すため、小さいタイルはキャラのままにする。
    return isVideoOff || this.peerScreenSharing.has(sessionId)
  }

  // 相手のタイル映像の左右反転を切り替える。カメラはセルフィー風に反転させるが、
  // 画面共有は文字が鏡文字になってしまうため反転を解除する。
  private applyPeerMirror(sessionId: string) {
    const sanitizedId = this.replaceInvalidId(sessionId)
    const peer = this.peers.get(sanitizedId) || this.onCalledPeers.get(sanitizedId)
    if (!peer) return
    peer.video.style.transform = this.peerScreenSharing.has(sessionId) ? 'none' : 'scaleX(-1)'
  }

  private handlePlayerUpdated(field: string, value: any, key: string) {
    if (field === 'isScreenSharing') {
      const sanitizedId = this.replaceInvalidId(key)
      const peer = this.peers.get(sanitizedId) || this.onCalledPeers.get(sanitizedId)
      if (value) this.peerScreenSharing.add(key)
      else this.peerScreenSharing.delete(key)
      if (peer) {
        // 共有開始時は必ず映像を出し、共有終了時は相手のカメラ状態に従って戻す
        const isVideoOff = this.network.getPlayerState(key)?.isVideoOff ?? false
        this.applyVideoFallback(peer.video, this.isPeerVideoHidden(key, isVideoOff))
        this.applyPeerMirror(key)
      }
      // マップ／会議室のReact側に、大きな共有表示を出す/消すきっかけを渡す
      window.dispatchEvent(new CustomEvent('screen-share-change'))
      return
    }

    if (field === 'isVideoOff') {
      console.log(`[WebRTC] Peer ${key} camera toggled to: ${value}`)
      const sanitizedId = this.replaceInvalidId(key)
      const peer = this.peers.get(sanitizedId) || this.onCalledPeers.get(sanitizedId)
      if (peer) {
        console.log(`[WebRTC] Applying video fallback for peer ${sanitizedId}`)
        this.applyVideoFallback(peer.video, this.isPeerVideoHidden(key, value as boolean))
      } else {
        console.warn(`[WebRTC] Peer ${sanitizedId} not found in maps!`)
      }
    }
  }

  private replaceInvalidId(userId: string) {
    return userId.replace(/[^0-9a-z]/gi, 'G')
  }

  // 今このタイミングで相手に送るべきストリーム。
  // 画面共有中に新しく接続してきた相手にも、カメラではなく共有画面（と音声）が届くようにする。
  private getOutboundStream(): MediaStream | undefined {
    if (!this.myStream) return undefined
    if (!this.isSharingScreen || !this.screenStream) return this.myStream

    const video = this.screenStream.getVideoTracks()[0]
    const audio =
      this.mixedAudioDest?.stream.getAudioTracks()[0] ?? this.myStream.getAudioTracks()[0]
    const tracks: MediaStreamTrack[] = []
    if (video) tracks.push(video)
    if (audio) tracks.push(audio)
    return tracks.length > 0 ? new MediaStream(tracks) : this.myStream
  }

  initialize() {
    this.myPeer.on('call', (call) => {
      if (!this.onCalledPeers.has(call.peer)) {
        // 応答側のSDPにもOpusのFEC/DTXを入れて、双方向で頑丈にする
        call.answer(this.getOutboundStream(), { sdpTransform: preferOpusDtxFec })
        const video = document.createElement('video')

        call.on('stream', (userVideoStream) => {
          if (!this.onCalledPeers.has(call.peer)) {
            const wrapper = this.createVideoWrapper(call.peer, video, userVideoStream)
            this.onCalledPeers.set(call.peer, { call, video, wrapper })
          }
          this.addVideoStream(call.peer, video, userVideoStream)
        })
      }
    })
  }

  checkPreviousPermission() {
    const permissionName = 'microphone' as PermissionName
    navigator.permissions?.query({ name: permissionName }).then((result) => {
      if (result.state === 'granted') this.getUserMedia(false)
    })
  }

  getUserMedia(alertOnError = true) {
    navigator.mediaDevices
      ?.getUserMedia({ video: true, audio: AUDIO_PROCESSING })
      .then((stream) => {
        this.setMediaStream(stream)
      })
      .catch(() => {
        if (alertOnError) window.alert('ウェブカムまたはマイクが見つからないか、許可がブロックされています')
      })
  }

  // 外部で取得したストリームをセットする
  setMediaStream(stream: MediaStream) {
    this.myStream = stream

    // 自分のビデオを VideoOverlay の #my-video-mount にマウント
    const myMount = document.getElementById('my-video-mount')
    if (myMount) {
      this.myVideo.style.width = '100%'
      this.myVideo.style.height = '100%'
      this.myVideo.style.objectFit = 'cover'
      this.myVideo.style.transform = 'scaleX(-1)'
      myMount.appendChild(this.myVideo)
      this.myVideo.srcObject = stream
      this.myVideo.playsInline = true
      this.myVideo.addEventListener('loadedmetadata', () => this.myVideo.play())
    }

    // すでにミュート/カメラOFF状態であればストリームに適用する
    const audioTrack = this.myStream.getAudioTracks()[0]
    if (audioTrack) {
      audioTrack.enabled = !this.isAudioMuted
    }
    const videoTrack = this.myStream.getVideoTracks()[0]
    if (videoTrack) {
      videoTrack.enabled = !this.isVideoOff
    }

    // カメラOFF状態が即座にアバター表示へ反映されるようにする
    this.applyVideoFallback(this.myVideo, this.isVideoOff)

    this.setUpButtons()
    store.dispatch(setVideoConnected(true))
    this.network.videoConnected()
    this.network.updateMediaStatus(this.isVideoOff, this.isAudioMuted) // 初期状態をサーバーに同期
    this.notifyVideoState()
  }

  connectToNewUser(userId: string) {
    if (this.myStream) {
      const sanitizedId = this.replaceInvalidId(userId)
      if (!this.peers.has(sanitizedId)) {
        // 発信側のSDPのOpusにFEC/DTXを入れる（パケットロス耐性・帯域節約）
        const call = this.myPeer.call(sanitizedId, this.getOutboundStream()!, { sdpTransform: preferOpusDtxFec })
        const video = document.createElement('video')

        call.on('stream', (userVideoStream) => {
          if (!this.peers.has(sanitizedId)) {
            const wrapper = this.createVideoWrapper(sanitizedId, video, userVideoStream)
            this.peers.set(sanitizedId, { call, video, wrapper })
          }
          this.addVideoStream(sanitizedId, video, userVideoStream)
        })
      }
    }
  }

  createVideoWrapper(peerId: string, video: HTMLVideoElement, stream: MediaStream): HTMLDivElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'peer-video-wrapper'
    wrapper.style.position = 'relative'
    // 既定サイズ。VideoOverlayのカメラ枠に合わせて小さめにする
    // （ミーティングルームでは MeetingRoomOverlay 側が CAM_W で上書きする）
    wrapper.style.width = '300px'
    wrapper.style.height = '196px'
    wrapper.style.borderRadius = '10px'
    wrapper.style.border = '3px solid #00CCCC'
    wrapper.style.flexShrink = '0'
    wrapper.style.backgroundColor = '#222'
    wrapper.style.borderBottom = '2px solid #333'
    wrapper.style.overflow = 'hidden'

    // ビデオ要素のスタイリング
    video.style.width = '100%'
    video.style.height = '100%'
    video.style.objectFit = 'cover'
    video.style.transform = 'scaleX(-1)'
    video.style.display = 'block'
    video.style.transition = 'opacity 0.2s'
    wrapper.appendChild(video)

    // ステータスアイコン用コンテナ
    const statusIcons = document.createElement('div')
    statusIcons.className = 'peer-status-icons'
    statusIcons.style.position = 'absolute'
    statusIcons.style.bottom = '10px'
    statusIcons.style.right = '10px'
    statusIcons.style.display = 'flex'
    statusIcons.style.gap = '5px'
    statusIcons.style.zIndex = '10'
    wrapper.appendChild(statusIcons)

    // 相手の情報を取得
    const info = getOtherPlayerInfo(peerId)
    const avatarName = info?.avatarName || 'adam'
    const playerName = info?.playerName || 'Player'

    // 背景のグラデーション
    const getGradient = (str: string) => {
      const colors = [
        'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)',
        'linear-gradient(135deg, #3a7bd5 0%, #3a6073 100%)',
        'linear-gradient(135deg, #00b4db 0%, #0083b0 100%)',
        'linear-gradient(135deg, #83a4d4 0%, #b6fbff 100%)',
        'linear-gradient(135deg, #4ca1af 0%, #c4e0e5 100%)',
      ]
      let hash = 0
      for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
      return colors[Math.abs(hash) % colors.length]
    }
    
    const bgContainer = document.createElement('div')
    bgContainer.style.position = 'absolute'
    bgContainer.style.top = '0'
    bgContainer.style.left = '0'
    bgContainer.style.width = '100%'
    bgContainer.style.height = '100%'
    bgContainer.style.background = getGradient(peerId)
    bgContainer.style.display = 'none'
    bgContainer.className = 'peer-bg-fallback'

    // アバター用フォールバック画像
    const avatarImg = document.createElement('img')
    avatarImg.src = avatarMap[avatarName] || Adam
    avatarImg.style.position = 'absolute'
    avatarImg.style.bottom = '10%'
    avatarImg.style.left = '50%'
    avatarImg.style.transform = 'translateX(-50%)'
    avatarImg.style.height = '70%'
    avatarImg.style.objectFit = 'contain'
    avatarImg.style.display = 'none'
    avatarImg.style.imageRendering = 'pixelated'
    avatarImg.style.filter = 'drop-shadow(0px 8px 12px rgba(0,0,0,0.6))'
    avatarImg.className = 'peer-avatar-fallback'
    
    bgContainer.appendChild(avatarImg)
    wrapper.appendChild(bgContainer)

    // 名前ラベル
    const label = document.createElement('div')
    label.className = 'cam-label'
    label.innerText = playerName
    label.style.position = 'absolute'
    label.style.bottom = '8px'
    label.style.left = '10px'
    label.style.right = '10px'
    label.style.fontSize = '14px'
    label.style.fontWeight = '600'
    label.style.color = '#fff'
    label.style.background = 'rgba(0,0,0,0.65)'
    label.style.borderRadius = '6px'
    label.style.padding = '3px 10px'
    label.style.overflow = 'hidden'
    label.style.textOverflow = 'ellipsis'
    label.style.whiteSpace = 'nowrap'
    label.style.zIndex = '10'
    wrapper.appendChild(label)

    return wrapper
  }

  addVideoStream(peerId: string, video: HTMLVideoElement, stream: MediaStream) {
    video.srcObject = stream
    video.playsInline = true

    let isVideoOff = false
    let isAudioMuted = false
    let peerSessionId = ''
    // @ts-ignore
    if (this.network?.room) {
      // @ts-ignore
      this.network.room.state.players.forEach((p: any, key: string) => {
        if (this.replaceInvalidId(key) === peerId) {
          isVideoOff = p.isVideoOff
          isAudioMuted = p.isAudioMuted
          peerSessionId = key
          if (p.isScreenSharing) this.peerScreenSharing.add(key)
          // 挙手バッジ表示のため、Reduxのplayer(hand raised)マップと突き合わせられるよう実際のsessionIdを紐付けておく
          const wrapperEl = video.parentElement
          if (wrapperEl) wrapperEl.dataset.sessionId = key
        }
      })
    }

    // カメラOFFならアバターを表示する。ただし相手が画面共有中は共有映像を隠さない
    this.applyVideoFallback(video, this.isPeerVideoHidden(peerSessionId, isVideoOff))
    if (peerSessionId) this.applyPeerMirror(peerSessionId)
    this.updatePeerStatusIcons(peerId, isVideoOff, isAudioMuted)

    video.addEventListener('loadedmetadata', () => {
      video.play()
    })
    const wrapper = video.parentElement
    // マウント先が登録されていればそこへ直接追加し、なければ従来の受け皿ノードへ追加する
    const appendTarget = this.activeMountTarget || this.videoGrid
    if (appendTarget && wrapper) appendTarget.append(wrapper)
    this.notifyVideoState()
  }

  private applyVideoFallback(video: HTMLVideoElement, isVideoOff: boolean) {
    const wrapper = video.parentElement
    if (!wrapper) return

    const bgFallback = wrapper.querySelector('.peer-bg-fallback') as HTMLDivElement
    const avatarImg = wrapper.querySelector('.peer-avatar-fallback') as HTMLImageElement

    if (isVideoOff) {
      // カメラOFF → フォールバック表示
      video.style.display = 'none'
      if (bgFallback) bgFallback.style.display = 'block'
      if (avatarImg) bgFallback.appendChild(avatarImg) // ensure it's there
      if (avatarImg) avatarImg.style.display = 'block'
      wrapper.classList.add('camera-off')
    } else {
      video.style.display = 'block'
      if (bgFallback) bgFallback.style.display = 'none'
      if (avatarImg) avatarImg.style.display = 'none'
      wrapper.classList.remove('camera-off')
    }
  }

  deleteVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    if (this.peers.has(sanitizedId)) {
      const peer = this.peers.get(sanitizedId)
      peer?.call.close()
      peer?.wrapper.remove()
      this.peers.delete(sanitizedId)
    }
    this.notifyVideoState()
  }

  deleteOnCalledVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    if (this.onCalledPeers.has(sanitizedId)) {
      const onCalledPeer = this.onCalledPeers.get(sanitizedId)
      onCalledPeer?.call.close()
      onCalledPeer?.wrapper.remove()
      this.onCalledPeers.delete(sanitizedId)
    }
    this.notifyVideoState()
  }

  // ─── マイク制御 ─────────────────────────────────────────────────────────────

  toggleMute() {
    if (!this.myStream) return
    const audioTrack = this.myStream.getAudioTracks()[0]
    if (!audioTrack) return
    this.isAudioMuted = !this.isAudioMuted
    audioTrack.enabled = !this.isAudioMuted
    this.updateButtonLabels()
    this.network.updateMediaStatus(this.isVideoOff, this.isAudioMuted)
    this.notifyVideoState()
  }

  setMuted(muted: boolean) {
    if (!this.myStream) return
    const audioTrack = this.myStream.getAudioTracks()[0]
    if (!audioTrack) return
    this.isAudioMuted = muted
    audioTrack.enabled = !muted
    this.updateButtonLabels()
    this.network.updateMediaStatus(this.isVideoOff, this.isAudioMuted)
    this.notifyVideoState()
  }

  // ─── カメラ制御 ─────────────────────────────────────────────────────────────

  toggleVideo() {
    if (!this.myStream) return
    const videoTrack = this.myStream.getVideoTracks()[0]
    if (!videoTrack) return
    this.isVideoOff = !this.isVideoOff
    videoTrack.enabled = !this.isVideoOff
    this.applyVideoFallback(this.myVideo, this.isVideoOff)
    this.updateButtonLabels()
    this.network.updateMediaStatus(this.isVideoOff, this.isAudioMuted)
    this.notifyVideoState()
  }

  // ─── 画面共有 ────────────────────────────────────────────────────────────────

  // 接続中の全ピア（自分からcallした相手・相手からcallされた相手の両方）の映像トラックを差し替える。
  // 以前はthis.peers（自分からcallした相手）にしか適用しておらず、相手から先に呼ばれた場合は
  // 画面共有が一切届かなかった（片方向のみ成功する不具合）。
  private replaceTrackForAllPeers(kind: 'video' | 'audio', track: MediaStreamTrack | null) {
    const applyTo = (map: Map<string, { call: Peer.MediaConnection; video: HTMLVideoElement; wrapper: HTMLDivElement }>) => {
      map.forEach(({ call }) => {
        const sender = (call.peerConnection as RTCPeerConnection)
          .getSenders()
          .find((s) => s.track?.kind === kind)
        if (sender) sender.replaceTrack(track)
      })
    }
    applyTo(this.peers)
    applyTo(this.onCalledPeers)
  }

  private replaceVideoTrackForAllPeers(track: MediaStreamTrack | null) {
    this.replaceTrackForAllPeers('video', track)
  }

  // ─── 画面共有の音声 ───────────────────────────────────────────────────────────
  // 共有した動画などの音声を相手に届けるための仕組み。
  // WebRTCの音声送信枠(sender)は1本しかないため、画面の音声をそのまま入れるとマイクが消え、
  // 逆にマイクのままだと画面の音声が届かない。そこでWebAudioでマイクと画面音声をミックスし、
  // 1本のトラックにまとめてsenderに差し替える（再ネゴシエーション不要で確実に届く）。
  private audioCtx?: AudioContext
  private mixedAudioDest?: MediaStreamAudioDestinationNode

  private buildMixedAudioTrack(screenStream: MediaStream): MediaStreamTrack | null {
    const screenAudio = screenStream.getAudioTracks()[0]
    if (!screenAudio) return null // 「音声を共有」にチェックが入っていない場合

    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext
      this.audioCtx = new Ctx()
      this.mixedAudioDest = this.audioCtx.createMediaStreamDestination()

      // 画面の音声
      this.audioCtx
        .createMediaStreamSource(new MediaStream([screenAudio]))
        .connect(this.mixedAudioDest)

      // 自分のマイク（ミュート中はトラックがdisabledなので無音として混ざる）
      const micTrack = this.myStream?.getAudioTracks()[0]
      if (micTrack) {
        this.audioCtx
          .createMediaStreamSource(new MediaStream([micTrack]))
          .connect(this.mixedAudioDest)
      }

      return this.mixedAudioDest.stream.getAudioTracks()[0] ?? null
    } catch (e) {
      console.error('[WebRTC] 画面音声のミックスに失敗:', e)
      return null
    }
  }

  private teardownMixedAudio() {
    this.mixedAudioDest = undefined
    this.audioCtx?.close().catch(() => undefined)
    this.audioCtx = undefined
  }

  async startScreenShare() {
    if (this.isSharingScreen) return
    try {
      // audio: true で「タブの音声も共有」を選べるようにする（動画の音を相手に届けるため）
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      })
      this.isSharingScreen = true

      // 接続中の全ピアに画面共有の映像を送信
      const screenTrack = this.screenStream.getVideoTracks()[0]
      this.replaceVideoTrackForAllPeers(screenTrack)

      // 画面の音声があれば、マイクとミックスして音声トラックを差し替える
      const mixedAudio = this.buildMixedAudioTrack(this.screenStream)
      if (mixedAudio) this.replaceTrackForAllPeers('audio', mixedAudio)

      screenTrack.onended = () => {
        this.stopScreenShare()
      }

      this.updateButtonLabels()
      this.network.updateScreenSharing(true)
      this.notifyVideoState()
    } catch (err) {
      console.error('[WebRTC] 画面共有開始失敗:', err)
    }
  }

  stopScreenShare() {
    if (!this.isSharingScreen) return
    this.isSharingScreen = false

    // カメラストリームに戻す（カメラ未取得の場合はトラックなしに戻す）
    const cameraTrack = this.myStream?.getVideoTracks()[0] ?? null
    this.replaceVideoTrackForAllPeers(cameraTrack)

    // 音声をミックスから素のマイクへ戻す
    if (this.mixedAudioDest) {
      this.replaceTrackForAllPeers('audio', this.myStream?.getAudioTracks()[0] ?? null)
      this.teardownMixedAudio()
    }

    this.screenStream?.getTracks().forEach((t) => t.stop())
    this.screenStream = undefined
    this.updateButtonLabels()
    this.network.updateScreenSharing(false)
    this.notifyVideoState()
  }

  // ─── 近接マイク自動制御 ──────────────────────────────────────────────────────

  private handleProximityEnter() {
    // 近くに人がいる → マイクを有効化（ミュート解除）
    if (this.isAudioMuted) {
      this.setMuted(false)
    }
  }

  private handleProximityLeave() {
    // 誰もいない → マイクを無効化（ミュート）
    this.setMuted(true)
  }

  // 相手のステータスアイコンを更新
  updatePeerStatusIcons(peerId: string, isVideoOff: boolean, isAudioMuted: boolean) {
    const peer = this.peers.get(peerId) || this.onCalledPeers.get(peerId)
    if (!peer) return
    const statusIcons = peer.wrapper.querySelector('.peer-status-icons')
    if (statusIcons) {
      statusIcons.innerHTML = `
        ${isAudioMuted ? '<div style="background:rgba(0,0,0,0.6);border-radius:50%;padding:6px;display:flex;align-items:center;justify-content:center;color:#ff4444;"><svg fill="currentColor" width="20" height="20" viewBox="0 0 24 24"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6 6V11c0 1.66 1.34 3 3 3 .23 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg></div>' : ''}
        ${isVideoOff ? '<div style="background:rgba(0,0,0,0.6);border-radius:50%;padding:6px;display:flex;align-items:center;justify-content:center;color:#ff4444;"><svg fill="currentColor" width="20" height="20" viewBox="0 0 24 24"><path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"/></svg></div>' : ''}
      `
    }
  }

  // ─── ボタン（レガシー DOM ボタン）の生成・更新 ──────────────────────────────

  private audioButton?: HTMLButtonElement
  private videoButton?: HTMLButtonElement
  private screenButton?: HTMLButtonElement

  setUpButtons() {
    if (this.buttonGrid && this.buttonGrid.children.length > 0) return // 既に生成済み

    this.audioButton = document.createElement('button')
    this.audioButton.className = 'webrtc-btn btn-mic'
    this.audioButton.innerText = 'ミュート'
    this.audioButton.addEventListener('click', () => this.toggleMute())

    this.videoButton = document.createElement('button')
    this.videoButton.className = 'webrtc-btn btn-cam'
    this.videoButton.innerText = 'カメラOFF'
    this.videoButton.addEventListener('click', () => this.toggleVideo())

    this.screenButton = document.createElement('button')
    this.screenButton.className = 'webrtc-btn btn-screen'
    this.screenButton.innerText = '画面共有'
    this.screenButton.addEventListener('click', () => {
      if (this.isSharingScreen) this.stopScreenShare()
      else this.startScreenShare()
    })

    this.buttonGrid?.append(this.audioButton)
    this.buttonGrid?.append(this.videoButton)
    this.buttonGrid?.append(this.screenButton)
  }

  private updateButtonLabels() {
    if (this.audioButton) {
      this.audioButton.innerText = this.isAudioMuted ? 'ミュート解除' : 'ミュート'
      this.audioButton.classList.toggle('active', this.isAudioMuted)
    }
    if (this.videoButton) {
      this.videoButton.innerText = this.isVideoOff ? 'カメラON' : 'カメラOFF'
      this.videoButton.classList.toggle('active', this.isVideoOff)
    }
    if (this.screenButton) {
      this.screenButton.innerText = this.isSharingScreen ? '共有停止' : '画面共有'
      this.screenButton.classList.toggle('active', this.isSharingScreen)
    }
  }

  // VideoOverlay が参照できるよう状態を通知するイベントを emit
  private notifyVideoState() {
    window.dispatchEvent(new CustomEvent('webrtc-state-change', {
      detail: {
        isAudioMuted: this.isAudioMuted,
        isVideoOff: this.isVideoOff,
        isSharingScreen: this.isSharingScreen,
        hasStream: !!this.myStream,
      }
    }))
  }

  destroy() {
    phaserEvents.off(Event.PROXIMITY_ENTER, this.handleProximityEnter, this)
    phaserEvents.off(Event.PROXIMITY_LEAVE, this.handleProximityLeave, this)
    phaserEvents.off(Event.PLAYER_UPDATED, this.handlePlayerUpdated, this)
    this.myPeer.destroy()
  }
}
