import React from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'

import { useAppDispatch, useAppSelector } from '../hooks'
import { closeExitDialog } from '../stores/UiStore'
import { clearReconnectIntent, suppressReconnectSave } from '../util/reconnect'

export default function ExitConfirmDialog() {
  const dispatch = useAppDispatch()
  const open = useAppSelector((state) => state.ui.exitDialogOpen)

  const handleCancel = () => {
    dispatch(closeExitDialog())
  }

  const handleExit = () => {
    // 退社は明示的な操作なので、次に開いたとき自動で入り直さないようにする。
    // 覚え書きを消し、さらにリロード中の切断で onLeave が再保存しないよう抑止する。
    suppressReconnectSave()
    clearReconnectIntent()
    window.location.reload()
  }

  return (
    <Dialog open={open} onClose={handleCancel} maxWidth="xs" fullWidth>
      <DialogTitle>退社しますか？</DialogTitle>
      <DialogContent>
        <p style={{ color: '#333' }}>退社すると最初の画面に戻ります。もう一度ログインし直してください。</p>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCancel} color="inherit">キャンセル</Button>
        <Button onClick={handleExit} color="warning" variant="contained">退社する</Button>
      </DialogActions>
    </Dialog>
  )
}
