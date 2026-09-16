/**
 * TabletJoystick — Pointer Events対応のバーチャルジョイスティック
 *
 * Androidタブレット/スマホ向けの操作UIコンポーネント。
 * PC版には表示されない（MobileVirtualJoystickのデバイス判別で制御）。
 *
 * 特徴:
 * - Pointer Events (pointerdown/pointermove/pointerup/pointercancel) で実装
 * - touch / pen / mouse のいずれのpointerTypeでも動作
 * - Dead zone（0.15）で微小な揺れを無視
 * - 円形のドラッグ範囲制限
 * - touch-action: none でブラウザスクロール防止
 * - 既存の handleJoystickMovement() をそのまま再利用
 */

import React, { useRef, useCallback, useEffect } from 'react'
import styled from 'styled-components'

import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import { JoystickMovement } from './Joystick'
import { DeviceType } from '../utils/deviceDetect'

// ─── スタイル ──────────────────────────────────────────────────────────────────

// ジョイスティックのコンテナ。画面左下のマップ領域上に固定表示。
// z-index: 500 でマップ(0)より上、サイドバー(1000)より下。
const JoystickContainer = styled.div<{ deviceType: DeviceType }>`
  position: fixed;
  bottom: ${({ deviceType }) => (deviceType === 'phone' ? '80px' : '100px')};
  left: ${({ deviceType }) => (deviceType === 'phone' ? '24px' : '32px')};
  z-index: 500;
  touch-action: none;
  user-select: none;
  pointer-events: auto;
`

// ジョイスティック外周の円
const JoystickBase = styled.div<{ size: number }>`
  width: ${({ size }) => size}px;
  height: ${({ size }) => size}px;
  border-radius: 50%;
  background: rgba(75, 75, 75, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.15);
  position: relative;
  backdrop-filter: blur(2px);
`

// 中央のノブ
const JoystickKnob = styled.div<{ knobSize: number }>`
  width: ${({ knobSize }) => knobSize}px;
  height: ${({ knobSize }) => knobSize}px;
  border-radius: 50%;
  background: rgba(66, 234, 203, 0.6);
  border: 2px solid rgba(66, 234, 203, 0.8);
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  transition: background 0.1s;

  &:active {
    background: rgba(66, 234, 203, 0.85);
  }
`

// マップタップ移動のオーバーレイ（タップイベントをキャプチャする透明レイヤー）
const TapOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  touch-action: none;
  pointer-events: none;
