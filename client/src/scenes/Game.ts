import Phaser from 'phaser'

// import { debugDraw } from '../utils/debug'
import { createCharacterAnims } from '../anims/CharacterAnims'

import Item from '../items/Item'
import Chair from '../items/Chair'
import Computer from '../items/Computer'
import Whiteboard from '../items/Whiteboard'
import VendingMachine from '../items/VendingMachine'
import Jukebox from '../items/Jukebox'
import '../characters/MyPlayer'
import '../characters/OtherPlayer'
import MyPlayer from '../characters/MyPlayer'
import OtherPlayer from '../characters/OtherPlayer'
import PlayerSelector from '../characters/PlayerSelector'
import Network from '../services/Network'
import { IPlayer } from '../../../types/IOfficeState'
import { PlayerBehavior } from '../../../types/PlayerBehavior'
import { ItemType } from '../../../types/Items'

import store from '../stores'
import { setFocused, setShowChat } from '../stores/ChatStore'
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
import { NavKeys, Keyboard } from '../../../types/KeyboardState'
import { phaserEvents, Event } from '../events/EventCenter'

const TILE_SIZE = 32
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
  private currentSound?: Phaser.Sound.BaseSound

  // 看板（全員同期）
  private signboardMap = new Map<string, Phaser.GameObjects.Container>()

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
      store.dispatch(setShowChat(false))
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

    // カスタムコライダーのロードと衝突設定
    this.customCollidersGroup = this.physics.add.staticGroup()
    this.physics.add.collider(this.myPlayer, this.customCollidersGroup)
    this.loadCustomColliders()
    this.setupCollidersDebugTools()

    // ── 当たり判定デバッグ用 操作ガイドHUD（画面左下に固定表示）──
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
      [chairs, computers, whiteboards, vendingMachines, this.jukeboxes],
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

    // Map Builder setup
    this.builderGroup = this.physics.add.staticGroup()
    this.physics.add.collider(this.myPlayer, this.builderGroup)
    this.loadBuilderItemsFromStore()
    this.rebuildMeetingRoomEntrances()

    phaserEvents.on(Event.BUILDER_ENTER, this.enterBuilderMode, this)
    phaserEvents.on(Event.BUILDER_EXIT, this.exitBuilderMode, this)
    phaserEvents.on(Event.BUILDER_IMPORT, this.reloadBuilderItems, this)
    phaserEvents.on(Event.BUILDER_CLEAR, this.clearAllBuilderSprites, this)
    phaserEvents.on(Event.BUILDER_PICK_MEETING_ENTRANCE, this.startPickingMeetingEntrance, this)
    phaserEvents.on(Event.MEETING_ROOM_EXIT, this.exitMeetingRoom, this)

    // Jukebox event listeners
    phaserEvents.on(Event.JUKEBOX_PLAY, this.handleJukeboxPlay, this)
    phaserEvents.on(Event.JUKEBOX_PAUSE, this.handleJukeboxPause, this)
    phaserEvents.on(Event.JUKEBOX_STOP, this.handleJukeboxStop, this)
    phaserEvents.on(Event.JUKEBOX_REPEAT, this.handleJukeboxRepeat, this)
    phaserEvents.on(Event.JUKEBOX_VOLUME, this.handleJukeboxVolume, this)
    phaserEvents.on('network-jukebox-sync', this.handleNetworkJukeboxSync, this)

    // クリックとドラッグを区別するための移動しきい値（看板の誤ドラッグ防止）
    this.input.dragDistanceThreshold = 6

    // Signboard event listeners（全員同期）
    phaserEvents.on(Event.SIGNBOARD_ADDED, this.handleSignboardAdded, this)
    phaserEvents.on(Event.SIGNBOARD_REMOVED, this.handleSignboardRemoved, this)
    phaserEvents.on(Event.SIGNBOARD_MOVED, this.handleSignboardMoved, this)
    phaserEvents.on(Event.SIGNBOARD_PLACE, this.handleSignboardPlace, this)

    this.events.once('destroy', () => {
      phaserEvents.off(Event.JUKEBOX_PLAY, this.handleJukeboxPlay, this)
      phaserEvents.off(Event.JUKEBOX_PAUSE, this.handleJukeboxPause, this)
      phaserEvents.off(Event.JUKEBOX_STOP, this.handleJukeboxStop, this)
      phaserEvents.off(Event.JUKEBOX_REPEAT, this.handleJukeboxRepeat, this)
      phaserEvents.off(Event.JUKEBOX_VOLUME, this.handleJukeboxVolume, this)
      phaserEvents.off('network-jukebox-sync', this.handleNetworkJukeboxSync, this)
      phaserEvents.off(Event.BUILDER_PICK_MEETING_ENTRANCE, this.startPickingMeetingEntrance, this)
      phaserEvents.off(Event.MEETING_ROOM_EXIT, this.exitMeetingRoom, this)
      phaserEvents.off(Event.SIGNBOARD_ADDED, this.handleSignboardAdded, this)
      phaserEvents.off(Event.SIGNBOARD_REMOVED, this.handleSignboardRemoved, this)
      phaserEvents.off(Event.SIGNBOARD_MOVED, this.handleSignboardMoved, this)
      phaserEvents.off(Event.SIGNBOARD_PLACE, this.handleSignboardPlace, this)
    })
  }

  // ─── 看板（全員同期） ────────────────────────────────────────────────────────

  private handleSignboardPlace(content: { text: string; image: string; url: string }) {
    this.network.addSignboard({
      x: Math.round(this.myPlayer.x),
      y: Math.round(this.myPlayer.y),
      text: content.text,
      image: content.image,
      url: content.url,
    })
  }

  private handleSignboardAdded(data: {
    id: string
    x: number
    y: number
    text: string
    image: string
    url: string
    createdBy: string
  }) {
    if (this.signboardMap.has(data.id)) return

    if (data.image) {
      const key = `signtex_${data.id}`
      if (this.textures.exists(key)) {
        this.renderSignboard(data, key)
      } else {
        const onAdd = (addedKey: string) => {
          if (addedKey !== key) return
          this.textures.off('addtexture', onAdd)
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
    const container = this.signboardMap.get(id)
    if (container) {
      container.destroy(true)
      this.signboardMap.delete(id)
    }
    const key = `signtex_${id}`
    if (this.textures.exists(key)) this.textures.remove(key)
  }

  private renderSignboard(
    data: { id: string; x: number; y: number; text: string; url: string },
    texKey: string | null
  ) {
    const PAD = 8
    const MAX_W = 160
    const children: Phaser.GameObjects.GameObject[] = []
    let contentW = 0
    let cursorY = PAD

    if (texKey && this.textures.exists(texKey)) {
      const src = this.textures.get(texKey).getSourceImage() as { width: number; height: number }
      const scale = Math.min(1, MAX_W / src.width)
      const dw = src.width * scale
      const dh = src.height * scale
      const img = this.add.image(PAD, cursorY, texKey).setOrigin(0, 0).setScale(scale)
      children.push(img)
      contentW = Math.max(contentW, dw)
      cursorY += dh + (data.text ? 6 : 0)
    }

    if (data.text) {
      const txt = this.add
        .text(PAD, cursorY, data.text, {
          fontFamily: 'Inter, Arial, sans-serif',
          fontSize: '13px',
          color: '#1a1a1a',
          wordWrap: { width: MAX_W },
        })
        .setOrigin(0, 0)
      children.push(txt)
      contentW = Math.max(contentW, txt.width)
      cursorY += txt.height
    }

    const cardW = Math.max(contentW + PAD * 2, 40)
    const cardH = cursorY + PAD

    const bg = this.add.graphics()
    bg.fillStyle(0xfff8e1, 1)
    bg.fillRoundedRect(0, 0, cardW, cardH, 8)
    bg.lineStyle(2, data.url ? 0x1a6b2a : 0xb0a070, 1)
    bg.strokeRoundedRect(0, 0, cardW, cardH, 8)

    // プレイヤーの少し上に表示
    const OFFSET_Y = 24
    const container = this.add.container(data.x - cardW / 2, data.y - cardH - OFFSET_Y)
    container.add(bg)
    children.forEach((c) => container.add(c))
    container.setSize(cardW, cardH)
    container.setData('cardW', cardW)
    container.setData('cardH', cardH)
    container.setData('offsetY', OFFSET_Y)
    container.setDepth(data.y)
    container.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, cardW, cardH),
      Phaser.Geom.Rectangle.Contains
    )
    this.input.setDraggable(container)

    container.on('pointerover', () =>
      this.input.setDefaultCursor(data.url ? 'pointer' : 'move')
    )
    container.on('pointerout', () => this.input.setDefaultCursor('default'))

    container.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      container.setData('moved', false)
      if (pointer.rightButtonDown()) {
        container.setData('suppressClick', true)
        this.network.removeSignboard(data.id)
      } else {
        container.setData('suppressClick', false)
      }
    })

    // ドラッグで自由に移動（離した時点で全員に同期）
    container.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      container.setData('moved', true)
      container.x = dragX
      container.y = dragY
      container.setDepth(dragY + cardH + OFFSET_Y)
    })
    container.on('dragend', () => {
      const bx = Math.round(container.x + cardW / 2)
      const by = Math.round(container.y + cardH + OFFSET_Y)
      this.network.updateSignboard(data.id, bx, by)
    })

    container.on('pointerup', () => {
      if (container.getData('moved') || container.getData('suppressClick')) return
      if (data.url) window.open(data.url, '_blank', 'noopener,noreferrer')
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

  private loadBuilderItemsFromStore() {
    const items = store.getState().mapBuilder.placedItems
    items.forEach((item) => this.spawnBuilderSprite(item, false))
  }

  private reloadBuilderItems() {
    this.clearAllBuilderSprites()
    this.loadBuilderItemsFromStore()
    this.rebuildMeetingRoomEntrances()
  }

  private getMeetingRooms() {
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
    const placedRooms = store
      .getState()
      .mapBuilder.placedItems.filter((item) => item.itemType === 'meetingroom')
      .map((item, index) => ({
        id: item.id,
        name: `Meeting Room ${index + 1}`,
        x: item.x,
        y: item.y,
        width: 128,
        height: 96,
      }))

    return [...savedEntranceRooms, ...placedRooms]
  }

  private rebuildMeetingRoomEntrances() {
    if (!this.meetingRoomEntrances) return
    this.meetingRoomEntrances.clear(true, true)

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
      store.dispatch(
        updatePlacedItemPosition({
          id: sprite.getData('builderId'),
          x: sprite.x,
          y: sprite.y,
        })
      )
      if (sprite.getData('builderType') === 'meetingroom') {
        this.rebuildMeetingRoomEntrances()
      }
    })

    sprite.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) {
        const id = sprite.getData('builderId') as string
        store.dispatch(removePlacedItem(id))
        this.builderSpriteMap.delete(id)
        sprite.destroy()
        if (sprite.getData('builderType') === 'meetingroom') {
          this.rebuildMeetingRoomEntrances()
        }
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

      store.dispatch(addPlacedItem(newItem))
      this.spawnBuilderSprite(newItem, true)
      if (newItem.itemType === 'meetingroom') {
        this.rebuildMeetingRoomEntrances()
      }
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

  private clearAllBuilderSprites() {
    this.builderSpriteMap.forEach((sprite) => sprite.destroy())
    this.builderSpriteMap.clear()
    this.rebuildMeetingRoomEntrances()
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
      store.dispatch(setMeetingRoomEntrance({ x: sx, y: sy }))
      this.rebuildMeetingRoomEntrances()
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

  private handleExitZone() {
    if (this.hasAskedExit) return
    
    // 一度尋ねたら、再度尋ねないようにフラグを立てる
    this.hasAskedExit = true
    
    // キャラクターの移動をピタッと止める
    this.myPlayer.body.setVelocity(0, 0)
    
    // 描画が止まらないよう少し遅らせてconfirmを出す
    setTimeout(() => {
      if (window.confirm('退社しますか？')) {
        // 退出する場合はページをリロード（最初の画面に戻る）
        window.location.reload()
      } else {
        // 退出しない場合、少しの間（10秒）は再度聞かれないようにする。
        // これにより入り口付近を自由に歩けるようになる。
        setTimeout(() => {
          this.hasAskedExit = false
        }, 10000)
      }
    }, 50)
  }

  // function to add new player to the otherPlayer group
  private handlePlayerJoined(newPlayer: IPlayer, id: string) {
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

    // 退出時の戻り先: ゾーンの中心から十分下（ゾーン高さ96 + 余白）に設定
    this.meetingRoomReturn = {
      x: room.x !== undefined ? room.x : this.myPlayer.x,
      y: room.y !== undefined ? room.y + 100 : this.myPlayer.y + 100,
    }

    this.disableKeys()
    this.myPlayer.body.velocity.set(0, 0)
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

  private handleJukeboxPlay(data: { name: string; url: string; isLocal: boolean; index: number }, isFromNetwork = false) {
    const songIndex = data.index
    // アセットキーの作成 (ローカル追加曲はインデックスベース、サーバー提供曲は名前ベースにして重複やズレを防ぐ)
    const key = data.isLocal ? `local_song_${songIndex}` : `bgm_${data.name}`

    // 既に同じ曲が再生中・一時停止中の場合
    if (this.currentSound && (this.currentSound as any).key === key) {
      if (this.currentSound.isPaused) {
        this.currentSound.resume()
        store.dispatch(setPlayState({ playing: true, paused: false }))
        if (!isFromNetwork) {
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

        // 曲が終了した際の自動遷移（React 側に通知）
        this.currentSound.on('complete', () => {
          phaserEvents.emit(Event.JUKEBOX_STATE_UPDATE, { status: 'complete' })
        })

        // 自分が操作した場合はサーバーに同期
        if (!isFromNetwork) {
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
      if (!isFromNetwork) {
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
    if (!isFromNetwork) {
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
