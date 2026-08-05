import { ItemType } from '../../../types/Items'
import store from '../stores'
import Item from './Item'
import { openBoardDialog } from '../stores/BoardStore'

// 伝言板（昭和の駅の伝言板風）。触れると縦書きの伝言メニューが開く。
export default class MessageBoard extends Item {
  constructor(scene: Phaser.Scene, x: number, y: number, texture: string, frame?: string | number) {
    super(scene, x, y, texture, frame)
    this.itemType = ItemType.MESSAGE_BOARD
  }

  onOverlapDialog() {
    this.setDialogBox('⌨️ [ R ] 伝言板を見る／書く', 24)
  }

  openDialog() {
    store.dispatch(openBoardDialog())
  }
}
