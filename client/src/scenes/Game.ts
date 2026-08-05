import Phaser from 'phaser'

// import { debugDraw } from '../utils/debug'
import { createCharacterAnims } from '../anims/CharacterAnims'

import Item from '../items/Item'
import Chair from '../items/Chair'
import Computer from '../items/Computer'
import Whiteboard from '../items/Whiteboard'
import VendingMachine from '../items/VendingMachine'
import Jukebox from '../items/Jukebox'
import PredictionBoard from '../items/PredictionBoard'
import '../characters/MyPlayer'
import '../characters/OtherPlayer'
import MyPlayer from '../characters/MyPlayer'
import OtherPlayer from '../characters/OtherPlayer'
import PlayerSelector from '../characters/PlayerSelector'
import Network from '../services/Network'
import { resolveServerUrl } from '../services/serverUrl'
import { IPlayer } from '../../../types/IOfficeState'
import { PlayerBehavior } from '../../../types/PlayerBehavior'
import { ItemType } from '../../../types/Items'

import store from '../stores'
import { setFocused, setShowChat } from '../stores/ChatStore'
import { requestDeleteSignboard, openEditSignboard } from '../stores/SignboardStore'
import { setPlayState, playSongByIndex, setCurrentSong } from '../stores/JukeboxStore'
import {
  addPlacedItem,
  removePlacedItem,
  updatePlacedItemPosition,
  PlacedItem,
  PALETTE_ITEMS,
  setMeetingRoomEntrance,
} from '../stores/MapBuilderStore'
import { setActiveMeetingRoom, clearActiveMeetingRoom } from '../stores/MeetingRoomStore'
import { openExitDialog } from '../stores/UiStore'
import { NavKeys, Keyboard } from '../../../types/KeyboardState'
import { phaserEvents, Event } from '../events/EventCenter'

const TILE_SIZE = 32

// マップ上に常設するミーティングルームの入口。
// マップビルダーの設定に関係なく全ユーザーの画面に必ず表示され、
// 同じidを共有するため、別々のユーザーが同じ入口から入れば同じ部屋で合流できる。
const FIXED_MEETING_ROOMS = [
  { id: 'meeting-room-1', name: '会議室1', x: 473, y: 440 },
]
const FIXED_MEETING_ROOM_SIZE = { width: 96, height: 96 }
// マップビルダーで設置した会議室が共通で使う部屋ID。設置物のIDに依存させないことで、
// 入口を複数置いても・置き直しても、同じホワイトボードと議事録を使い続けられる
const BUILDER_MEETING_ROOM_ID = 'builder-meeting-room'
// 看板の文字に使うフォント。M PLUS 1p は日本語のグリフを持ち、小さい字でも読みやすい。
// 読み込みに失敗した場合に備えて、各OSの標準ゴシックを控えに並べる
// （Inter/Arialは日本語のグリフを持たないため、単独だと明朝などに落ちて汚くなる）
const SIGNBOARD_FONT =
  '"M PLUS 1p", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic UI", "Yu Gothic", Meiryo, sans-serif'

export default class Game extends Phaser.Scene {
  network!: Network
  private cursors!: NavKeys
  private keyE!: Phaser.Input.Keyboard.Key
  private keyR!: Phaser.Input.Keyboard.Key
  myPlayer!: MyPlayer
  private playerSelector!: Phaser.GameObjects.Zone
  private otherPlayers!: Phaser.Physics.Arcade.Group
  private otherPlayerMap = new Map<string, OtherPlayer>()
  computerMap = new Map<string, Computer>()
  private whiteboardMap = new Map<string, Whiteboard>()
  private jukeboxes!: Phaser.Physics.Arcade.StaticGroup
  private predictionBoards!: Phaser.Physics.Arcade.StaticGroup
  private currentSound?: Phaser.Sound.BaseSound

  // 看板（全員同期）
  private signboardMap = new Map<string, Phaser.GameObjects.Container>()
  // 画像を読み込み中の看板テクスチャのキー。addBase64の完了を待つ間に
  // 同じ看板が二重に追加されるのを防ぐ
  private signboardTexLoading = new Set<string>()
  // 読み込み中に届いた看板の編集内容。読み込み完了後にこの内容でやり直す
  private pendingSignboardUpdate = new Map<string, any>()
  // 描画済みの看板の元データ。Webフォントの読み込み完了後に描き直すのに使う
  private signboardData = new Map<string, any>()
  private signboardFontRefreshed = false
  private scaleUpdateTimers = new Map<string, number>()
  // 看板の角ドラッグでの自由リサイズ用（全看板で共有する1つのつまみ）
  private signResizeHandle?: Phaser.GameObjects.Graphics
  private signDeleteButton?: Phaser.GameObjects.Graphics
  private signResizeTarget?: Phaser.GameObjects.Container
  private signHandleHover = false
  private signHandleDragging = false
  private signHandleHideTimer?: number
  // クリックで看板を選択した状態。選択中はホバーを外してもリサイズ/削除ボタンを出したままにする。
  // 端に置かれた画像はホバーで狙いにくいため、クリック選択の方が確実。
  private signSelected = false
  // 看板プレースモード（クリック位置で設置）
  private isPlacingSignboard = false
  private signboardPlacingData: { text: string; image: string; url: string; bgColor: string; textColor: string; scale: number } | null = null
  private signboardPreview: Phaser.GameObjects.Container | null = null
  private signboardPointerMoveHandler: ((pointer: Phaser.Input.Pointer) => void) | null = null
  private signboardPointerDownHandler: ((pointer: Phaser.Input.Pointer) => void) | null = null

  // Map Builder
  private builderGroup!: Phaser.Physics.Arcade.StaticGroup
  private builderSpriteMap = new Map<string, Phaser.Physics.Arcade.Sprite>()
  private builderCursor?: Phaser.GameObjects.Sprite
  private builderGrid?: Phaser.GameObjects.Graphics
  private isBuilderMode = false
  private isPickingMeetingEntrance = false
  private pickingEntranceCursor?: Phaser.GameObjects.Graphics
  private pickingEntranceMoveHandler?: (pointer: Phaser.Input.Pointer) => void
  private pickingEntranceClickHandler?: (pointer: Phaser.Input.Pointer) => void
  private builderPointerHandler?: (pointer: Phaser.Input.Pointer) => void
  private builderMoveHandler?: (pointer: Phaser.Input.Pointer) => void
  private meetingRoomEntrances!: Phaser.Physics.Arcade.StaticGroup
  private activeMeetingRoomId?: string
  private meetingRoomReturn?: { x: number; y: number }
  private meetingRoomCooldown = false

  // ─── 背景画像 & 当たり判定システム ────────────────────────────────────────
  private bgImage!: Phaser.GameObjects.Image
  private customCollidersGroup!: Phaser.Physics.Arcade.StaticGroup

  // デバッグツール用プライベート変数
  private customColliders: Array<{ x: number; y: number; width: number; height: number }> = []
  private isCollidersDebugMode = false
  private physicsDebugGraphic?: Phaser.GameObjects.Graphics
  private debugDrawGraphics!: Phaser.GameObjects.Graphics
  private dragStartX = 0
  private dragStartY = 0
  private isDragging = false
  private hasAskedExit = false
  private exitZoneBounds?: Phaser.Geom.Rectangle
  // ゲームキャンバス上だけで右クリックメニューを抑止するためのハンドラ（bindしてリスナーの追加/削除で同一参照を使う）
  private preventCanvasContextMenu = (e: MouseEvent) => e.preventDefault()

  constructor() {
    super('game')
  }

  registerKeys() {
    this.cursors = {
      ...this.input.keyboard.createCursorKeys(),
      ...(this.input.keyboard.addKeys('W,S,A,D') as Keyboard),
    }

    // maybe we can have a dedicated method for adding keys if more keys are needed in the future
    this.keyE = this.input.keyboard.addKey('E')
    this.keyR = this.input.keyboard.addKey('R')
    this.input.keyboard.disableGlobalCapture()
    this.input.keyboard.on('keydown-ENTER', (event) => {
      store.dispatch(setShowChat(true))
      store.dispatch(setFocused(true))
    })
    this.input.keyboard.on('keydown-ESC', (event) => {
      if (this.isPlacingSignboard) {
        this.exitSignboardPlacement()
        return
      }
      store.dispatch(setShowChat(false))
    })

    this.setupTypingGuard()
    this.refreshSignboardsWhenFontReady()
  }

  // 看板の文字はWebフォント(M PLUS 1p)で描く。読み込みが終わる前にPhaserが描くと
  // 代替フォントのまま固定されてしまうため、読み込み完了後に描き直す。
  // 読み込みを待ってから入室させる作りにはしない（フォントの配信が遅い・届かないときに
  // 入室できなくなるため）。画像のテクスチャは再利用するので描き直しは軽い。
  private refreshSignboardsWhenFontReady() {
    if (!document.fonts?.load) return
    document.fonts
      .load(`13px "M PLUS 1p"`)
      .then(() => {
        if (this.signboardFontRefreshed) return
        this.signboardFontRefreshed = true
        this.signboardData.forEach((data, id) => {
          const container = this.signboardMap.get(id)
          if (container) {
            container.destroy(true)
            this.signboardMap.delete(id)
          }
          const key = `signtex_${id}`
          this.renderSignboard(data, this.textures.exists(key) ? key : null)
        })
      })
      .catch(() => undefined)
  }

