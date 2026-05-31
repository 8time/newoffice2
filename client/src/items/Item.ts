import Phaser from 'phaser'
import { ItemType } from '../../../types/Items'

export default class Item extends Phaser.Physics.Arcade.Sprite {
  private dialogBox!: Phaser.GameObjects.Container
  private statusBox!: Phaser.GameObjects.Container
  itemType!: ItemType

  constructor(scene: Phaser.Scene, x: number, y: number, texture: string, frame?: string | number) {
    super(scene, x, y, texture, frame)

    // add dialogBox and statusBox containers on top of everything which we can add text in later
    this.dialogBox = this.scene.add.container().setDepth(10000)
    this.statusBox = this.scene.add.container().setDepth(10000)
  }

  // add texts into dialog box container
  setDialogBox(text: string, fontSize: number = 13) {
    // 初めてダイアログが表示された瞬間のみ、決定通知用の効果音を再生します
    if (this.dialogBox.length === 0) {
      try {
        this.scene.sound.play('ping', { volume: 0.35 })
      } catch (err) {
        console.error('Play ping sound error:', err)
      }
    }

    // 表示文字に「Press R」や「Press E」などがある場合、キー表示を見やすくハイライト
    let displayHtml = text
    if (displayHtml.includes('Press R')) {
      displayHtml = displayHtml.replace('Press R', '⌨️ [ R ]')
    } else if (displayHtml.includes('Press E')) {
      displayHtml = displayHtml.replace('Press E', '⌨️ [ E ]')
    }

    const innerText = this.scene.add
      .text(0, 0, displayHtml)
      .setFontFamily('Inter, Arial, sans-serif')
      .setFontSize(fontSize)
      .setFontStyle('bold')
      .setColor('#00ffaa') // 美しいネオングリーンで視認性を劇的に向上
      .setStroke('#000000', 3) // くっきりした黒いフチ取り

    // set dialogBox slightly larger than the text in it
    const dialogBoxWidth = innerText.width + 12
    const dialogBoxHeight = innerText.height + 8
    const dialogBoxX = this.x - dialogBoxWidth * 0.5
    const dialogBoxY = this.y + this.height * 0.5 + 4

    this.dialogBox.add(
      this.scene.add
        .graphics()
        .fillStyle(0x0a121e, 0.9) // 高級感のある半透明ダークネイビー背景
        .fillRoundedRect(dialogBoxX, dialogBoxY, dialogBoxWidth, dialogBoxHeight, 6)
        .lineStyle(2, 0x00b4ff, 1.0) // 鮮やかなネオンブルーの枠線で浮かび上がらせる
        .strokeRoundedRect(dialogBoxX, dialogBoxY, dialogBoxWidth, dialogBoxHeight, 6)
    )
    this.dialogBox.add(innerText.setPosition(dialogBoxX + 6, dialogBoxY + 4))
  }

  // remove everything in the dialog box container
  clearDialogBox() {
    this.dialogBox.removeAll(true)
  }

  // add text into status box container
  setStatusBox(text: string) {
    const innerText = this.scene.add
      .text(0, 0, text)
      .setFontFamily('Arial')
      .setFontSize(12)
      .setColor('#000000')

    // set dialogBox slightly larger than the text in it
    const statusBoxWidth = innerText.width + 4
    const statusBoxHeight = innerText.height + 2
    const statusBoxX = this.x - statusBoxWidth * 0.5
    const statusBoxY = this.y - this.height * 0.25
    this.statusBox.add(
      this.scene.add
        .graphics()
        .fillStyle(0xffffff, 1)
        .fillRoundedRect(statusBoxX, statusBoxY, statusBoxWidth, statusBoxHeight, 3)
        .lineStyle(1.5, 0x000000, 1)
        .strokeRoundedRect(statusBoxX, statusBoxY, statusBoxWidth, statusBoxHeight, 3)
    )
    this.statusBox.add(innerText.setPosition(statusBoxX + 2, statusBoxY))
  }

  // remove everything in the status box container
  clearStatusBox() {
    this.statusBox.removeAll(true)
  }
}
