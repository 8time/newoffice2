import Peer from 'peerjs'
import Network from '../services/Network'
import store from '../stores'
import { setVideoConnected } from '../stores/UserStore'
import { phaserEvents, Event } from '../events/EventCenter'
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

  mountPeerVideos(container: HTMLElement) {
    this.peers.forEach(({ wrapper }) => {
      if (wrapper.parentElement !== container) container.appendChild(wrapper)
    })
    this.onCalledPeers.forEach(({ wrapper }) => {
      if (wrapper.parentElement !== container) container.appendChild(wrapper)
    })
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
    const sanitizedId = this.replaceInvalidId(userId)
    this.myPeer = new Peer(sanitizedId)
    this.network = network
    this.myPeer.on('error', (err) => {
      console.log(err.type)
      console.error(err)
    })

    this.myVideo.muted = true
    this.initialize()

    // 近接イベントで自動マイクON/OFF
    phaserEvents.on(Event.PROXIMITY_ENTER, this.handleProximityEnter, this)
    phaserEvents.on(Event.PROXIMITY_LEAVE, this.handleProximityLeave, this)
    phaserEvents.on(Event.PLAYER_UPDATED, this.handlePlayerUpdated, this)
  }

  private handlePlayerUpdated(field: string, value: any, key: string) {
    if (field === 'isVideoOff') {
      console.log(`[WebRTC] Peer ${key} camera toggled to: ${value}`)
      const sanitizedId = this.replaceInvalidId(key)
      const peer = this.peers.get(sanitizedId) || this.onCalledPeers.get(sanitizedId)
      if (peer) {
        console.log(`[WebRTC] Applying video fallback for peer ${sanitizedId}`)
        this.applyVideoFallback(peer.video, value as boolean)
      } else {
        console.warn(`[WebRTC] Peer ${sanitizedId} not found in maps!`)
      }
    }
  }

  private replaceInvalidId(userId: string) {
    return userId.replace(/[^0-9a-z]/gi, 'G')
  }

  initialize() {
    this.myPeer.on('call', (call) => {
      if (!this.onCalledPeers.has(call.peer)) {
        call.answer(this.myStream)
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
      ?.getUserMedia({ video: true, audio: true })
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
        const call = this.myPeer.call(sanitizedId, this.myStream)
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
    wrapper.style.width = '495px'
    wrapper.style.height = '324px'
    wrapper.style.borderRadius = '10px'
    wrapper.style.border = '4px solid #00CCCC'
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
    label.style.fontSize = '20px'
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
    // @ts-ignore
    if (this.network?.room) {
      // @ts-ignore
      this.network.room.state.players.forEach((p: any, key: string) => {
        if (this.replaceInvalidId(key) === peerId) {
          isVideoOff = p.isVideoOff
          isAudioMuted = p.isAudioMuted
        }
      })
    }

    // カメラがOFFの場合のアバター画像を表示
    this.applyVideoFallback(video, isVideoOff)
    this.updatePeerStatusIcons(peerId, isVideoOff, isAudioMuted)

    video.addEventListener('loadedmetadata', () => {
      video.play()
    })
    const wrapper = video.parentElement
    if (this.videoGrid && wrapper) this.videoGrid.append(wrapper)
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

  async startScreenShare() {
    if (this.isSharingScreen) return
    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      })
      this.isSharingScreen = true

      // 接続中の全ピアに画面共有ストリームを送信
      const screenTrack = this.screenStream.getVideoTracks()[0]
      this.peers.forEach(({ call }) => {
        const sender = (call.peerConnection as RTCPeerConnection)
          .getSenders()
          .find((s) => s.track?.kind === 'video')
        if (sender) sender.replaceTrack(screenTrack)
      })

      screenTrack.onended = () => {
        this.stopScreenShare()
      }

      this.updateButtonLabels()
      this.notifyVideoState()
    } catch (err) {
      console.error('[WebRTC] 画面共有開始失敗:', err)
    }
  }

  stopScreenShare() {
    if (!this.isSharingScreen || !this.myStream) return
    this.isSharingScreen = false

    // カメラストリームに戻す
    const cameraTrack = this.myStream.getVideoTracks()[0]
    this.peers.forEach(({ call }) => {
      const sender = (call.peerConnection as RTCPeerConnection)
        .getSenders()
        .find((s) => s.track?.kind === 'video')
      if (sender && cameraTrack) sender.replaceTrack(cameraTrack)
    })

    this.screenStream?.getTracks().forEach((t) => t.stop())
    this.screenStream = undefined
    this.updateButtonLabels()
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
