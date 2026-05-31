import Phaser from 'phaser'
import { PlayerBehavior } from '../../../types/PlayerBehavior'
import { phaserEvents, Event } from '../events/EventCenter'

/**
 * shifting distance for sitting animation
 * format: direction: [xShift, yShift, depthShift]
 */
export const sittingShiftData = {
  up: [0, 3, -10],
  down: [0, 3, 1],
  left: [0, -8, 10],
  right: [0, -8, 10],
}

export default class Player extends Phaser.Physics.Arcade.Sprite {
  playerId: string
  playerTexture: string
  playerBehavior = PlayerBehavior.IDLE
  readyToConnect = false
  videoConnected = false
  playerName: Phaser.GameObjects.Text
  playerNameBg: Phaser.GameObjects.Graphics
  playerContainer: Phaser.GameObjects.Container
  private playerDialogBubble: Phaser.GameObjects.Container
  private awayBubble: Phaser.GameObjects.Container
  private awayStatusBadge: Phaser.GameObjects.Text
  private timeoutID?: number
  private currentAwayMessage = ''

  get isAway() {
    return this.awayStatusBadge.visible
  }

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    texture: string,
    id: string,
    frame?: string | number
  ) {
    super(scene, x, y, texture, frame)

    this.playerId = id
    this.playerTexture = texture
    this.setDepth(this.y)

    this.anims.play(`${this.playerTexture}_idle_down`, true)

    this.playerContainer = this.scene.add.container(this.x, this.y - 30).setDepth(5000)

    // add dialogBubble to playerContainer
    this.playerDialogBubble = this.scene.add.container(0, 0).setDepth(5000)
    this.playerContainer.add(this.playerDialogBubble)

    // 離席バブル（常時表示）
    this.awayBubble = this.scene.add.container(0, 0).setDepth(5001)
    this.playerContainer.add(this.awayBubble)

    // 離席バッジ（キャラ足元に表示）
    // playerContainer は this.y - 30 にある。
    // キャラスプライト高さ約48px → 足元は container基点から +54px あたり
    this.awayStatusBadge = this.scene.add
      .text(0, 54, '')      // 足元オフセット
      .setFontFamily('Arial')
      .setFontSize(22)       // 11 → 22（2倍）
      .setFontStyle('bold')
      .setColor('#ffffff')
      .setBackgroundColor('#ff6b35')
      .setPadding(6, 4)      // 余白2倍
      .setOrigin(0.5, 0)     // 水平中央揃え、上端基準
      .setVisible(false)

    // add playerNameBg to playerContainer
    this.playerNameBg = this.scene.add.graphics()
    this.playerContainer.add(this.playerNameBg)

    // add playerName to playerContainer
    this.playerName = this.scene.add
      .text(0, 0, '')
      .setFontFamily('Arial')
      .setFontSize(13)
      .setFontStyle('bold')
      .setColor('#ffffff')
      .setStroke('#000000', 3)
      .setOrigin(0.5)
    this.playerContainer.add(this.playerName)
    this.playerContainer.add(this.awayStatusBadge)
  }

  setPlayerName(name: string) {
    this.playerName.setText(name)
    
    // 背景の再描画
    this.playerNameBg.clear()
    if (name) {
      const textWidth = this.playerName.width
      const textHeight = this.playerName.height
      const padX = 8
      const padY = 4
      const bgWidth = textWidth + padX * 2
      const bgHeight = textHeight + padY * 2
      const radius = bgHeight / 2 // 楕円（カプセル型）にするための角丸半径

      this.playerNameBg.fillStyle(0x000000, 0.5) // ダークグレー半透明
      this.playerNameBg.fillRoundedRect(-bgWidth / 2, -bgHeight / 2, bgWidth, bgHeight, radius)
    }
  }

  updateDialogBubble(content: string) {
    this.clearDialogBubble()

    // preprocessing for dialog bubble text (maximum 70 characters)
    const dialogBubbleText = content.length <= 70 ? content : content.substring(0, 70).concat('...')

    const innerText = this.scene.add
      .text(0, 0, dialogBubbleText, { wordWrap: { width: 165, useAdvancedWrap: true } })
      .setFontFamily('Arial')
      .setFontSize(12)
      .setColor('#000000')
      .setOrigin(0.5)

    const innerTextHeight = innerText.height
    const innerTextWidth = innerText.width

    innerText.setY(-innerTextHeight / 2 - this.playerName.height / 2)
    const dialogBoxWidth = innerTextWidth + 10
    const dialogBoxHeight = innerTextHeight + 3
    const dialogBoxX = innerText.x - innerTextWidth / 2 - 5
    const dialogBoxY = innerText.y - innerTextHeight / 2 - 2

    this.playerDialogBubble.add(
      this.scene.add
        .graphics()
        .fillStyle(0xffffff, 1)
        .fillRoundedRect(dialogBoxX, dialogBoxY, dialogBoxWidth, dialogBoxHeight, 3)
        .lineStyle(1, 0x000000, 1)
        .strokeRoundedRect(dialogBoxX, dialogBoxY, dialogBoxWidth, dialogBoxHeight, 3)
    )
    this.playerDialogBubble.add(innerText)

    // After 6 seconds, clear the dialog bubble
    this.timeoutID = window.setTimeout(() => {
      this.clearDialogBubble()
    }, 6000)
  }

  private clearDialogBubble() {
    clearTimeout(this.timeoutID)
    this.playerDialogBubble.removeAll(true)
  }

  /** 離席バブルを表示する（常時表示） */
  setAwayStatus(awayMessage: string) {
    this.currentAwayMessage = awayMessage
    this.awayBubble.removeAll(true)

    // バッジ更新
    this.awayStatusBadge.setText('離席中')
    this.awayStatusBadge.setVisible(true)

    // キャラクターを半透明にする（かすかに見える）
    this.setAlpha(0.6)

    if (!awayMessage) return

    // 表示テキスト（20文字超は省略）
    const displayText =
      awayMessage.length <= 20 ? awayMessage : awayMessage.substring(0, 20) + '…'
    const hasMore = awayMessage.length > 20

    const nameH = this.playerName.height
    const bubbleY = -nameH - 40   // 2倍の余白

    const innerText = this.scene.add
      .text(0, 0, displayText + (hasMore ? ' 👆' : ''), {
        wordWrap: { width: 320, useAdvancedWrap: true },  // 2倍の折り返し幅
      })
      .setFontFamily('Arial')
      .setFontSize(22)             // 11 → 22
      .setColor('#000000')
      .setOrigin(0.5)

    const tw = innerText.width
    const th = innerText.height
    const bx = -tw / 2 - 10      // パディング2倍
    const by = bubbleY - th / 2 - 4
    const bw = tw + 20
    const bh = th + 8

    const bg = this.scene.add
      .graphics()
      .fillStyle(0xffe566, 1)
      .fillRoundedRect(bx, by, bw, bh, 8)   // 角丸2倍
      .lineStyle(2, 0xcc9900, 1)             // 枠線2倍
      .strokeRoundedRect(bx, by, bw, bh, 8)

    // 吹き出しのしっぽ（下向き三角）2倍
    bg.fillStyle(0xffe566, 1)
      .fillTriangle(-10, by + bh, 10, by + bh, 0, by + bh + 14)
    bg.lineStyle(2, 0xcc9900, 1)

    innerText.setY(bubbleY)
    this.awayBubble.add(bg)
    this.awayBubble.add(innerText)

    // クリックで全文表示
    if (hasMore) {
      const hitArea = this.scene.add.zone(0, bubbleY, bw, bh).setInteractive()
      hitArea.on('pointerdown', () => {
        phaserEvents.emit(Event.SHOW_AWAY_MESSAGE, this.playerId, this.currentAwayMessage)
      })
      hitArea.on('pointerover', () => {
        this.scene.game.canvas.style.cursor = 'pointer'
      })
      hitArea.on('pointerout', () => {
        this.scene.game.canvas.style.cursor = 'default'
      })
      this.awayBubble.add(hitArea)
    }
  }

  /** 出席に戻す */
  clearAwayStatus() {
    this.currentAwayMessage = ''
    this.awayBubble.removeAll(true)
    this.awayStatusBadge.setVisible(false)
    this.awayStatusBadge.setText('')

    // キャラクターの透明度を元に戻す
    this.setAlpha(1)
  }

}
