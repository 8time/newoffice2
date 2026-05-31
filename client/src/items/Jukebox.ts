import { ItemType } from '../../../types/Items'
import store from '../stores'
import Item from './Item'
import { openJukeboxDialog } from '../stores/JukeboxStore'

export default class Jukebox extends Item {
  constructor(scene: Phaser.Scene, x: number, y: number, texture: string, frame?: string | number) {
    super(scene, x, y, texture, frame)

    this.itemType = ItemType.JUKEBOX
  }

  onOverlapDialog() {
    this.setDialogBox('⌨️ [ R ] ジュークボックスを開く', 20)
  }

  openDialog() {
    store.dispatch(openJukeboxDialog())
  }
}
