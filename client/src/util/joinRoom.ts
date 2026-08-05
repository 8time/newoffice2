import type Network from '../services/Network'

// 合言葉ルームの入室パスワードを端末に覚えておくキー（毎回入力しなくて済むように）
const pwStorageKey = (roomKey: string) => `roompw_${roomKey}`

function loadSavedPassword(roomKey: string): string | null {
  try {
    return localStorage.getItem(pwStorageKey(roomKey))
  } catch {
    return null
  }
}
function savePassword(roomKey: string, password: string) {
  try {
    localStorage.setItem(pwStorageKey(roomKey), password)
  } catch {
    /* 保存できなくても入室自体はできる */
  }
}
function clearSavedPassword(roomKey: string) {
  try {
    localStorage.removeItem(pwStorageKey(roomKey))
  } catch {
    /* no-op */
  }
}

// Colyseus が「パスワードが必要／間違い」で入室を拒否したときのエラーか判定する
function isPasswordError(err: any): boolean {
  return err?.code === 403
}

/**
 * 合言葉ルームへ入室する。パスワード（入室用の合言葉）が設定されている部屋では、
 * まず端末に覚えているパスワードで試し、ダメなら入力を促して再試行する。
 * キャンセルされたら元のエラーを投げる（＝入室しない）。
 */
export async function joinKeyedRoomWithPassword(
  network: Network,
  roomKey: string,
  name?: string
): Promise<void> {
  const saved = loadSavedPassword(roomKey)
  try {
    await network.joinOrCreateKeyed(roomKey, name, saved)
    return
  } catch (err) {
    if (!isPasswordError(err)) throw err
    // 覚えていたパスワードが古い可能性があるので消す
    clearSavedPassword(roomKey)
  }

  // パスワードを聞いて数回まで再試行
  for (let i = 0; i < 5; i++) {
    const input = window.prompt('この部屋の合言葉（入室パスワード）を入力してください')
    if (input === null) {
      // キャンセル
      throw new Error('入室をキャンセルしました')
    }
    try {
      await network.joinOrCreateKeyed(roomKey, name, input)
      savePassword(roomKey, input)
      return
    } catch (err) {
      if (!isPasswordError(err)) throw err
      window.alert('合言葉が違います。もう一度入力してください。')
    }
  }
  throw new Error('合言葉が一致しませんでした')
}

// パスワード変更後、自分が締め出されないように新しいパスワードを覚え直す
export function rememberRoomPassword(roomKey: string, password: string) {
  if (password) savePassword(roomKey, password)
  else clearSavedPassword(roomKey)
}
