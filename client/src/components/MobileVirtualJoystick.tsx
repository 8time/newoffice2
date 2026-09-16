/**
 * MobileVirtualJoystick — デバイス種別に応じたジョイスティック表示制御
 *
 * PC: ジョイスティックを表示しない（設定で手動ONにした場合は既存のreact-joystick-component）
 * タブレット/スマホ: 新しいPointer Events対応のTabletJoystickを表示
 *
 * 既存のPC版の動作は変更しない。
 */

import { useEffect, useState } from 'react'
import styled from 'styled-components'
import JoystickItem from './Joystick'
import TabletJoystick from './TabletJoystick'

import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'

import { useAppSelector } from '../hooks'
import { JoystickMovement } from './Joystick'
import { getDeviceType, DeviceType } from '../utils/deviceDetect'

// 既存のPC用ジョイスティック配置（変更なし）
const Backdrop = styled.div`
  position: fixed;
  bottom: 100px;
  right: 32px;
  max-height: 50%;
  max-width: 100%;
`

const Wrapper = styled.div`
  position: relative;
  height: 100%;
  padding: 16px;
  display: flex;
  flex-direction: column;
`

const JoystickWrapper = styled.div`
  margin-top: auto;
  align-self: flex-end;
`
export const minimumScreenWidthSize = 650 //px

// デバイス種別を返すカスタムフック（リサイズ時に再評価）
function useDeviceType(): DeviceType {
  const [deviceType, setDeviceType] = useState<DeviceType>(getDeviceType())

  useEffect(() => {
    const handleResize = () => setDeviceType(getDeviceType())
    window.addEventListener('resize', handleResize)
    // 画面の向きが変わった場合にも再評価
    window.addEventListener('orientationchange', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleResize)
    }
  }, [])

  return deviceType
}

const isSmallScreen = (smallScreenSize: number) => {
  const [width, setWidth] = useState(window.innerWidth)

  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return width <= smallScreenSize
}

export default function MobileVirtualJoystick() {
  const showJoystick = useAppSelector((state) => state.user.showJoystick)
  const showChat = useAppSelector((state) => state.chat.showChat)
  const hasSmallScreen = isSmallScreen(minimumScreenWidthSize)
  const deviceType = useDeviceType()
  const game = phaserGame.scene.keys.game as Game

  useEffect(() => {}, [showJoystick, showChat])

  const handleMovement = (movement: JoystickMovement) => {
    game.myPlayer?.handleJoystickMovement(movement)
  }

  // タブレット/スマホ: 新しいPointer Events対応ジョイスティックを表示
  // showJoystickの設定に関係なく常に表示（タッチデバイスでは必須UIのため）
  if (deviceType === 'tablet' || deviceType === 'phone') {
    return <TabletJoystick deviceType={deviceType} />
  }

  // PC: 設定で手動ONにした場合のみ既存ジョイスティックを表示
  return (
    <Backdrop>
      <Wrapper>
        {!(showChat && hasSmallScreen) && showJoystick && (
          <JoystickWrapper>
            <JoystickItem onDirectionChange={handleMovement}></JoystickItem>
          </JoystickWrapper>
        )}
      </Wrapper>
    </Backdrop>
  )
}
