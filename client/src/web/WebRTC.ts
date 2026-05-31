import Peer from 'peerjs'
import Network from '../services/Network'
import store from '../stores'
import { setVideoConnected } from '../stores/UserStore'
import { phaserEvents, Event } from '../events/EventCenter'

export interface PeerVideoEntry {
  peerId: string
  video: HTMLVideoElement
  isScreenShare?: boolean
}

export default class WebRTC {
  private myPeer: Peer
  private peers = new Map<string, { call: Peer.MediaConnection; video: HTMLVideoElement }>()
  private onCalledPeers = new Map<string, { call: Peer.MediaConnection; video: HTMLVideoElement }>()
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
    this.applyVideoFallback(this.myVideo, this.myStream)
  }

  mountPeerVideos(container: HTMLElement) {
    this.peers.forEach(({ video }) => {
      if (video.parentElement !== container) container.appendChild(video)
    })
    this.onCalledPeers.forEach(({ video }) => {
      if (video.parentElement !== container) container.appendChild(video)
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
  }

  private replaceInvalidId(userId: string) {
    return userId.replace(/[^0-9a-z]/gi, 'G')
  }

  initialize() {
    this.myPeer.on('call', (call) => {
      if (!this.onCalledPeers.has(call.peer)) {
        call.answer(this.myStream)
        const video = document.createElement('video')
        this.onCalledPeers.set(call.peer, { call, video })

        call.on('stream', (userVideoStream) => {
          this.addVideoStream(video, userVideoStream)
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
    this.applyVideoFallback(this.myVideo, this.myStream)

    this.setUpButtons()
    store.dispatch(setVideoConnected(true))
    this.network.videoConnected()
    this.notifyVideoState()
  }

  connectToNewUser(userId: string) {
    if (this.myStream) {
      const sanitizedId = this.replaceInvalidId(userId)
      if (!this.peers.has(sanitizedId)) {
        const call = this.myPeer.call(sanitizedId, this.myStream)
        const video = document.createElement('video')
        this.peers.set(sanitizedId, { call, video })

        call.on('stream', (userVideoStream) => {
          this.addVideoStream(video, userVideoStream)
        })
      }
    }
  }

  addVideoStream(video: HTMLVideoElement, stream: MediaStream) {
    video.srcObject = stream
    video.playsInline = true

    // カメラがOFFの場合はアバター画像を表示
    this.applyVideoFallback(video, stream)

    // ビデオトラックのenabledを監視してアバターフォールバックを更新
    const videoTrack = stream.getVideoTracks()[0]
    if (videoTrack) {
      const interval = setInterval(() => {
        if (!videoTrack.readyState || videoTrack.readyState === 'ended') {
          clearInterval(interval)
          return
        }
        this.applyVideoFallback(video, stream)
      }, 500)
    }

    video.addEventListener('loadedmetadata', () => {
      video.play()
    })
    if (this.videoGrid) this.videoGrid.append(video)
    this.notifyVideoState()
  }

  private applyVideoFallback(video: HTMLVideoElement, stream: MediaStream) {
    const videoTrack = stream.getVideoTracks()[0]
    if (videoTrack && !videoTrack.enabled) {
      // カメラOFF → アバター画像をdata属性でマーク（CSS側でfallback表示）
      video.style.opacity = '0'
      const wrapper = video.parentElement
      if (wrapper) wrapper.classList.add('camera-off')
    } else {
      video.style.opacity = '1'
      const wrapper = video.parentElement
      if (wrapper) wrapper.classList.remove('camera-off')
    }
  }

  deleteVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    if (this.peers.has(sanitizedId)) {
      const peer = this.peers.get(sanitizedId)
      peer?.call.close()
      peer?.video.remove()
      this.peers.delete(sanitizedId)
    }
    this.notifyVideoState()
  }

  deleteOnCalledVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    if (this.onCalledPeers.has(sanitizedId)) {
      const onCalledPeer = this.onCalledPeers.get(sanitizedId)
      onCalledPeer?.call.close()
      onCalledPeer?.video.remove()
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
    this.notifyVideoState()
  }

  setMuted(muted: boolean) {
    if (!this.myStream) return
    const audioTrack = this.myStream.getAudioTracks()[0]
    if (!audioTrack) return
    this.isAudioMuted = muted
    audioTrack.enabled = !muted
    this.updateButtonLabels()
    this.notifyVideoState()
  }

  // ─── カメラ制御 ─────────────────────────────────────────────────────────────

  toggleVideo() {
    if (!this.myStream) return
    const videoTrack = this.myStream.getVideoTracks()[0]
    if (!videoTrack) return
    this.isVideoOff = !this.isVideoOff
    videoTrack.enabled = !this.isVideoOff
    this.applyVideoFallback(this.myVideo, this.myStream)
    this.updateButtonLabels()
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
    this.myPeer.destroy()
  }
}