`

// ─── 定数 ──────────────────────────────────────────────────────────────────────

const BASE_SIZE = 110       // ジョイスティック外周の直径
const KNOB_SIZE = 42        // ノブの直径
const MAX_RADIUS = (BASE_SIZE - KNOB_SIZE) / 2  // ノブが動ける最大半径
const DEAD_ZONE = 0.15      // Dead zone（この閾値以下は移動しない）
const TAP_MOVE_DURATION = 400  // マップタップ時の移動継続時間（ms）

// ─── 方向変換 ──────────────────────────────────────────────────────────────────

/**
 * 正規化されたXY方向をJoystickMovementの方向フラグに変換する。
 * 既存のJoystick.tsxのangleToDirectionsと同等のロジック。
 */
function normalizedToDirection(nx: number, ny: number): JoystickMovement {
  const magnitude = Math.sqrt(nx * nx + ny * ny)

  // Dead zone 以下は停止
  if (magnitude < DEAD_ZONE) {
    return {
      isMoving: false,
      direction: { left: false, right: false, up: false, down: false },
    }
  }

  // 角度を計算（atan2はラジアン、上がマイナスY）
  const angle = ((Math.atan2(ny, nx) * 180) / Math.PI + 360) % 360

  const direction = { left: false, right: false, up: false, down: false }

  // 8方向判定（既存Joystick.tsxと同じ角度範囲）
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

  return { isMoving: true, direction }
}

// ─── コンポーネント ──────────────────────────────────────────────────────────

interface Props {
  deviceType: DeviceType
}

export default function TabletJoystick({ deviceType }: Props) {
  const baseRef = useRef<HTMLDivElement>(null)
  const knobRef = useRef<HTMLDivElement>(null)
  const activePointerId = useRef<number | null>(null)
  const tapMoveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Phaserのゲームインスタンスから既存のmyPlayerへ方向を渡す
  const sendMovement = useCallback((movement: JoystickMovement) => {
    try {
      const game = phaserGame.scene.keys.game as Game
      game?.myPlayer?.handleJoystickMovement(movement)
    } catch {
      // ゲームシーンが未初期化の場合は無視
    }
  }, [])

  // 移動停止
  const stopMovement = useCallback(() => {
    sendMovement({
      isMoving: false,
      direction: { left: false, right: false, up: false, down: false },
    })
  }, [sendMovement])

  // ─── ジョイスティック Pointer Events ───────────────────────────────────

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // 既にアクティブなポインタがあれば無視（マルチタッチ対策）
      if (activePointerId.current !== null) return

      e.preventDefault()
      e.stopPropagation()
      activePointerId.current = e.pointerId
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    []
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerId !== activePointerId.current) return
      if (!baseRef.current || !knobRef.current) return

      e.preventDefault()
      e.stopPropagation()

      const rect = baseRef.current.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2

      let dx = e.clientX - centerX
      let dy = e.clientY - centerY

      // 円形にクランプ
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance > MAX_RADIUS) {
        dx = (dx / distance) * MAX_RADIUS
        dy = (dy / distance) * MAX_RADIUS
      }

      // ノブの位置を更新（CSS transformで移動）
      knobRef.current.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`

      // 正規化して方向を算出
      const normalizedX = dx / MAX_RADIUS
      const normalizedY = dy / MAX_RADIUS
      const movement = normalizedToDirection(normalizedX, normalizedY)
      sendMovement(movement)
    },
    [sendMovement]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerId !== activePointerId.current) return

      e.preventDefault()
      activePointerId.current = null

      // ノブを中央に戻す
      if (knobRef.current) {
        knobRef.current.style.transform = 'translate(-50%, -50%)'
      }

      stopMovement()
    },
    [stopMovement]
  )

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerId !== activePointerId.current) return
      activePointerId.current = null

      if (knobRef.current) {
        knobRef.current.style.transform = 'translate(-50%, -50%)'
      }

      stopMovement()
    },
    [stopMovement]
  )

  // ─── マップタップ移動 ────────────────────────────────────────────────

  useEffect(() => {
    const handleMapTap = (e: PointerEvent) => {
      // ジョイスティック操作中はタップ移動しない
      if (activePointerId.current !== null) return

      // タップ対象がマップ（Phaserのcanvas）かどうかを確認
      const target = e.target as HTMLElement
      const isCanvas = target.tagName === 'CANVAS'
      const isInPhaserContainer = target.closest('#phaser-container') !== null

      // UIボタン、チャット、メニュー、ジョイスティック自身へのタッチは除外
      if (!isCanvas && !isInPhaserContainer) return
      // React UIオーバーレイの子要素（ボタン等）へのタッチを除外
      if (target.closest('[data-no-tap-move]')) return

      try {
        const game = phaserGame.scene.keys.game as Game
        if (!game?.myPlayer) return

        // Phaser カメラの座標系にタップ位置を変換
        const camera = game.cameras.main
        const worldX = camera.scrollX + (e.clientX / camera.zoom)
        const worldY = camera.scrollY + (e.clientY / camera.zoom)

        // 自キャラ位置との差分から方向ベクトルを算出
        const playerX = game.myPlayer.x
        const playerY = game.myPlayer.y
        const dx = worldX - playerX
        const dy = worldY - playerY
        const dist = Math.sqrt(dx * dx + dy * dy)

        // 近すぎるタップは無視（自キャラの上をタップした場合）
        if (dist < 20) return

        const nx = dx / dist
        const ny = dy / dist

        const movement = normalizedToDirection(nx, ny)

        // 前回のタイマーをクリア
        if (tapMoveTimer.current) {
          clearTimeout(tapMoveTimer.current)
        }

        // 方向へ一定時間移動
        sendMovement(movement)

        tapMoveTimer.current = setTimeout(() => {
          stopMovement()
          tapMoveTimer.current = null
        }, TAP_MOVE_DURATION)
      } catch {
        // ゲームシーンが未初期化の場合は無視
      }
    }

    // pointerdown でマップタップを検出
    document.addEventListener('pointerdown', handleMapTap, { passive: false })

    return () => {
      document.removeEventListener('pointerdown', handleMapTap)
      if (tapMoveTimer.current) {
        clearTimeout(tapMoveTimer.current)
      }
    }
  }, [sendMovement, stopMovement])

  // コンポーネントアンマウント時に移動を確実に停止
  useEffect(() => {
    return () => {
      stopMovement()
    }
  }, [stopMovement])

  return (
    <>
      <JoystickContainer
        deviceType={deviceType}
        data-no-tap-move
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <JoystickBase ref={baseRef} size={BASE_SIZE}>
          <JoystickKnob ref={knobRef} knobSize={KNOB_SIZE} />
        </JoystickBase>
      </JoystickContainer>
    </>
  )
}
