import Phaser from 'phaser'
import MyPlayer from '../characters/MyPlayer'
import { JoystickMovement } from '../components/Joystick'

/** この距離未満のドラッグは無視（指の微振動対策） */
const DEAD_ZONE_PX = 14
/** この距離で最大速度に到達 */
const MAX_DRAG_PX = 80
/** MyPlayer.update() のキーボード移動と同じ上限 */
const MAX_SPEED = 200
/** タッチ判定を広げる余白（px） */
const HIT_PADDING = 20

/**
 * 自キャラクターを直接タッチ＆ドラッグして移動するコントロール。
 * タブレット/スマホ専用。既存の handleJoystickMovement() 経由で MyPlayer に入力を渡す。
 */
export default class CharacterDragControl {
  private scene: Phaser.Scene
  private player: MyPlayer
  private enabled = false
  private dragging = false
  private pointerId = -1
  private startScreenX = 0
  private startScreenY = 0

  constructor(scene: Phaser.Scene, player: MyPlayer) {
    this.scene = scene
    this.player = player
  }

  get isDragging(): boolean {
    return this.dragging
  }

  enable() {
    if (this.enabled) return
    this.enabled = true
    this.scene.input.on('pointerdown', this.onPointerDown, this)
    this.scene.input.on('pointermove', this.onPointerMove, this)
    this.scene.input.on('pointerup', this.onPointerUp, this)
    this.scene.input.on('pointerupoutside', this.onPointerUp, this)
  }

  disable() {
    if (!this.enabled) return
    this.enabled = false
    this.scene.input.off('pointerdown', this.onPointerDown, this)
    this.scene.input.off('pointermove', this.onPointerMove, this)
    this.scene.input.off('pointerup', this.onPointerUp, this)
    this.scene.input.off('pointerupoutside', this.onPointerUp, this)
    this.stopDrag()
  }

  private onPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (this.dragging || !this.player?.active) return

    const wp = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y)
    const bounds = this.player.getBounds()
    const hit = new Phaser.Geom.Rectangle(
      bounds.x - HIT_PADDING,
      bounds.y - HIT_PADDING,
      bounds.width + HIT_PADDING * 2,
      bounds.height + HIT_PADDING * 2
    )
    if (!Phaser.Geom.Rectangle.Contains(hit, wp.x, wp.y)) return

    this.dragging = true
    this.pointerId = pointer.id
    this.startScreenX = pointer.x
    this.startScreenY = pointer.y
  }

  private onPointerMove = (pointer: Phaser.Input.Pointer) => {
    if (!this.dragging || pointer.id !== this.pointerId) return

    const dx = pointer.x - this.startScreenX
    const dy = pointer.y - this.startScreenY
    const dist = Math.hypot(dx, dy)

    if (dist < DEAD_ZONE_PX) {
      this.sendMovement(this.stopMovement())
      return
    }

    const clamped = Math.min(dist, MAX_DRAG_PX)
    const speed = (clamped / MAX_DRAG_PX) * MAX_SPEED
    const nx = dx / dist
    const ny = dy / dist

    this.sendMovement({
      isMoving: true,
      direction: velocityToDirection(nx * speed, ny * speed),
      velocity: { vx: nx * speed, vy: ny * speed },
    })
  }

  private onPointerUp = (pointer: Phaser.Input.Pointer) => {
    if (!this.dragging || pointer.id !== this.pointerId) return
    this.stopDrag()
  }

  private stopDrag() {
    this.dragging = false
    this.pointerId = -1
    this.sendMovement(this.stopMovement())
  }

  private sendMovement(movement: JoystickMovement) {
    this.player.handleJoystickMovement(movement)
  }

  private stopMovement(): JoystickMovement {
    return {
      isMoving: false,
      direction: { left: false, right: false, up: false, down: false },
      velocity: { vx: 0, vy: 0 },
    }
  }
}

/** PlayerSelector が方向ボックスを動かすため、速度から8方向フラグを復元する */
export function velocityToDirection(vx: number, vy: number): JoystickMovement['direction'] {
  const direction = { left: false, right: false, up: false, down: false }
  if (vx === 0 && vy === 0) return direction

  const angle = ((Math.atan2(vy, vx) * 180) / Math.PI + 360) % 360
  if (angle > 22.5 && angle <= 67.5) {
    direction.down = true
    direction.right = true
  } else if (angle > 67.5 && angle <= 112.5) {
    direction.down = true
  } else if (angle > 112.5 && angle <= 157.5) {
    direction.down = true
    direction.left = true
  } else if (angle > 157.5 && angle <= 202.5) {
    direction.left = true
  } else if (angle > 202.5 && angle <= 247.5) {
    direction.left = true
    direction.up = true
  } else if (angle > 247.5 && angle <= 292.5) {
    direction.up = true
  } else if (angle > 292.5 && angle <= 337.5) {
    direction.up = true
    direction.right = true
  } else {
    direction.right = true
  }
  return direction
}
