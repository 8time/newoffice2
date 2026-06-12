import { ItemType } from '../../../types/Items'
import store from '../stores'
import Item from './Item'
import { openPredictionBoardDialog } from '../stores/PredictionBoardStore'

export default class PredictionBoard extends Item {
  constructor(scene: Phaser.Scene, x: number, y: number, texture: string, frame?: string | number) {
    super(scene, x, y, texture, frame)
    this.itemType = ItemType.PREDICTION_BOARD
  }

  onOverlapDialog() {
    this.setDialogBox('⌨️ [ R ] 予想ボードを見る', 26)
  }

  openDialog() {
    store.dispatch(openPredictionBoardDialog())
  }
}