  // DOMの入力欄（看板・名前・設定など）で打った文字は、そのままではPhaserにも届いてしまう。
  // そのため看板のテキスト入力中にEnterを押すとチャットが開いてフォーカスを奪われ、
  // 改行が入力できなかった。「w」でキャラが動くのも同じ原因。
  // 入力欄にフォーカスがある間はゲームのキー操作を止める。
  // （チャットはEnterでの送信もEscでの閉じるも自前で処理しているため影響しない）
  private setupTypingGuard() {
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null
      if (!el) return false
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
    }
    const onFocusIn = () => {
      if (isTyping()) this.disableKeys()
    }
    const onFocusOut = () => {
      // フォーカスの移動先が確定してから判定する（入力欄から入力欄への移動で誤って戻さない）
      window.setTimeout(() => {
        if (!isTyping()) this.enableKeys()
      }, 0)
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    this.events.once('shutdown', () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    })
  }

  disableKeys() {
    this.input.keyboard.enabled = false
  }

  enableKeys() {
    this.input.keyboard.enabled = true
    this.input.keyboard.resetKeys()
  }

  create(data: { network: Network }) {
    if (!data.network) {
      throw new Error('server instance missing')
    } else {
      this.network = data.network
    }

    // 右クリックでブラウザ標準メニューを出さない（看板/設置物の右クリック削除に必要）。
    // Phaserの input.mouse.disableContextMenu() は document.body 全体にリスナーを張ってしまい、
    // チャット欄など画面上のReact UIでも右クリック（貼り付け等）が使えなくなるため、
    // ゲームキャンバス要素だけにリスナーを限定する。
    this.game.canvas.addEventListener('contextmenu', this.preventCanvasContextMenu)

    createCharacterAnims(this.anims)

    // 新しい背景画像を配置
    this.bgImage = this.add.image(0, 0, 'new_office_bg').setOrigin(0, 0)
    
    // 画像サイズを基準にマップとカメラのサイズを設定
    const mapWidth = this.bgImage.width
    const mapHeight = this.bgImage.height
    
    // カメラの境界と物理ワールドの境界を、オフィスの背景画像サイズにぴったり一致させる
    // これにより、カメラが画像の外側（暗い背景）を映さないように制限されます。
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight)
    this.physics.world.setBounds(0, 0, mapWidth, mapHeight)

    // アバターの初期配置 (画像中央付近かつコライダーに被らない安全な座標)
    const spawnX = 800
    const spawnY = 380
    this.myPlayer = this.add.myPlayer(spawnX, spawnY, 'adam', this.network.mySessionId)
    this.playerSelector = new PlayerSelector(this, 0, 0, 16, 16)

    // 空のグループを作成して、既存の overlap 設定などを維持
    const chairs = this.physics.add.staticGroup({ classType: Chair })
    const computers = this.physics.add.staticGroup({ classType: Computer })
    const whiteboards = this.physics.add.staticGroup({ classType: Whiteboard })
    const vendingMachines = this.physics.add.staticGroup({ classType: VendingMachine })
    this.jukeboxes = this.physics.add.staticGroup({ classType: Jukebox })

    // ジュークボックス（キャラクターサイズの音楽プレイヤー）を、中央通路の上部・ウォーターサーバーの右側壁沿いに配置
    const jb = new Jukebox(this, 755, 260, 'jukebox')
    // 表示リストと物理ワールドに登録（これで確実に描画され、当たり判定が機能します）
    this.add.existing(jb)
    this.physics.add.existing(jb, true)

    // キャラクターとほぼ同じサイズ（幅32px, 高さ48px）にスケーリングして抜群の視認性を確保
    jb.setDisplaySize(32, 48)
    this.jukeboxes.add(jb)

    // 静的物理ボディのサイズを実寸サイズ（32px, 48px）に合わせて正確に設定
    jb.body.reset(jb.x, jb.y)
    jb.body.setSize(32, 48)
    jb.setDepth(jb.y + 10)

    // ジュークボックスをクリックしたときにメニュー（ダイアログ）を表示
    jb.setInteractive({ useHandCursor: true })
    jb.on('pointerdown', () => {
      jb.openDialog()
    })

    // 予想ボード（エントランス近くに設置）
    this.predictionBoards = this.physics.add.staticGroup({ classType: PredictionBoard })
    const pb = new PredictionBoard(this, 850, 380, 'whiteboards', 0)
    this.add.existing(pb)
    this.physics.add.existing(pb, true)
    pb.setDisplaySize(40, 40)
    this.predictionBoards.add(pb)
    pb.body.reset(pb.x, pb.y)
    pb.body.setSize(40, 40)
    pb.setDepth(pb.y + 10)
    pb.setInteractive({ useHandCursor: true })
    pb.on('pointerdown', () => { pb.openDialog() })

    // カスタムコライダーのロードと衝突設定
    this.customCollidersGroup = this.physics.add.staticGroup()
    this.physics.add.collider(this.myPlayer, this.customCollidersGroup)
    this.loadCustomColliders()
    this.setupCollidersDebugTools()

    // ── 当たり判定デバッグ用 操作ガイドHUD（画面左下に固定表示）──
    // 開発者向けの案内なので開発時のみ出す（デバッグ機能自体も開発時のみ有効）
    if (import.meta.env.DEV) {
      const hudLines = [
        '🔧 当たり判定デバッグ',
        'P : デバッグ表示 ON/OFF',
        '  緑枠 = Tiled座標変換済み',
        '  青枠 = 物理ボディ実位置',
        '  ※両者が重なればOK',
        'K : 全データをコンソール出力',
        'L : collision.jsonにリセット',
      ]
      const hudX = 12
      const hudStartY = mapHeight - 12 - hudLines.length * 18
      hudLines.forEach((line, i) => {
        const t = this.add.text(hudX, hudStartY + i * 18, line, {
          fontSize: '12px',
          color: '#ffffff',
          backgroundColor: '#00000088',
          padding: { x: 4, y: 2 },
          fontFamily: 'monospace',
        })
        t.setScrollFactor(0).setDepth(20000)
      })
    }

    this.otherPlayers = this.physics.add.group({ classType: OtherPlayer })
    this.physics.add.collider(this.myPlayer, this.otherPlayers)
    this.physics.add.collider(this.otherPlayers, this.otherPlayers)
    this.meetingRoomEntrances = this.physics.add.staticGroup()

    // ── 画面中央下の退出（エントランス）ゾーン ──
    // 画像サイズ(941)の最下部ではなく、実際の建物の入り口付近(Y=640周辺)に設置します
    const exitZoneWidth = 200
    const exitZoneHeight = 160 // 届かないバグ防止のため、高さを上方向に広げます
    const exitX = mapWidth / 2 - 40 
    const exitY = 800 - 40 // 重心を少し上にしつつ、下までカバー

    const exitZone = this.add.zone(exitX, exitY, exitZoneWidth, exitZoneHeight)
    this.physics.add.existing(exitZone, true)
    // 出口ゾーンの矩形を保持し、update()で「ゾーンを離れたか」を毎フレーム判定するのに使う
    // （overlapコールバックのタイマーリセットだと、ゾーンに立ち続けている間ダイアログが再表示されてしまうため）
    this.exitZoneBounds = new Phaser.Geom.Rectangle(
      exitX - exitZoneWidth / 2,
      exitY - exitZoneHeight / 2,
      exitZoneWidth,
      exitZoneHeight
    )

    // ゾーンがどこにあるか見えやすいように、床に半透明のマーカーを描画
    const exitMarker = this.add.graphics()
    exitMarker.fillStyle(0xffaa00, 0.3)
    exitMarker.fillRoundedRect(exitX - exitZoneWidth / 2, exitY - exitZoneHeight / 2, exitZoneWidth, exitZoneHeight, 8)
    exitMarker.setDepth(10) // 床の上に表示

    const exitText = this.add.text(exitX, exitY, '▼ 退社', {
      fontSize: '20px',
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5).setDepth(11)

    // ズーム比率を 1.5 に上げて、オフィスが適度な大きさで表示されるようにします。
    this.cameras.main.zoom = 1.5
    this.cameras.main.startFollow(this.myPlayer, true)

    this.physics.add.overlap(
      this.playerSelector,
      [chairs, computers, whiteboards, vendingMachines, this.jukeboxes, this.predictionBoards],
      this.handleItemSelectorOverlap,
      undefined,
      this
    )

    this.physics.add.overlap(
      this.myPlayer,
      this.otherPlayers,
      this.handlePlayersOverlap,
      undefined,
      this
    )

    this.physics.add.overlap(
      this.myPlayer,
      this.meetingRoomEntrances,
      this.handleMeetingRoomEntrance,
      undefined,
      this
    )

    this.physics.add.overlap(
      this.myPlayer,
      exitZone,
      this.handleExitZone,
      undefined,
      this
    )

    // register network event listeners
    this.network.onPlayerJoined(this.handlePlayerJoined, this)
    this.network.onPlayerLeft(this.handlePlayerLeftWithProximity, this)
    this.network.onMyPlayerReady(this.handleMyPlayerReady, this)
    this.network.onMyPlayerVideoConnected(this.handleMyVideoConnected, this)
    this.network.onPlayerUpdated(this.handlePlayerUpdated, this)
    this.network.onItemUserAdded(this.handleItemUserAdded, this)
    this.network.onItemUserRemoved(this.handleItemUserRemoved, this)
    this.network.onChatMessageAdded(this.handleChatMessageAdded, this)

    // Map Builder setup（設置物はサーバ権威の同期状態。schemaのonAdd等で生成される）
    this.builderGroup = this.physics.add.staticGroup()
    this.physics.add.collider(this.myPlayer, this.builderGroup)
    this.rebuildMeetingRoomEntrances()
    this.setupSignboardResizeHandle()

    phaserEvents.on(Event.BUILDER_ENTER, this.enterBuilderMode, this)
    phaserEvents.on(Event.BUILDER_EXIT, this.exitBuilderMode, this)
    phaserEvents.on(Event.BUILDER_IMPORT, this.handleBuilderImport, this)
    phaserEvents.on(Event.BUILDER_CLEAR, this.handleBuilderClear, this)
    phaserEvents.on(Event.BUILDER_PICK_MEETING_ENTRANCE, this.startPickingMeetingEntrance, this)
    phaserEvents.on(Event.MEETING_ROOM_EXIT, this.exitMeetingRoom, this)

    // 設置物の全員同期（サーバ→Phaser）
    phaserEvents.on(Event.BUILDER_ITEM_ADDED, this.handleBuilderItemAdded, this)
    phaserEvents.on(Event.BUILDER_ITEM_REMOVED, this.handleBuilderItemRemoved, this)
    phaserEvents.on(Event.BUILDER_ITEM_MOVED, this.handleBuilderItemMoved, this)
    phaserEvents.on(Event.MEETING_ENTRANCE_CHANGED, this.handleMeetingEntranceChanged, this)

    // Jukebox event listeners
    phaserEvents.on(Event.JUKEBOX_PLAY, this.handleJukeboxPlay, this)
    phaserEvents.on(Event.JUKEBOX_PAUSE, this.handleJukeboxPause, this)
    phaserEvents.on(Event.JUKEBOX_STOP, this.handleJukeboxStop, this)
    phaserEvents.on(Event.JUKEBOX_REPEAT, this.handleJukeboxRepeat, this)
    phaserEvents.on(Event.JUKEBOX_VOLUME, this.handleJukeboxVolume, this)
    phaserEvents.on(Event.JUKEBOX_BROADCAST, this.handleJukeboxBroadcast, this)
    phaserEvents.on('network-jukebox-sync', this.handleNetworkJukeboxSync, this)

    // クリックとドラッグを区別するための移動しきい値（看板の誤ドラッグ防止）
    this.input.dragDistanceThreshold = 6

    // 何もない場所を右クリックすると、そのワールド座標を表示する（マップ調整・座標調べ用）
    this.input.on('pointerdown', this.handleInspectCoordinate, this)

    // Signboard event listeners（全員同期）
    phaserEvents.on(Event.SIGNBOARD_ADDED, this.handleSignboardAdded, this)
    phaserEvents.on(Event.SIGNBOARD_REMOVED, this.handleSignboardRemoved, this)
    phaserEvents.on(Event.SIGNBOARD_MOVED, this.handleSignboardMoved, this)
    phaserEvents.on(Event.SIGNBOARD_SCALED, this.handleSignboardScaled, this)
    phaserEvents.on(Event.SIGNBOARD_UPDATED, this.handleSignboardUpdated, this)
    phaserEvents.on(Event.SIGNBOARD_PLACE, this.handleSignboardPlace, this)
    phaserEvents.on(Event.EMOTE_RECEIVED, this.handleEmote, this)

    // 入室時点で既にサーバー上にある看板・設置物を描画する（再入室で消えないように）。
    // これらの描画イベントはリスナー登録前に発火して取りこぼされるため、ここで明示的に再生する。
    this.network.replayExistingState()

    this.events.once('destroy', () => {
      this.game.canvas.removeEventListener('contextmenu', this.preventCanvasContextMenu)
      this.input.off('pointerdown', this.handleInspectCoordinate, this)
      phaserEvents.off(Event.JUKEBOX_PLAY, this.handleJukeboxPlay, this)
      phaserEvents.off(Event.JUKEBOX_PAUSE, this.handleJukeboxPause, this)
      phaserEvents.off(Event.JUKEBOX_STOP, this.handleJukeboxStop, this)
      phaserEvents.off(Event.JUKEBOX_REPEAT, this.handleJukeboxRepeat, this)
      phaserEvents.off(Event.JUKEBOX_VOLUME, this.handleJukeboxVolume, this)
      phaserEvents.off(Event.JUKEBOX_BROADCAST, this.handleJukeboxBroadcast, this)
      phaserEvents.off('network-jukebox-sync', this.handleNetworkJukeboxSync, this)
      phaserEvents.off(Event.BUILDER_PICK_MEETING_ENTRANCE, this.startPickingMeetingEntrance, this)
      phaserEvents.off(Event.MEETING_ROOM_EXIT, this.exitMeetingRoom, this)
      phaserEvents.off(Event.BUILDER_ITEM_ADDED, this.handleBuilderItemAdded, this)
      phaserEvents.off(Event.BUILDER_ITEM_REMOVED, this.handleBuilderItemRemoved, this)
      phaserEvents.off(Event.BUILDER_ITEM_MOVED, this.handleBuilderItemMoved, this)
      phaserEvents.off(Event.MEETING_ENTRANCE_CHANGED, this.handleMeetingEntranceChanged, this)
      phaserEvents.off(Event.SIGNBOARD_ADDED, this.handleSignboardAdded, this)
      phaserEvents.off(Event.SIGNBOARD_REMOVED, this.handleSignboardRemoved, this)
      phaserEvents.off(Event.SIGNBOARD_MOVED, this.handleSignboardMoved, this)
      phaserEvents.off(Event.SIGNBOARD_SCALED, this.handleSignboardScaled, this)
      phaserEvents.off(Event.SIGNBOARD_UPDATED, this.handleSignboardUpdated, this)
      phaserEvents.off(Event.SIGNBOARD_PLACE, this.handleSignboardPlace, this)
      phaserEvents.off(Event.EMOTE_RECEIVED, this.handleEmote, this)
    })
  }

  // ─── エモート（頭上フロートテキスト） ────────────────────────────────────────────
  private handleEmote(sessionId: string, emoji: string, stampId?: string) {
    let target: Phaser.GameObjects.Sprite | null = null
    if (sessionId === this.network?.mySessionId) {
      target = this.myPlayer
    } else {
      target = this.otherPlayerMap.get(sessionId) || null
    }
    if (!target) return

    const x = target.x
    const y = target.y - 56

    // 登録スタンプなら画像を頭上に出す。誰がリアクションしたのかが
    // チャットを見ていなくても部屋の中で分かるようにする
    if (stampId) {
      this.showStampAbovePlayer(x, y, stampId)
      return
    }

    const text = this.add
      .text(x, y, emoji, {
        fontSize: '32px',
        backgroundColor: 'rgba(0,0,0,0.45)',
        padding: { x: 6, y: 4 },
      })
      .setDepth(20000)
      .setOrigin(0.5)

    // しばらく（約3.2秒）表示してから最後にフェードアウト（合計約4秒）
    this.tweens.add({
      targets: text,
      y: y - 36,
      alpha: 0,
      delay: 3200,
      duration: 800,
      ease: 'Power2',
      onComplete: () => text.destroy(),
    })
  }

  // 頭上に出したスタンプ画像のテクスチャキー（読み込み中の二重取得を防ぐ）
  private stampTexLoading = new Set<string>()

  private showStampAbovePlayer(x: number, y: number, stampId: string) {
    const stamp = store.getState().stamp.stamps[stampId]
    if (!stamp) return
    const key = `stamptex_${stampId}`

    const draw = () => {
      const img = this.add.image(x, y - 10, key).setDepth(20000).setOrigin(0.5)
      // 元画像の大きさはまちまちなので、頭上に収まる高さに揃える
      const scale = Math.min(1, 64 / Math.max(img.height, 1))
      img.setScale(scale)
      // 画像は写真ではないが、縮小時にガタつかないよう滑らかに補間する
      this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR)
      // 頭上でしばらく（約3.2秒）そのまま表示し、最後にフェードアウト（合計約4秒）
      this.tweens.add({
        targets: img,
        y: y - 46,
        alpha: 0,
        delay: 3200,
        duration: 800,
        ease: 'Power2',
        onComplete: () => img.destroy(),
      })
    }

    if (this.textures.exists(key)) {
      draw()
      return
    }
    // 同じスタンプが連続で飛んできても二重に読み込まない
    // （読み込み中に再度addすると「Texture key already in use」で例外になる）
    if (this.stampTexLoading.has(key)) return
    this.stampTexLoading.add(key)
    this.load.image(key, resolveServerUrl(stamp.url))
    this.load.once('complete', () => {
      this.stampTexLoading.delete(key)
      if (this.textures.exists(key)) draw()
    })
    this.load.start()
  }

  // ─── 看板（全員同期） ────────────────────────────────────────────────────────

  private handleSignboardPlace(content: { text: string; image: string; url: string; bgColor: string; textColor: string; scale: number }) {
    if (this.isPlacingSignboard) this.exitSignboardPlacement()
    this.signboardPlacingData = content
    this.isPlacingSignboard = true
    this.input.setDefaultCursor('crosshair')
    this.signboardPreview = this.buildSignboardPreview(content)

    this.signboardPointerMoveHandler = (pointer: Phaser.Input.Pointer) => {
      if (!this.signboardPreview) return
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      const cardW = (this.signboardPreview.getData('cardW') as number) || 100
      const cardH = (this.signboardPreview.getData('cardH') as number) || 40
      this.signboardPreview.setPosition(wp.x - cardW / 2, wp.y - cardH - 24)
    }

    this.signboardPointerDownHandler = (pointer: Phaser.Input.Pointer) => {
      if (!this.isPlacingSignboard || !this.signboardPlacingData) return
      if (pointer.rightButtonDown()) {
        this.exitSignboardPlacement()
        return
      }
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      this.network.addSignboard({
        x: Math.round(wp.x),
        y: Math.round(wp.y),
        text: this.signboardPlacingData.text,
        image: this.signboardPlacingData.image,
        url: this.signboardPlacingData.url,
        bgColor: this.signboardPlacingData.bgColor,
        textColor: this.signboardPlacingData.textColor,
        scale: this.signboardPlacingData.scale,
      })
      this.exitSignboardPlacement()
    }

    this.input.on('pointermove', this.signboardPointerMoveHandler)
    this.input.on('pointerdown', this.signboardPointerDownHandler)
  }

  private buildSignboardPreview(data: { text: string; bgColor: string; textColor: string; scale: number }): Phaser.GameObjects.Container {
    const PAD = 8
    const MAX_W = 160
    const bgNum = parseInt((data.bgColor || '#fff8e1').replace('#', ''), 16)
    const items: Phaser.GameObjects.GameObject[] = []
    let contentW = 0
    let cursorY = PAD

    if (data.text) {
      // 設置プレビューは実際の看板と同じ見た目にする（フォントが違うと大きさがズレる）
      const txt = this.add.text(PAD, cursorY, data.text, {
        fontFamily: SIGNBOARD_FONT,
        fontSize: '13px',
        color: data.textColor || '#1a1a1a',
        wordWrap: { width: MAX_W },
      }).setOrigin(0, 0)
      items.push(txt)
      contentW = Math.max(contentW, txt.width)
      cursorY += txt.height
    }

    const cardW = Math.max(contentW + PAD * 2, 60)
    const cardH = Math.max(cursorY + PAD, 30)

    const bg = this.add.graphics()
    bg.fillStyle(bgNum, 0.7)
    bg.fillRoundedRect(0, 0, cardW, cardH, 8)
    bg.lineStyle(2, 0x4488ff, 1)
    bg.strokeRoundedRect(0, 0, cardW, cardH, 8)

    const container = this.add.container(0, 0)
    container.add(bg)
    items.forEach(c => container.add(c))
    container.setAlpha(0.75)
    container.setScale(data.scale || 1)
    container.setDepth(999999)
    container.setData('cardW', cardW)
    container.setData('cardH', cardH)
    return container
  }

  private exitSignboardPlacement() {
    this.isPlacingSignboard = false
    this.signboardPlacingData = null
    if (this.signboardPreview) {
      this.signboardPreview.destroy(true)
      this.signboardPreview = null
    }
    if (this.signboardPointerMoveHandler) {
      this.input.off('pointermove', this.signboardPointerMoveHandler)
      this.signboardPointerMoveHandler = null
    }
    if (this.signboardPointerDownHandler) {
      this.input.off('pointerdown', this.signboardPointerDownHandler)
      this.signboardPointerDownHandler = null
    }
    this.input.setDefaultCursor('default')
  }

  private handleSignboardAdded(data: {
    id: string
    x: number
    y: number
    text: string
    image: string
    url: string
    createdBy: string
    bgColor?: string
    textColor?: string
    scale?: number
  }) {
    if (this.signboardMap.has(data.id)) return

    if (data.image) {
      const key = `signtex_${data.id}`
      if (this.textures.exists(key)) {
        this.renderSignboard(data, key)
      } else if (!this.signboardTexLoading.has(key)) {
        // addBase64は画像のデコードを待つ非同期処理。同じ看板が二重に追加されると
        // （サーバーのonAddと入室時のreplayなど）、まだテクスチャが登録されていないため
        // 上のexists判定をすり抜けて二重にaddBase64してしまい、
        // 「Texture key already in use」→ addImageがnull → onload内で未捕捉のTypeError
        // となって看板が表示されなくなる。読み込み中のキーを覚えて二重起動を防ぐ。
        this.signboardTexLoading.add(key)
        const onAdd = (addedKey: string) => {
          if (addedKey !== key) return
          this.textures.off('addtexture', onAdd)
          this.signboardTexLoading.delete(key)
          // 読み込み中に編集された場合は、古い内容を描かず最新の内容でやり直す
          const pending = this.pendingSignboardUpdate.get(data.id)
          if (pending) {
            this.pendingSignboardUpdate.delete(data.id)
            this.handleSignboardUpdated(pending)
            return
          }
          // 削除済みなら描画しない
          if (this.signboardMap.has(data.id)) return
          this.renderSignboard(data, key)
        }
        this.textures.on('addtexture', onAdd)
        this.textures.addBase64(key, data.image)
      }
    } else {
      this.renderSignboard(data, null)
    }
  }

  private handleSignboardRemoved(id: string) {
    this.signboardData.delete(id)
    const container = this.signboardMap.get(id)
    if (container) {
      container.destroy(true)
      this.signboardMap.delete(id)
    }
    // 消した看板につまみが付いていたら隠す
    if (this.signResizeTarget && this.signResizeTarget.getData('signboardId') === id) {
      this.signResizeHandle?.setVisible(false)
      this.signDeleteButton?.setVisible(false)
      this.signResizeTarget = undefined
      this.signSelected = false
    }
    const key = `signtex_${id}`
    if (this.textures.exists(key)) this.textures.remove(key)
  }

  // 看板の角ドラッグでの自由リサイズ用つまみ（全看板で共有する1つ）
  private setupSignboardResizeHandle() {
    if (this.signResizeHandle) return
    const handle = this.add.graphics().setDepth(40000).setVisible(false)
    handle.fillStyle(0x4a93cf, 1)
    handle.fillCircle(0, 0, 9)
    handle.lineStyle(2.5, 0xffffff, 1)
    handle.strokeCircle(0, 0, 9)
    // 斜め矢印っぽい線でリサイズと分かるように
    handle.lineStyle(2, 0xffffff, 1)
    handle.lineBetween(-4, -4, 4, 4)
    handle.setInteractive(new Phaser.Geom.Circle(0, 0, 16), Phaser.Geom.Circle.Contains)
    this.input.setDraggable(handle)
    this.input.setDefaultCursor('default')

    handle.on('pointerover', () => {
      this.signHandleHover = true
      this.input.setDefaultCursor('nwse-resize')
    })
    handle.on('pointerout', () => {
      this.signHandleHover = false
      this.input.setDefaultCursor('default')
      this.hideResizeHandleSoon()
    })
    handle.on('dragstart', () => { this.signHandleDragging = true })
    handle.on('drag', (pointer: Phaser.Input.Pointer) => {
      const target = this.signResizeTarget
      if (!target) return
      const cardW = (target.getData('cardW') as number) || 40
      // つまみは右下角。ポインタと看板左上(target.x,target.y)の距離から幅→スケールを求める
      const newW = pointer.worldX - target.x
      const scale = Phaser.Math.Clamp(newW / cardW, 0.3, 3)
      target.setScale(scale)
      this.positionResizeHandle(target)
    })
    handle.on('dragend', () => {
      this.signHandleDragging = false
      const target = this.signResizeTarget
      if (target) this.network.updateSignboardScale(target.getData('signboardId') as string, target.scaleX)
      this.hideResizeHandleSoon()
    })

    this.signResizeHandle = handle

    // 削除ボタン（赤い✕）。看板をホバー/選択したとき左下角に出る。
    // 以前は右クリックでしか消せず気づきにくかったため、見えるボタンで消せるようにする。
    // 看板は下側の方が画面内に入りやすい（上端に置かれた画像看板でも届く）ので左下に置く。
    const del = this.add.graphics().setDepth(40001).setVisible(false)
    del.fillStyle(0xe23b3b, 1)
    del.fillCircle(0, 0, 10)
    del.lineStyle(2.5, 0xffffff, 1)
    del.strokeCircle(0, 0, 10)
    del.lineBetween(-4, -4, 4, 4)
    del.lineBetween(-4, 4, 4, -4)
    del.setInteractive(new Phaser.Geom.Circle(0, 0, 16), Phaser.Geom.Circle.Contains)
    del.on('pointerover', () => { this.signHandleHover = true; this.input.setDefaultCursor('pointer') })
    del.on('pointerout', () => { this.signHandleHover = false; this.input.setDefaultCursor('default'); this.hideResizeHandleSoon() })
    del.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const target = this.signResizeTarget
      if (!target) return
      // 削除確認ダイアログをReact側に依頼（右クリック削除と同じ導線）
      store.dispatch(requestDeleteSignboard({ id: target.getData('signboardId') as string, x: pointer.x, y: pointer.y }))
    })
    this.signDeleteButton = del

    // 看板・つまみ・削除ボタン以外をクリックしたら選択を解除して隠す
    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
      if (!this.signSelected) return
      const onControls =
        (!!this.signResizeTarget && currentlyOver.includes(this.signResizeTarget)) ||
        (!!this.signResizeHandle && currentlyOver.includes(this.signResizeHandle)) ||
        (!!this.signDeleteButton && currentlyOver.includes(this.signDeleteButton))
      if (!onControls) {
        this.signSelected = false
        this.signResizeHandle?.setVisible(false)
        this.signDeleteButton?.setVisible(false)
        this.signResizeTarget = undefined
      }
    })
  }

  private positionResizeHandle(target: Phaser.GameObjects.Container) {
    if (!this.signResizeHandle) return
    const cardW = (target.getData('cardW') as number) || 40
    const cardH = (target.getData('cardH') as number) || 40
    this.signResizeHandle.setPosition(target.x + cardW * target.scaleX, target.y + cardH * target.scaleY)
    this.signResizeHandle.setVisible(true)
    // 削除ボタンは左下角
    this.signDeleteButton?.setPosition(target.x, target.y + cardH * target.scaleY).setVisible(true)
  }

  private showResizeHandleFor(target: Phaser.GameObjects.Container) {
    if (this.signHandleHideTimer) { window.clearTimeout(this.signHandleHideTimer); this.signHandleHideTimer = undefined }
    this.signResizeTarget = target
    this.positionResizeHandle(target)
  }

  // 看板・つまみのどちらからも離れたら少し待ってつまみを隠す
  private hideResizeHandleSoon() {
    if (this.signHandleHideTimer) window.clearTimeout(this.signHandleHideTimer)
    this.signHandleHideTimer = window.setTimeout(() => {
      // ドラッグ中・つまみ上・クリック選択中は隠さない
      if (this.signHandleDragging || this.signHandleHover || this.signSelected) return
      this.signResizeHandle?.setVisible(false)
      this.signDeleteButton?.setVisible(false)
      this.signResizeTarget = undefined
    }, 250)
  }

  private renderSignboard(
    data: { id: string; x: number; y: number; text: string; url: string; image?: string; bgColor?: string; textColor?: string; scale?: number },
    texKey: string | null
  ) {
    this.signboardData.set(data.id, data)

    const MAX_W = 160
    // 画像だけの看板（文字なし）は、画像をそのまま貼りたいので枠も余白も付けない
    const hasImage = !!(texKey && this.textures.exists(texKey))
    const imageOnly = hasImage && !data.text
    const PAD = imageOnly ? 0 : 8

    const children: Phaser.GameObjects.GameObject[] = []
    let contentW = 0
    let cursorY = PAD
    const bgColorHex = parseInt((data.bgColor || '#fff8e1').replace('#', ''), 16)
    const textColor = data.textColor || '#1a1a1a'
    const signScale = data.scale || 1

    if (texKey && this.textures.exists(texKey)) {
      const src = this.textures.get(texKey).getSourceImage() as { width: number; height: number }
      const imgScale = Math.min(1, MAX_W / src.width)
      const dw = src.width * imgScale
      const dh = src.height * imgScale
      const img = this.add.image(PAD, cursorY, texKey).setOrigin(0, 0).setScale(imgScale)
      // 看板の画像は元サイズ(最大480px)から1/3ほどに縮小して表示される。
      // ゲーム設定がpixelArt(NEARESTフィルタ)のままだと縮小時に画素が間引かれ、
      // 漫画やスクリーンショットの細い線・文字が潰れて読めなくなる。
      // ドット絵ではないので、看板の画像だけ滑らかに補間する(LINEAR)。
      this.textures.get(texKey).setFilter(Phaser.Textures.FilterMode.LINEAR)
      children.push(img)
      contentW = Math.max(contentW, dw)
      cursorY += dh + (data.text ? 6 : 0)
    }

    if (data.text) {
      const txt = this.add
        .text(PAD, cursorY, data.text, {
          // Inter/Arialは日本語のグリフを持たないため、日本語は環境任せのフォールバックになり
          // Windowsでは細く滲んだ字面になっていた。各OSの標準ゴシックを明示して読みやすくする。
          fontFamily: SIGNBOARD_FONT,
          fontSize: '13px',
          color: textColor,
          wordWrap: { width: MAX_W },
        })
        .setOrigin(0, 0)
      // 看板は拡大表示されることが多い。ゲーム設定がpixelArt(NEARESTフィルタ)なので
      // テキストをそのまま拡大すると文字がガタガタ・ボヤけて見える。
      // 高解像度でレンダリングし、テキスト用テクスチャだけ滑らかに補間する(LINEAR)。
      txt.setResolution(Math.min(4, Math.ceil((window.devicePixelRatio || 1) * 3)))
      txt.texture?.setFilter(Phaser.Textures.FilterMode.LINEAR)
      children.push(txt)
      contentW = Math.max(contentW, txt.width)
      cursorY += txt.height
    }

    const cardW = imageOnly ? contentW : Math.max(contentW + PAD * 2, 40)
    const cardH = cursorY + PAD

    // 画像だけの看板には背景と枠を描かない（画像の周りにフチが出ないように）
    const bg = imageOnly ? null : this.add.graphics()
    if (bg) {
      bg.fillStyle(bgColorHex, 1)
      bg.fillRoundedRect(0, 0, cardW, cardH, 8)
      bg.lineStyle(2, data.url ? 0x1a6b2a : 0xb0a070, 1)
      bg.strokeRoundedRect(0, 0, cardW, cardH, 8)
    }

    // プレイヤーの少し上に表示
    const OFFSET_Y = 24
    const container = this.add.container(data.x - cardW / 2, data.y - cardH - OFFSET_Y)
    if (bg) container.add(bg)
    children.forEach((c) => container.add(c))
    container.setSize(cardW, cardH)
    container.setScale(signScale)
    container.setData('signboardId', data.id)
    container.setData('cardW', cardW)
    container.setData('cardH', cardH)
    container.setData('offsetY', OFFSET_Y)
    container.setData('signText', data.text || '')
    container.setData('signUrl', data.url || '')
    container.setData('signImage', (data as any).image || '')
    container.setData('signBgColor', data.bgColor || '#fff8e1')
    container.setData('signTextColor', data.textColor || '#1a1a1a')
    container.setDepth(data.y)
    container.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, cardW, cardH),
      Phaser.Geom.Rectangle.Contains
    )
    this.input.setDraggable(container)

    container.on('pointerover', () => {
      this.input.setDefaultCursor('pointer')
      // 右下にリサイズつまみを出す（角ドラッグで自由に拡大縮小できる）
      this.showResizeHandleFor(container)
    })
    container.on('pointerout', () => {
      this.input.setDefaultCursor('default')
      this.hideResizeHandleSoon()
    })

    container.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      container.setData('moved', false)
      if (pointer.rightButtonDown()) {
        container.setData('suppressClick', true)
        // 削除確認ダイアログをReact側に依頼
        store.dispatch(requestDeleteSignboard({ id: data.id, x: pointer.x, y: pointer.y }))
      } else {
        container.setData('suppressClick', false)
        // 左クリックで選択＝リサイズ/削除ボタンを出したままにする（ホバー不要で確実）
        this.signSelected = true
        this.showResizeHandleFor(container)
      }
    })

    // ドラッグで自由に移動（離した時点で全員に同期）
    container.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      container.setData('moved', true)
      container.x = dragX
      container.y = dragY
      container.setDepth(dragY + cardH + OFFSET_Y)
      if (this.signResizeTarget === container) this.positionResizeHandle(container)
    })
    container.on('dragend', () => {
      const bx = Math.round(container.x + cardW / 2)
      const by = Math.round(container.y + cardH + OFFSET_Y)
      this.network.updateSignboard(data.id, bx, by)
    })

    // ホイール/トラックパッドでリアルタイムスケール変更（デバウンス500msで全員に同期）。
    // Macのトラックパッドは deltaY が小さく（±1〜4）、係数だけだと変化が微小で
    // 「効かない」ように見えるため、小さい値のときは一定ステップにする。
    container.on('wheel', (_ptr: unknown, _dx: number, deltaY: number) => {
      const cur = container.scaleX
      const step = Math.abs(deltaY) >= 20 ? deltaY * 0.0015 : Math.sign(deltaY) * 0.06
      const next = Math.min(3, Math.max(0.3, cur - step))
      container.setScale(next)
      if (this.signResizeTarget === container) this.positionResizeHandle(container)
      const prev = this.scaleUpdateTimers.get(data.id)
      if (prev !== undefined) window.clearTimeout(prev)
      this.scaleUpdateTimers.set(data.id, window.setTimeout(() => {
        this.network.updateSignboardScale(data.id, next)
        this.scaleUpdateTimers.delete(data.id)
      }, 500))
    })

    container.on('pointerup', () => {
      if (container.getData('moved') || container.getData('suppressClick')) return
      store.dispatch(openEditSignboard({
        id: data.id,
        text: container.getData('signText') as string,
        url: container.getData('signUrl') as string,
        image: container.getData('signImage') as string,
        bgColor: container.getData('signBgColor') as string,
        textColor: container.getData('signTextColor') as string,
        scale: container.scaleX,
      }))
    })

    this.signboardMap.set(data.id, container)
  }

  private handleSignboardMoved(data: { id: string; x: number; y: number }) {
    const container = this.signboardMap.get(data.id)
    if (!container) return
    const cardW = container.getData('cardW') as number
    const cardH = container.getData('cardH') as number
    const offsetY = container.getData('offsetY') as number
    container.setPosition(data.x - cardW / 2, data.y - cardH - offsetY)
    container.setDepth(data.y)
  }

  private handleSignboardScaled(data: { id: string; scale: number }) {
    const container = this.signboardMap.get(data.id)
    if (container) container.setScale(data.scale)
  }

  private handleSignboardUpdated(data: {
    id: string; x: number; y: number; text: string; image: string; url: string
    bgColor: string; textColor: string; scale: number
  }) {
    const texKey = `signtex_${data.id}`
    // 画像の読み込み中に編集が来たら、いま作り直しても二重読み込みになる。
    // 完了時にこの内容でやり直させる（onAddがpendingSignboardUpdateを見る）
    if (this.signboardTexLoading.has(texKey)) {
      this.pendingSignboardUpdate.set(data.id, data)
      return
    }
    const existing = this.signboardMap.get(data.id)
    if (existing) {
      existing.destroy(true)
      this.signboardMap.delete(data.id)
    }
    if (this.textures.exists(texKey)) this.textures.remove(texKey)
    this.handleSignboardAdded({ ...data, createdBy: '' })
  }

  // ─── Map Builder ────────────────────────────────────────────────────────────

  private getTextureKey(itemType: string): string {
    switch (itemType) {
      case 'chair':
        return 'chairs'
      case 'computer':
        return 'computers'
      case 'whiteboard':
        return 'whiteboards'
      case 'vendingmachine':
        return 'vendingmachines'
      case 'meetingroom':
        return 'whiteboards'
      default:
        return 'chairs'
    }
  }

  // サーバから設置物が追加されたとき（自分の操作の反映を含む）
  private handleBuilderItemAdded(item: PlacedItem) {
    if (this.builderSpriteMap.has(item.id)) return
    store.dispatch(addPlacedItem(item))
    this.spawnBuilderSprite(item, this.isBuilderMode)
    if (item.itemType === 'meetingroom') this.rebuildMeetingRoomEntrances()
  }

  private handleBuilderItemRemoved(id: string) {
    const sprite = this.builderSpriteMap.get(id)
    const wasMeeting = sprite?.getData('builderType') === 'meetingroom'
    if (sprite) {
      sprite.destroy()
      this.builderSpriteMap.delete(id)
    }
    store.dispatch(removePlacedItem(id))
    if (wasMeeting) this.rebuildMeetingRoomEntrances()
  }

  private handleBuilderItemMoved(data: { id: string; x: number; y: number }) {
    const sprite = this.builderSpriteMap.get(data.id)
    if (sprite) {
      sprite.setPosition(data.x, data.y)
      sprite.setDepth(data.y)
      ;(sprite.body as Phaser.Physics.Arcade.StaticBody)?.reset(data.x, data.y)
    }
    store.dispatch(updatePlacedItemPosition({ id: data.id, x: data.x, y: data.y }))
    if (sprite?.getData('builderType') === 'meetingroom') this.rebuildMeetingRoomEntrances()
  }

  private handleMeetingEntranceChanged(data: { x: number; y: number }) {
    store.dispatch(setMeetingRoomEntrance(data.x < 0 ? null : { x: data.x, y: data.y }))
    this.rebuildMeetingRoomEntrances()
  }

  // インポート（JSONから一括復元）: 受け取った設置物をサーバへ送信し全員へ反映
  private handleBuilderImport(payload: { items: PlacedItem[]; entrance: { x: number; y: number } | null }) {
    this.network.clearBuilderItems()
    payload.items.forEach((item) => this.network.addBuilderItem(item))
    this.network.setMeetingEntrance(payload.entrance ? payload.entrance.x : -1, payload.entrance ? payload.entrance.y : -1)
  }

  // 全消去（全員に反映）
  private handleBuilderClear() {
    this.network.clearBuilderItems()
    this.network.setMeetingEntrance(-1, -1)
  }

  private getMeetingRooms() {
    // 常設の会議室（全ユーザー共通・マップビルダーの設定に依存しない）
    const fixedRooms = FIXED_MEETING_ROOMS.map((room) => ({
      ...room,
      width: FIXED_MEETING_ROOM_SIZE.width,
      height: FIXED_MEETING_ROOM_SIZE.height,
    }))

    const entrance = store.getState().mapBuilder.meetingRoomEntrance
    const savedEntranceRooms = entrance
      ? [
          {
            id: 'custom-meeting-room-entrance',
            name: 'Meeting Room',
            x: entrance.x,
            y: entrance.y,
            width: TILE_SIZE,
            height: TILE_SIZE,
          },
        ]
      : []
    // マップビルダーで置いた会議室は、どの入口から入っても同じ部屋にする。
    // 以前は設置物ごとのID（item.id）を部屋IDにしていたため、
    //  ・同じ部屋に入口を2か所置くと、別々のホワイトボードになってしまう
    //  ・置き直すとIDが変わり、それまでの中身が開けなくなる
    // という問題があった。IDを固定にすることで入口を何か所置いても中身は1つに保たれる。
    const placedRooms = store
      .getState()
      .mapBuilder.placedItems.filter((item) => item.itemType === 'meetingroom')
      .map((item) => ({
        id: BUILDER_MEETING_ROOM_ID,
        name: 'ミーティングルーム',
        x: item.x,
        y: item.y,
        width: 128,
        height: 96,
      }))

    return [...fixedRooms, ...savedEntranceRooms, ...placedRooms]
  }

  private rebuildMeetingRoomEntrances() {
    if (!this.meetingRoomEntrances) return
    this.meetingRoomEntrances.clear(true, true)

    // 入口は見た目を持たない透明なゾーン。マップの絵の上に枠を重ねない
    this.getMeetingRooms().forEach((room) => {
      const zone = this.add.zone(room.x, room.y, room.width, room.height)
      zone.setData('meetingRoom', {
        ...room,
        returnX: room.x,
        returnY: room.y - TILE_SIZE,
      })
      this.physics.add.existing(zone, true)
      this.meetingRoomEntrances.add(zone)
    })
  }

  private spawnBuilderSprite(item: PlacedItem, draggable = true) {
    const textureKey = this.getTextureKey(item.itemType)
    const sprite = this.builderGroup.get(
      item.x,
      item.y,
      textureKey,
      item.frame
    ) as Phaser.Physics.Arcade.Sprite

    sprite.setDepth(item.y)
    sprite.setData('builderId', item.id)
    sprite.setData('builderType', item.itemType)
    sprite.setData('builderFrame', item.frame)
    sprite.setData('builderDirection', item.direction)

    if (draggable) {
      this.makeBuilderSpriteInteractive(sprite)
    }

    this.builderSpriteMap.set(item.id, sprite)
    return sprite
  }

  private makeBuilderSpriteInteractive(sprite: Phaser.Physics.Arcade.Sprite) {
    sprite.setInteractive()
    this.input.setDraggable(sprite)

    sprite.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      sprite.x = Math.round(dragX / TILE_SIZE) * TILE_SIZE
      sprite.y = Math.round(dragY / TILE_SIZE) * TILE_SIZE
      sprite.setDepth(sprite.y)
    })

    sprite.on('dragend', () => {
      ;(sprite.body as Phaser.Physics.Arcade.StaticBody).reset(sprite.x, sprite.y)
      // 移動はサーバ経由で全員に同期（エコーで store も更新される）
      this.network.moveBuilderItem(sprite.getData('builderId'), sprite.x, sprite.y)
    })

    sprite.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) {
        const id = sprite.getData('builderId') as string
        // 削除はサーバ経由で全員に同期（onRemoveでスプライト破棄）
        this.network.removeBuilderItem(id)
      }
    })
  }

  private enterBuilderMode() {
    if (this.isBuilderMode) return
    this.isBuilderMode = true

    // Enable interactivity on all existing builder sprites
    this.builderSpriteMap.forEach((sprite) => this.makeBuilderSpriteInteractive(sprite))

    // Draw grid
    this.builderGrid = this.add.graphics()
    this.builderGrid.lineStyle(1, 0x4488ff, 0.15)
    const mapWidth = this.bgImage.width
    const mapHeight = this.bgImage.height
    for (let x = 0; x <= mapWidth; x += TILE_SIZE) {
      this.builderGrid.lineBetween(x, 0, x, mapHeight)
    }
    for (let y = 0; y <= mapHeight; y += TILE_SIZE) {
      this.builderGrid.lineBetween(0, y, mapWidth, y)
    }
    this.builderGrid.setDepth(9000)

    // Cursor preview sprite
    this.builderCursor = this.add.sprite(0, 0, 'chairs', 0)
    this.builderCursor.setAlpha(0.5)
    this.builderCursor.setDepth(9999)
    this.builderCursor.setVisible(false)

    // Pointer move → update cursor
    this.builderMoveHandler = (pointer: Phaser.Input.Pointer) => {
      const state = store.getState().mapBuilder
      if (state.selectedPaletteIndex === null) {
        this.builderCursor?.setVisible(false)
        return
      }
      const palette = PALETTE_ITEMS[state.selectedPaletteIndex]
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      const snappedX = Math.round(worldPoint.x / TILE_SIZE) * TILE_SIZE
      const snappedY = Math.round(worldPoint.y / TILE_SIZE) * TILE_SIZE
      if (this.builderCursor) {
        this.builderCursor.setTexture(this.getTextureKey(palette.itemType), palette.frame)
        this.builderCursor.setPosition(snappedX, snappedY)
        this.builderCursor.setVisible(true)
      }
    }
    this.input.on('pointermove', this.builderMoveHandler)

    // Pointer down → place item
    this.builderPointerHandler = (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) return
      const state = store.getState().mapBuilder
      if (state.selectedPaletteIndex === null) return

      // Don't place if clicking on an existing builder sprite
      if (this.input.hitTestPointer(pointer).some((go) => go.getData('builderId'))) return

      const palette = PALETTE_ITEMS[state.selectedPaletteIndex]
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      const snappedX = Math.round(worldPoint.x / TILE_SIZE) * TILE_SIZE
      const snappedY = Math.round(worldPoint.y / TILE_SIZE) * TILE_SIZE

      const id = `builder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const newItem: PlacedItem = {
        id,
        itemType: palette.itemType,
        x: snappedX,
        y: snappedY,
        frame: palette.frame,
        direction: palette.direction,
      }

      // 設置はサーバ経由で全員に同期（onAddでスプライト生成）
      this.network.addBuilderItem(newItem)
    }
    this.input.on('pointerdown', this.builderPointerHandler)
  }

  private exitBuilderMode() {
    if (!this.isBuilderMode) return
    this.isBuilderMode = false

    // Remove event listeners
    if (this.builderPointerHandler) {
      this.input.off('pointerdown', this.builderPointerHandler)
      this.builderPointerHandler = undefined
    }
    if (this.builderMoveHandler) {
      this.input.off('pointermove', this.builderMoveHandler)
      this.builderMoveHandler = undefined
    }

    // Cleanup grid and cursor
    this.builderGrid?.destroy()
    this.builderGrid = undefined
    this.builderCursor?.destroy()
    this.builderCursor = undefined

    // Disable interactivity on builder sprites
    this.builderSpriteMap.forEach((sprite) => {
      sprite.removeInteractive()
      sprite.removeAllListeners('drag')
      sprite.removeAllListeners('dragend')
      sprite.removeAllListeners('pointerdown')
    })
  }

  // ─── ミーティングルーム入口指定モード ───────────────────────────────────────

  private startPickingMeetingEntrance() {
    if (this.isPickingMeetingEntrance) return
    this.isPickingMeetingEntrance = true

    // 緑色の半透明カーソル矩形（タイル1マス分）
    this.pickingEntranceCursor = this.add.graphics()
    this.pickingEntranceCursor.setDepth(9998)

    const drawCursor = (wx: number, wy: number) => {
      const sx = Math.round(wx / TILE_SIZE) * TILE_SIZE
      const sy = Math.round(wy / TILE_SIZE) * TILE_SIZE
      this.pickingEntranceCursor!.clear()
      this.pickingEntranceCursor!
        .fillStyle(0x00ff88, 0.35)
        .fillRect(sx - TILE_SIZE / 2, sy - TILE_SIZE / 2, TILE_SIZE, TILE_SIZE)
        .lineStyle(2, 0x00ff88, 0.9)
        .strokeRect(sx - TILE_SIZE / 2, sy - TILE_SIZE / 2, TILE_SIZE, TILE_SIZE)
    }

    // マウス移動でカーソルを追従
    this.pickingEntranceMoveHandler = (pointer: Phaser.Input.Pointer) => {
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      drawCursor(wp.x, wp.y)
    }
    this.input.on('pointermove', this.pickingEntranceMoveHandler)

    // クリックで入口を確定
    this.pickingEntranceClickHandler = (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) {
        // 右クリックでキャンセル
        this.stopPickingMeetingEntrance()
        return
      }
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      const sx = Math.round(wp.x / TILE_SIZE) * TILE_SIZE
      const sy = Math.round(wp.y / TILE_SIZE) * TILE_SIZE
      // 入口設定はサーバ経由で全員に同期
      this.network.setMeetingEntrance(sx, sy)
      this.stopPickingMeetingEntrance()
    }
    this.input.on('pointerdown', this.pickingEntranceClickHandler)

    // ESC でキャンセル
    this.input.keyboard.once('keydown-ESC', () => this.stopPickingMeetingEntrance())
  }

  private stopPickingMeetingEntrance() {
    if (!this.isPickingMeetingEntrance) return
    this.isPickingMeetingEntrance = false

    if (this.pickingEntranceMoveHandler) {
      this.input.off('pointermove', this.pickingEntranceMoveHandler)
      this.pickingEntranceMoveHandler = undefined
    }
    if (this.pickingEntranceClickHandler) {
      this.input.off('pointerdown', this.pickingEntranceClickHandler)
      this.pickingEntranceClickHandler = undefined
    }
    this.pickingEntranceCursor?.destroy()
    this.pickingEntranceCursor = undefined
  }

  // ────────────────────────────────────────────────────────────────────────────

  private handleItemSelectorOverlap(playerSelector, selectionItem) {
    const currentItem = playerSelector.selectedItem as Item
    // currentItem is undefined if nothing was perviously selected
    if (currentItem) {
      // if the selection has not changed, do nothing
      if (currentItem === selectionItem || currentItem.depth >= selectionItem.depth) {
        return
      }
      // if selection changes, clear pervious dialog
      if (this.myPlayer.playerBehavior !== PlayerBehavior.SITTING) currentItem.clearDialogBox()
    }

    // set selected item and set up new dialog
    playerSelector.selectedItem = selectionItem
    selectionItem.onOverlapDialog()
  }

  // 何もない場所での右クリックで、その地点のワールド座標を表示する。
  // 看板や設置物の上での右クリックは削除に使われているため、そこでは何もしない。
  private handleInspectCoordinate(pointer: Phaser.Input.Pointer) {
    if (!pointer.rightButtonDown()) return
    // 看板の設置中・会議室入口の指定中は、右クリックがキャンセル操作なので邪魔しない
    if (this.isPlacingSignboard || this.isPickingMeetingEntrance) return
    // 看板・設置物の上なら、そちらの右クリック（削除）を優先する
    const hit = this.input.hitTestPointer(pointer)
    if (hit.some((go) => go.getData('builderId') || go.getData('signboardId'))) return

    const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
    const x = Math.round(wp.x)
    const y = Math.round(wp.y)
    const tileX = Math.floor(wp.x / TILE_SIZE)
    const tileY = Math.floor(wp.y / TILE_SIZE)

    this.showCoordinateMarker(x, y, tileX, tileY)

    // 座標をクリップボードへ入れて、そのままメモや設定に貼り付けられるようにする
    navigator.clipboard?.writeText(`${x}, ${y}`).catch(() => undefined)
  }

  private showCoordinateMarker(x: number, y: number, tileX: number, tileY: number) {
    const marker = this.add.container(x, y).setDepth(30000)

    const cross = this.add.graphics()
    cross.lineStyle(2, 0x00e5ff, 1)
    cross.strokeCircle(0, 0, 7)
    cross.lineBetween(-14, 0, -4, 0)
    cross.lineBetween(4, 0, 14, 0)
    cross.lineBetween(0, -14, 0, -4)
    cross.lineBetween(0, 4, 0, 14)

    const label = this.add.text(0, -22, `x: ${x}, y: ${y}\nタイル: ${tileX}, ${tileY}\n（コピーしました）`, {
      fontSize: '13px',
      color: '#ffffff',
      backgroundColor: '#000000cc',
      padding: { x: 6, y: 4 },
      align: 'center',
    })
    label.setOrigin(0.5, 1)

    marker.add([cross, label])

    // 3秒かけてフェードアウトさせ、自動で消す
    this.tweens.add({
      targets: marker,
      alpha: 0,
      delay: 2200,
      duration: 800,
      onComplete: () => marker.destroy(),
    })
  }

  private handleExitZone() {
    if (this.hasAskedExit) return

    // 一度尋ねたら、ゾーンを離れるまで再度尋ねないようにフラグを立てる
    // （フラグの解除はupdate()でゾーンとの重なりが外れたときに行う。10秒タイマーは使わない）
    this.hasAskedExit = true

    // キャラクターの移動をピタッと止める
    this.myPlayer.body.setVelocity(0, 0)

    // window.confirm()はメインスレッドをブロックし、その間に離されたキーのkeyupが
    // Phaserに届かずキー入力が固着する不具合があったため、Reactの非ブロッキングダイアログに置き換えた
    store.dispatch(openExitDialog())
  }

  // function to add new player to the otherPlayer group
  private handlePlayerJoined(newPlayer: IPlayer, id: string) {
    // 同じidのスプライトが既にあれば作り直す（重複キャラの防止）
    const existing = this.otherPlayerMap.get(id)
    if (existing) {
      this.otherPlayers.remove(existing, true, true)
      this.otherPlayerMap.delete(id)
    }
    const otherPlayer = this.add.otherPlayer(newPlayer.x, newPlayer.y, 'adam', id, newPlayer.name)
    otherPlayer.isVideoOff = newPlayer.isVideoOff
    otherPlayer.isAudioMuted = newPlayer.isAudioMuted
    this.otherPlayers.add(otherPlayer)
    this.otherPlayerMap.set(id, otherPlayer)
  }

  private handlePlayerLeftWithProximity(id: string) {
    this.handlePlayerLeft(id)
    this.handleProximityLeave(id)
  }

  // function to remove the player who left from the otherPlayer group
  private handlePlayerLeft(id: string) {
    if (this.otherPlayerMap.has(id)) {
      const otherPlayer = this.otherPlayerMap.get(id)
      if (!otherPlayer) return
      this.otherPlayers.remove(otherPlayer, true, true)
      this.otherPlayerMap.delete(id)
    }
  }

  private handleMyPlayerReady() {
    this.myPlayer.readyToConnect = true
  }

  private handleMyVideoConnected() {
    this.myPlayer.videoConnected = true
  }

  // function to update target position upon receiving player updates
  private handlePlayerUpdated(field: string, value: number | string, id: string) {
    const otherPlayer = this.otherPlayerMap.get(id)
    otherPlayer?.updateOtherPlayer(field, value)
  }

  private handleMeetingRoomEntrance(_player, entrance) {
    if (this.meetingRoomCooldown) return
    const room = entrance.getData('meetingRoom')
    if (!room || this.activeMeetingRoomId === room.id) return

    this.activeMeetingRoomId = room.id

    // 退出時の戻り先: ゾーン上端（room.y - 48）の1タイル上
    this.meetingRoomReturn = {
      x: room.x !== undefined ? room.x : this.myPlayer.x,
      y: room.y !== undefined ? room.y - 48 - TILE_SIZE : this.myPlayer.y - 80,
    }

    this.disableKeys()
    this.myPlayer.body.velocity.set(0, 0)
    // 在室IDを全員に同期（同じ部屋の人同士が映像接続される）
    this.network.updateMeetingRoomId(room.id)
    store.dispatch(setActiveMeetingRoom(room))
    phaserEvents.emit(Event.MEETING_ROOM_ENTER, room)
  }

  private exitMeetingRoom() {
    if (this.meetingRoomReturn) {
      this.myPlayer.setPosition(this.meetingRoomReturn.x, this.meetingRoomReturn.y)
      this.network.updatePlayer(
        this.myPlayer.x,
        this.myPlayer.y,
        this.myPlayer.anims.currentAnim?.key || 'adam_idle_down'
      )
    }
    this.activeMeetingRoomId = undefined
    this.meetingRoomReturn = undefined
    this.enableKeys()
    // 在室IDをクリア（退室を全員に同期）
    this.network.updateMeetingRoomId('')
    store.dispatch(clearActiveMeetingRoom())

    // 退出直後の再入室を防ぐクールダウン（1秒）
    this.meetingRoomCooldown = true
    this.time.delayedCall(1000, () => { this.meetingRoomCooldown = false })
  }

  private proximitySet = new Set<string>()

  private handlePlayersOverlap(myPlayer, otherPlayer) {
    otherPlayer.makeCall(myPlayer, this.network?.webRTC)

    // 近接マイク自動ON
    const id: string = otherPlayer.playerId
    if (!this.proximitySet.has(id)) {
      this.proximitySet.add(id)
      if (this.proximitySet.size === 1) {
        phaserEvents.emit(Event.PROXIMITY_ENTER)
      }
    }
  }

  private handleProximityLeave(playerId: string) {
    if (this.proximitySet.has(playerId)) {
      this.proximitySet.delete(playerId)
      if (this.proximitySet.size === 0) {
        phaserEvents.emit(Event.PROXIMITY_LEAVE)
      }
    }
  }

  private handleItemUserAdded(playerId: string, itemId: string, itemType: ItemType) {
    if (itemType === ItemType.COMPUTER) {
      const computer = this.computerMap.get(itemId)
      computer?.addCurrentUser(playerId)
    } else if (itemType === ItemType.WHITEBOARD) {
      const whiteboard = this.whiteboardMap.get(itemId)
      whiteboard?.addCurrentUser(playerId)
    }
  }

  private handleItemUserRemoved(playerId: string, itemId: string, itemType: ItemType) {
    if (itemType === ItemType.COMPUTER) {
      const computer = this.computerMap.get(itemId)
      computer?.removeCurrentUser(playerId)
    } else if (itemType === ItemType.WHITEBOARD) {
      const whiteboard = this.whiteboardMap.get(itemId)
      whiteboard?.removeCurrentUser(playerId)
    }
  }

  private handleChatMessageAdded(playerId: string, content: string) {
    const otherPlayer = this.otherPlayerMap.get(playerId)
    otherPlayer?.updateDialogBubble(content)
  }

  update(t: number, dt: number) {
    if (this.myPlayer && this.network) {
      this.playerSelector.update(this.myPlayer, this.cursors)
      this.myPlayer.update(this.playerSelector, this.cursors, this.keyE, this.keyR, this.network)

      // 出口ゾーンを実際に離れたら、再度尋ねられるようフラグを戻す
      if (this.hasAskedExit && this.exitZoneBounds) {
        const stillInZone = Phaser.Geom.Rectangle.Overlaps(this.myPlayer.getBounds(), this.exitZoneBounds)
        if (!stillInZone) this.hasAskedExit = false
      }

      // Yソートの適用 (プレイヤーとプレイヤーコンテナ)
      this.myPlayer.setDepth(this.myPlayer.y)
      if (this.myPlayer.playerContainer) {
        this.myPlayer.playerContainer.setDepth(this.myPlayer.y)
      }
      
      // オクルージョン（半透明化）の判定
      // プレイヤーがコライダー（机や壁など）の「奥」に重なっている場合、半透明にする
      let myPlayerObscured = false
      
      for (const col of this.customColliders) {
        const colLeft = col.x
        const colRight = col.x + col.width
        const colTop = col.y
        const colBottom = col.y + col.height
        
        // プレイヤーの足元座標 (アバターの下端中央付近)
        const playerX = this.myPlayer.x
        const playerY = this.myPlayer.y
        
        // プレイヤーがコライダーの横幅の範囲内にいて、かつY座標がコライダーの底辺よりも小さい（奥）で、
        // コライダーの上部から侵入している（=奥で重なっている）場合
        // 少し広めの判定（コライダーの上端〜下端まで）
        if (
          playerX >= colLeft && playerX <= colRight &&
          playerY >= colTop && playerY < colBottom
        ) {
          myPlayerObscured = true
          break
        }
      }
      
      // 透過度の適用
      if (this.myPlayer.isAway) {
        this.myPlayer.setAlpha(0.6)
        if (this.myPlayer.playerContainer) {
          this.myPlayer.playerContainer.setAlpha(myPlayerObscured ? 0.5 : 1.0)
        }
      } else if (myPlayerObscured) {
        this.myPlayer.setAlpha(0.5)
        if (this.myPlayer.playerContainer) {
          this.myPlayer.playerContainer.setAlpha(0.5)
        }
      } else {
        this.myPlayer.setAlpha(1.0)
        if (this.myPlayer.playerContainer) {
          this.myPlayer.playerContainer.setAlpha(1.0)
        }
      }
    }
    
    // 他のプレイヤーもYソートとオクルージョンを行う
    this.otherPlayers.getChildren().forEach((playerGo) => {
      const otherPlayer = playerGo as OtherPlayer
      otherPlayer.setDepth(otherPlayer.y)
      if (otherPlayer.playerContainer) {
        otherPlayer.playerContainer.setDepth(otherPlayer.y)
      }
      
      let otherPlayerObscured = false
      for (const col of this.customColliders) {
        const colLeft = col.x
        const colRight = col.x + col.width
        const colTop = col.y
        const colBottom = col.y + col.height
        
        const playerX = otherPlayer.x
        const playerY = otherPlayer.y
        
        if (
          playerX >= colLeft && playerX <= colRight &&
          playerY >= colTop && playerY < colBottom
        ) {
          otherPlayerObscured = true
          break
        }
      }
      
      if (otherPlayer.isAway) {
        otherPlayer.setAlpha(0.6)
        if (otherPlayer.playerContainer) {
          otherPlayer.playerContainer.setAlpha(otherPlayerObscured ? 0.5 : 1.0)
        }
      } else if (otherPlayerObscured) {
        otherPlayer.setAlpha(0.5)
        if (otherPlayer.playerContainer) {
          otherPlayer.playerContainer.setAlpha(0.5)
        }
      } else {
        otherPlayer.setAlpha(1.0)
        if (otherPlayer.playerContainer) {
          otherPlayer.playerContainer.setAlpha(1.0)
        }
      }
    })
  }

  // ─── 当たり判定（コライダー）ロード ──────────────────────────────────────

  private loadCustomColliders() {
    const mapWidth = this.bgImage.width
    const mapHeight = this.bgImage.height

    // ── Step1: マップ外周壁（空中島からの落下防止）を自動生成 ──────────────
    const WALL_THICKNESS = 32
    const outerWalls = [
      { x: 0,                        y: 0,                         width: mapWidth,       height: WALL_THICKNESS }, // 上
      { x: 0,                        y: mapHeight - WALL_THICKNESS, width: mapWidth,       height: WALL_THICKNESS }, // 下
      { x: 0,                        y: 0,                         width: WALL_THICKNESS, height: mapHeight },      // 左
      { x: mapWidth - WALL_THICKNESS, y: 0,                         width: WALL_THICKNESS, height: mapHeight },     // 右
    ]
    outerWalls.forEach(col => this.spawnCustomCollider(col.x, col.y, col.width, col.height))

    // ── Step2: collision.jsonのロードと解析 ──
    const collisionData = this.cache.json.get('collision')
    let loadedColliders: Array<{ x: number; y: number; width: number; height: number }> = []

    if (collisionData && collisionData.layers) {
      // イメージレイヤーのオフセット値を取得
      let offsetX = 0
      let offsetY = 0
      const imageLayer = collisionData.layers.find((layer: any) => layer.type === 'imagelayer')
      if (imageLayer) {
        offsetX = imageLayer.offsetx ?? 0
        offsetY = imageLayer.offsety ?? 0
        console.log(`[Collider] イメージレイヤー検出: offsetx=${offsetX}, offsety=${offsetY}`)
      }

      // オブジェクトレイヤーから四角形オブジェクトを抽出
      collisionData.layers.forEach((layer: any) => {
        if (layer.objects) {
          layer.objects.forEach((obj: any) => {
            // 四角形オブジェクト（polygon, polyline, ellipse, pointなどがないもの）
            if (
              obj.width && obj.height &&
              !obj.polygon && !obj.polyline && !obj.ellipse && !obj.point
            ) {
              // 座標を背景画像（Phaser上の座標系）と一致させるためにオフセットを引く
              const adjustedX = obj.x - offsetX
              const adjustedY = obj.y - offsetY
              
              loadedColliders.push({
                x: adjustedX,
                y: adjustedY,
                width: obj.width,
                height: obj.height
              })
            }
          })
        }
      })
      console.log(`[Collider] collision.jsonから ${loadedColliders.length} 件のコライダーをロードしました。`)
    } else {
      console.error('[Collider] collision.jsonのデータが見つかりません。')
    }

    this.customColliders = loadedColliders
    this.customColliders.forEach(col => this.spawnCustomCollider(col.x, col.y, col.width, col.height))

    console.log('[Collider] ロード完了。Pキーでデバッグ表示, ドラッグで追加, Kキーで保存, Lキーでリセット')
  }

  private spawnCustomCollider(x: number, y: number, width: number, height: number) {
    // Rectangleを使って静的ボディを生成する。
    // x, y は左上隅の座標（Tiledオフセット補正済み）
    const cx = x + width / 2
    const cy = y + height / 2
    const rect = this.add.rectangle(cx, cy, width, height)
    this.physics.add.existing(rect, true)
    const body = rect.body as Phaser.Physics.Arcade.StaticBody
    body.setSize(width, height)
    body.reset(cx, cy) // 静的ボディの中心を明示的に設定
    this.customCollidersGroup.add(rect)
  }

  // ─── デバッグ & ドラッグ＆ドロップ作成ツール ─────────────────────────────

  private setupCollidersDebugTools() {
    // 当たり判定を調整するための開発者用ツール（P:デバッグ表示 / K:保存 / L:リセット、
    // デバッグ表示中はドラッグで当たり判定を追加できる）。
    // Phaserのキー入力はDOMの入力欄で打った文字も拾ってしまうため、本番で有効にしておくと
    // 名前やチャットに「p」を打っただけでデバッグ枠が出たり、その状態でドラッグすると
    // 見えない壁が増えて動けなくなる。利用者には不要な機能なので開発時のみ有効にする。
    if (!import.meta.env.DEV) return

    const STORAGE_KEY = 'skyoffice_custom_colliders_v2'

    // ── オーバーレイグラフィックス（座標表示・ドラッグ描画用） ─────────────
    this.debugDrawGraphics = this.add.graphics()
    this.debugDrawGraphics.setDepth(10001)

    // ── Phaser物理エンジンのネイティブデバッググラフィック ──────────────────
    // Pキー押下時に動的に生成・破棄する
    // （常時ONにするとパフォーマンスが落ちるため、デバッグ時のみ有効化）

    // ── P キー: デバッグモード ON/OFF ─────────────────────────────────────
    this.input.keyboard.on('keydown-P', () => {
      this.isCollidersDebugMode = !this.isCollidersDebugMode

      if (this.isCollidersDebugMode) {
        // Phaserネイティブデバッググラフィックを有効化
        this.physicsDebugGraphic = this.physics.world.createDebugGraphic()
        this.physicsDebugGraphic.setDepth(10000)
        console.log('%c[Collider Debug] ON ─ マウスドラッグで当たり判定を追加できます', 'color: #00ff88; font-weight: bold')
        console.log('  K: 現在の全データをlocalStorage保存 & コンソール出力')
        console.log('  L: localStorageをクリアしてcollision.jsonにリセット')
      } else {
        // Phaserネイティブデバッググラフィックを無効化
        this.physicsDebugGraphic?.destroy()
        this.physicsDebugGraphic = undefined
        console.log('%c[Collider Debug] OFF', 'color: #ff8800')
      }

      this.redrawDebugColliders()
    })

    // ── K キー: 全コライダーをJSON出力 & localStorage保存 ─────────────────
    this.input.keyboard.on('keydown-K', () => {
      const data = this.customColliders
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))

      // JSONデータをコンソールに出力
      console.log('%c=== 現在の全コライダーデータ（JSONフォーマット） ===', 'color: #00ccff; font-weight: bold')
      console.log(JSON.stringify(data, null, 2))
      console.log('%c=== localStorageに保存完了 ===', 'color: #00ccff')
      console.log(`合計: ${data.length} 件`)
    })

    // ── L キー: localStorageをクリアしてcollision.jsonから再読み込み ───────
    this.input.keyboard.on('keydown-L', () => {
      if (!confirm('当たり判定データを初期値（collision.json）にリセットしますか？\n（localStorageの保存データは削除されます）')) return

      localStorage.removeItem(STORAGE_KEY)
      this.customCollidersGroup.clear(true, true)
      
      // 再度 collision.json から読み込む
      this.loadCustomColliders()

      this.redrawDebugColliders()
      console.log('%c[Collider] collision.jsonの値にリセットしました。', 'color: #ffaa00')
    })

    // ── ドラッグ＆ドロップ: 新しい当たり判定を描画して追加 ────────────────
    const SNAP = 8 // スナップグリッド（ピクセル）

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.isCollidersDebugMode) return
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      this.dragStartX = Math.round(wp.x / SNAP) * SNAP
      this.dragStartY = Math.round(wp.y / SNAP) * SNAP
      this.isDragging = true
    })

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.isCollidersDebugMode || !this.isDragging) return
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      const cx = Math.round(wp.x / SNAP) * SNAP
      const cy = Math.round(wp.y / SNAP) * SNAP

      const rx = Math.min(this.dragStartX, cx)
      const ry = Math.min(this.dragStartY, cy)
      const rw = Math.abs(cx - this.dragStartX)
      const rh = Math.abs(cy - this.dragStartY)

      this.debugDrawGraphics.clear()
      this.redrawDebugColliders()

      // ドラッグ中は赤色で描画
      this.debugDrawGraphics.lineStyle(2, 0xff2222, 1.0)
      this.debugDrawGraphics.fillStyle(0xff2222, 0.25)
      this.debugDrawGraphics.strokeRect(rx, ry, rw, rh)
      this.debugDrawGraphics.fillRect(rx, ry, rw, rh)

      // リアルタイムでサイズをコンソール表示（最後の行を上書き）
      // console.log(`[ドラッグ中] x:${rx} y:${ry} w:${rw} h:${rh}`)
    })

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!this.isCollidersDebugMode || !this.isDragging) return
      this.isDragging = false

      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      const cx = Math.round(wp.x / SNAP) * SNAP
      const cy = Math.round(wp.y / SNAP) * SNAP

      const rx = Math.min(this.dragStartX, cx)
      const ry = Math.min(this.dragStartY, cy)
      const rw = Math.abs(cx - this.dragStartX)
      const rh = Math.abs(cy - this.dragStartY)

      if (rw >= SNAP && rh >= SNAP) {
        const newCol = { x: rx, y: ry, width: rw, height: rh }
        this.customColliders.push(newCol)
        this.spawnCustomCollider(rx, ry, rw, rh)

        // ▼ コンソールにコピペ用フォーマットで出力
        console.log('%c[Collider追加]', 'color: #00ff88; font-weight: bold',
          `{ x: ${rx}, y: ${ry}, width: ${rw}, height: ${rh} },`)
        console.log(`  ↑ Kキーを押してlocalStorageに保存するか、出力されたデータをcollision.jsonに反映してください（合計: ${this.customColliders.length}件）`)
      }

      this.debugDrawGraphics.clear()
      this.redrawDebugColliders()
    })
  }

  private redrawDebugColliders() {
    this.debugDrawGraphics.clear()
    if (!this.isCollidersDebugMode) return

    // ① Tiled座標から変換した矩形（緑）→ これがTiledの点線枠と一致するはず
    this.debugDrawGraphics.lineStyle(2, 0x00ff88, 0.9)
    this.debugDrawGraphics.fillStyle(0x00ff88, 0.12)
    this.customColliders.forEach(col => {
      this.debugDrawGraphics.strokeRect(col.x, col.y, col.width, col.height)
      this.debugDrawGraphics.fillRect(col.x, col.y, col.width, col.height)
    })

    // ② Phaser物理ボディの実際の位置（シアン）→ ①と完全一致しているか確認用
    this.debugDrawGraphics.lineStyle(1, 0x00ffff, 0.7)
    this.customCollidersGroup.getChildren().forEach((go: any) => {
      const body = go.body as Phaser.Physics.Arcade.StaticBody
      if (body) {
        this.debugDrawGraphics.strokeRect(body.x, body.y, body.width, body.height)
      }
    })
  }

  // ─── Jukebox 制御メソッド ───────────────────────────────────────────

  private handleNetworkJukeboxSync(data: { index: number; status: string; name: string; url: string; isLocal: boolean }) {
    console.log('[Jukebox Sync] 受信データ:', data)
    if (data.status === 'playing' && data.name && data.url) {
      // 他人の再生操作を自分のReduxストアとPhaserに同期
      // playSongByIndex はローカルのプレイリストに依存するため、
      // 代わりに直接ストアを更新してから再生
      store.dispatch(setCurrentSong({ name: data.name, index: data.index }))
      store.dispatch(setPlayState({ playing: true, paused: false }))
      this.handleJukeboxPlay({ name: data.name, url: data.url, isLocal: data.isLocal, index: data.index }, true)
    } else if (data.status === 'paused') {
      this.handleJukeboxPause(true)
    } else if (data.status === 'stopped') {
      this.handleJukeboxStop(true)
    }
  }

  // 自分の操作を他の人のMAPにも反映させるか。
  // ジュークボックスの「全員のMAPでも流す」がOFFなら自分だけで聴く（送信しない）。
  private shouldBroadcastJukebox() {
    return store.getState().jukebox.broadcast
  }

  // トグル切り替え時に、相手側の再生状態を今の設定に合わせる。
  // ONにしたら鳴っている曲を相手にも流し始め、OFFにしたら相手側だけ止める。
  private handleJukeboxBroadcast(enabled: boolean) {
    const { currentSongIndex, playlist, playing } = store.getState().jukebox
    const song = playlist[currentSongIndex]
    if (enabled) {
      if (playing && song && !song.isLocal) {
        this.network.sendJukeboxSync({
          index: currentSongIndex, status: 'playing', name: song.name, url: song.url, isLocal: false,
        })
      }
    } else {
      this.network.sendJukeboxSync({ index: -1, status: 'stopped', name: '', url: '', isLocal: false })
    }
  }

  private handleJukeboxPlay(data: { name: string; url: string; isLocal: boolean; index: number }, isFromNetwork = false) {
    const songIndex = data.index
    // アセットキーの作成 (ローカル追加曲はインデックスベース、サーバー提供曲は名前ベースにして重複やズレを防ぐ)
    const key = data.isLocal ? `local_song_${songIndex}` : `bgm_${data.name}`

    // 既に同じ曲が再生中・一時停止中の場合
    if (this.currentSound && (this.currentSound as any).key === key) {
      if (this.currentSound.isPaused) {
        this.currentSound.resume()
        store.dispatch(setPlayState({ playing: true, paused: false }))
        if (!isFromNetwork && !data.isLocal && this.shouldBroadcastJukebox()) {
          this.network.sendJukeboxSync({ index: data.index, status: 'playing', name: data.name, url: data.url, isLocal: data.isLocal })
        }
      }
      return
    }

    // 別の曲を再生する場合は、現在の音声を停止
    this.handleJukeboxStop(isFromNetwork)
    // 読み込み完了後に再生するためのキーを保持
    ;(this as any).pendingJukeboxKey = key

    const playSound = () => {
      // 読み込み中に別の曲がリクエストされたか、停止された場合は再生しない
      if ((this as any).pendingJukeboxKey !== key) return

      try {
        const repeat = store.getState().jukebox.repeat
        const volume = store.getState().jukebox.volume
        this.sound.volume = volume
        this.currentSound = this.sound.add(key)
        this.currentSound.play({ loop: repeat, volume: volume })
        store.dispatch(setPlayState({ playing: true, paused: false }))

        // 曲が終了した際の自動遷移
        // ネットワーク受信側は「complete」を発火させない（次の曲の選択はオリジナル操作者が行い、syncで受け取る）
        this.currentSound.on('complete', () => {
          if (!isFromNetwork) {
            phaserEvents.emit(Event.JUKEBOX_STATE_UPDATE, { status: 'complete' })
          }
        })

        // 自分が操作した場合はサーバーに同期（ローカルアップロード曲は blob: URL のため除外）
        if (!isFromNetwork && !data.isLocal && this.shouldBroadcastJukebox()) {
          this.network.sendJukeboxSync({ index: data.index, status: 'playing', name: data.name, url: data.url, isLocal: data.isLocal })
        }
      } catch (err) {
        console.error('Phaser play sound error:', err)
      }
    }

    // ローカル追加曲などで、キャッシュに無い場合は動的にロード
    if (!this.cache.audio.exists(key)) {
      // 日本語文字やスペースなどの特殊文字を含むURLを安全に読み込むために encodeURI を適用
      this.load.audio(key, encodeURI(data.url))
      this.load.once('complete', () => {
        playSound()
      })
      this.load.start()
    } else {
      playSound()
    }
  }

  private handleJukeboxPause(isFromNetwork = false) {
    if (this.currentSound) {
      this.currentSound.pause()
      store.dispatch(setPlayState({ playing: false, paused: true }))
      if (!isFromNetwork && this.shouldBroadcastJukebox()) {
        this.network.sendJukeboxSync({ index: -1, status: 'paused', name: '', url: '', isLocal: false })
      }
    }
  }

  private handleJukeboxStop(isFromNetwork = false) {
    ;(this as any).pendingJukeboxKey = null
    if (this.currentSound) {
      this.currentSound.stop()
      this.currentSound.destroy()
      this.currentSound = undefined
    }
    store.dispatch(setPlayState({ playing: false, paused: false }))
    if (!isFromNetwork && this.shouldBroadcastJukebox()) {
      this.network.sendJukeboxSync({ index: -1, status: 'stopped', name: '', url: '', isLocal: false })
    }
  }

  private handleJukeboxRepeat(repeat: boolean) {
    if (this.currentSound) {
      (this.currentSound as any).loop = repeat
    }
  }

  private handleJukeboxVolume(volume: number) {
    this.sound.volume = volume // グローバル音量を直接変更してすべての環境で動作を保証
    if (this.currentSound) {
      (this.currentSound as any).volume = volume
    }
  }
}
