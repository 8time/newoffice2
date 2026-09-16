import Phaser from 'phaser'
import PlayerSelector from './PlayerSelector'
import { PlayerBehavior } from '../../../types/PlayerBehavior'
import { sittingShiftData } from './Player'
import Player from './Player'
import Network from '../services/Network'
import Chair from '../items/Chair'
import Computer from '../items/Computer'
import Whiteboard from '../items/Whiteboard'
import Jukebox from '../items/Jukebox'
import PredictionBoard from '../items/PredictionBoard'
import MessageBoard from '../items/MessageBoard'
import Item from '../items/Item'

import { phaserEvents, Event } from '../events/EventCenter'
import store from '../stores'
import { ItemType } from '../../../types/Items'
import { NavKeys } from '../../../types/KeyboardState'
import { JoystickMovement } from '../components/Joystick'
import { openURL } from '../utils/helpers'

export default class MyPlayer extends Player {
  private chairOnSit?: Chair
  public joystickMovement?: JoystickMovement
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    texture: string,
    id: string,
    frame?: string | number
  ) {
    super(scene, x, y, texture, id, frame)
  }

  setPlayerName(name: string) {
    super.setPlayerName(name)
    phaserEvents.emit(Event.MY_PLAYER_NAME_CHANGE, name)
  }

  setPlayerTexture(texture: string) {
    this.playerTexture = texture
    this.anims.play(`${this.playerTexture}_idle_down`, true)
    phaserEvents.emit(Event.MY_PLAYER_TEXTURE_CHANGE, this.x, this.y, this.anims.currentAnim.key)
  }

  handleJoystickMovement(movement: JoystickMovement) {
    this.joystickMovement = movement
  }

  /** Rキー / タップで実行する主操作（椅子以外のオブジェクト） */
  performPrimaryInteraction(item: Item | undefined, network: Network) {
    if (!item) return
    switch (item.itemType) {
      case ItemType.COMPUTER:
        ;(item as Computer).openDialog(this.playerId, network)
        break
      case ItemType.WHITEBOARD:
        ;(item as Whiteboard).openDialog(network)
        break
      case ItemType.VENDINGMACHINE:
        openURL('https://www.buymeacoffee.com/skyoffice')
        break
      case ItemType.JUKEBOX:
        ;(item as Jukebox).openDialog()
        break
      case ItemType.PREDICTION_BOARD:
        ;(item as PredictionBoard).openDialog()
        break
      case ItemType.MESSAGE_BOARD:
        ;(item as MessageBoard).openDialog()
        break
    }
  }

  /** Eキー / タップで実行する着席 */
  performSecondaryInteraction(
    item: Item | undefined,
    playerSelector: PlayerSelector,
    network: Network
  ) {
    if (item?.itemType !== ItemType.CHAIR || this.playerBehavior !== PlayerBehavior.IDLE) return
    const chairItem = item as Chair
    this.scene.time.addEvent({
      delay: 10,
      callback: () => {
        this.setVelocity(0, 0)
        if (chairItem.itemDirection) {
          this.setPosition(
            chairItem.x + sittingShiftData[chairItem.itemDirection][0],
            chairItem.y + sittingShiftData[chairItem.itemDirection][1]
          ).setDepth(chairItem.depth + sittingShiftData[chairItem.itemDirection][2])
          this.playerContainer.setPosition(
            chairItem.x + sittingShiftData[chairItem.itemDirection][0],
            chairItem.y + sittingShiftData[chairItem.itemDirection][1] - 30
          )
        }

        this.play(`${this.playerTexture}_sit_${chairItem.itemDirection}`, true)
        playerSelector.selectedItem = undefined
        if (chairItem.itemDirection === 'up') {
          playerSelector.setPosition(this.x, this.y - this.height)
        } else {
          playerSelector.setPosition(0, 0)
        }
        network.updatePlayer(this.x, this.y, this.anims.currentAnim.key)
      },
      loop: false,
    })
    chairItem.clearDialogBox()
    chairItem.setDialogBox('Press E to leave')
    this.chairOnSit = chairItem
    this.playerBehavior = PlayerBehavior.SITTING
  }

  /** Eキー / タップで実行する離席 */
  standUpFromChair(playerSelector: PlayerSelector, cursors: NavKeys, network: Network) {
    if (this.playerBehavior !== PlayerBehavior.SITTING) return
    const parts = this.anims.currentAnim.key.split('_')
    parts[1] = 'idle'
    this.play(parts.join('_'), true)
    this.playerBehavior = PlayerBehavior.IDLE
    this.chairOnSit?.clearDialogBox()
    playerSelector.setPosition(this.x, this.y)
    playerSelector.update(this, cursors)
    network.updatePlayer(this.x, this.y, this.anims.currentAnim.key)
  }

  update(
    playerSelector: PlayerSelector,
    cursors: NavKeys,
    keyE: Phaser.Input.Keyboard.Key,
    keyR: Phaser.Input.Keyboard.Key,
    network: Network
  ) {
    if (!cursors) return

    const item = playerSelector.selectedItem

    if (Phaser.Input.Keyboard.JustDown(keyR)) {
      this.performPrimaryInteraction(item, network)
    }

    switch (this.playerBehavior) {
      case PlayerBehavior.IDLE:
        if (Phaser.Input.Keyboard.JustDown(keyE) && item?.itemType === ItemType.CHAIR) {
          this.performSecondaryInteraction(item, playerSelector, network)
          return
        }

        const speed = 200
        let vx = 0
        let vy = 0
        let useVariableSpeed = false

        if (this.joystickMovement?.velocity) {
          vx = this.joystickMovement.velocity.vx
          vy = this.joystickMovement.velocity.vy
          useVariableSpeed = true
        } else {
          let joystickLeft = false
          let joystickRight = false
          let joystickUp = false
          let joystickDown = false

          if (this.joystickMovement?.isMoving) {
            joystickLeft = this.joystickMovement.direction.left
            joystickRight = this.joystickMovement.direction.right
            joystickUp = this.joystickMovement.direction.up
            joystickDown = this.joystickMovement.direction.down
          }

          if (cursors.left?.isDown || cursors.A?.isDown || joystickLeft) vx -= speed
          if (cursors.right?.isDown || cursors.D?.isDown || joystickRight) vx += speed
          if (cursors.up?.isDown || cursors.W?.isDown || joystickUp) vy -= speed
          if (cursors.down?.isDown || cursors.S?.isDown || joystickDown) vy += speed
        }

        this.setVelocity(vx, vy)
        if (!useVariableSpeed && (vx !== 0 || vy !== 0)) {
          this.body.velocity.setLength(speed)
        }

        if (vx !== 0 || vy !== 0) {
          this.setDepth(this.y)
          network.updatePlayer(this.x, this.y, this.anims.currentAnim.key)
        }
        if (vx > 0) {
          this.play(`${this.playerTexture}_run_right`, true)
        } else if (vx < 0) {
          this.play(`${this.playerTexture}_run_left`, true)
        } else if (vy > 0) {
          this.play(`${this.playerTexture}_run_down`, true)
        } else if (vy < 0) {
          this.play(`${this.playerTexture}_run_up`, true)
        } else {
          const parts = this.anims.currentAnim.key.split('_')
          parts[1] = 'idle'
          const newAnim = parts.join('_')
          if (this.anims.currentAnim.key !== newAnim) {
            this.play(parts.join('_'), true)
            network.updatePlayer(this.x, this.y, this.anims.currentAnim.key)
          }
        }
        break

      case PlayerBehavior.SITTING:
        if (Phaser.Input.Keyboard.JustDown(keyE)) {
          this.standUpFromChair(playerSelector, cursors, network)
        }
        break
    }

    this.playerContainer.setPosition(this.x, this.y - 30)
  }
}

declare global {
  namespace Phaser.GameObjects {
    interface GameObjectFactory {
      myPlayer(x: number, y: number, texture: string, id: string, frame?: string | number): MyPlayer
    }
  }
}

Phaser.GameObjects.GameObjectFactory.register(
  'myPlayer',
  function (
    this: Phaser.GameObjects.GameObjectFactory,
    x: number,
    y: number,
    texture: string,
    id: string,
    frame?: string | number
  ) {
    const sprite = new MyPlayer(this.scene, x, y, texture, id, frame)

    this.displayList.add(sprite)
    this.updateList.add(sprite)

    this.scene.physics.world.enableBody(sprite, Phaser.Physics.Arcade.DYNAMIC_BODY)

    const collisionScale = [0.5, 0.2]
    sprite.body
      .setSize(sprite.width * collisionScale[0], sprite.height * collisionScale[1])
      .setOffset(
        sprite.width * (1 - collisionScale[0]) * 0.5,
        sprite.height * (1 - collisionScale[1])
      )

    return sprite
  }
)
