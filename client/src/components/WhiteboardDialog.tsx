import React from 'react'
import styled from 'styled-components'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'

import { useAppSelector, useAppDispatch } from '../hooks'
import { closeWhiteboardDialog } from '../stores/WhiteboardStore'
import LazyWhiteboard from './LazyWhiteboard'

// 右側の余白541px = 常時表示される右サイドバー幅525px + 余白16px
// （サイドバー幅525px + 余白。以前は180pxでサイドバーの下に一部が隠れていた）
const Backdrop = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  padding: 16px 541px 16px 16px;
  width: 100%;
  height: 100%;
`
const Wrapper = styled.div`
  width: 100%;
  height: 100%;
  background: #222639;
  border-radius: 16px;
  padding: 16px;
  color: #eee;
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: max-content;

  .close {
    position: absolute;
    top: 0px;
    right: 0px;
  }
`

const WhiteboardWrapper = styled.div`
  flex: 1;
  border-radius: 25px;
  overflow: hidden;
  margin-right: 25px;
  background: #fff;
`

export default function WhiteboardDialog() {
  const whiteboardId = useAppSelector((state) => state.whiteboard.whiteboardId)
  const dispatch = useAppDispatch()

  return (
    <Backdrop>
      <Wrapper>
        <IconButton
          aria-label="close dialog"
          className="close"
          onClick={() => dispatch(closeWhiteboardDialog())}
        >
          <CloseIcon />
        </IconButton>
        {whiteboardId && (
          <WhiteboardWrapper>
            <LazyWhiteboard roomId={`board_${whiteboardId}`} />
          </WhiteboardWrapper>
        )}
      </Wrapper>
    </Backdrop>
  )
}
