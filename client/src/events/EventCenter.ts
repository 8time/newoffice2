import Phaser from 'phaser'

export const phaserEvents = new Phaser.Events.EventEmitter()

export enum Event {
  PLAYER_JOINED = 'player-joined',
  PLAYER_UPDATED = 'player-updated',
  PLAYER_LEFT = 'player-left',
  PLAYER_DISCONNECTED = 'player-disconnected',
  MY_PLAYER_READY = 'my-player-ready',
  MY_PLAYER_NAME_CHANGE = 'my-player-name-change',
  MY_PLAYER_TEXTURE_CHANGE = 'my-player-texture-change',
  MY_PLAYER_VIDEO_CONNECTED = 'my-player-video-connected',
  ITEM_USER_ADDED = 'item-user-added',
  ITEM_USER_REMOVED = 'item-user-removed',
  UPDATE_DIALOG_BUBBLE = 'update-dialog-bubble',
  BUILDER_ENTER = 'builder-enter',
  BUILDER_EXIT = 'builder-exit',
  BUILDER_IMPORT = 'builder-import',
  BUILDER_CLEAR = 'builder-clear',
  BUILDER_PICK_MEETING_ENTRANCE = 'builder-pick-meeting-entrance',
  JUKEBOX_PLAY = 'jukebox-play',
  JUKEBOX_PAUSE = 'jukebox-pause',
  JUKEBOX_STOP = 'jukebox-stop',
  JUKEBOX_NEXT = 'jukebox-next',
  JUKEBOX_REPEAT = 'jukebox-repeat',
  JUKEBOX_VOLUME = 'jukebox-volume',
  JUKEBOX_STATE_UPDATE = 'jukebox-state-update',
  // 着席/離席ステータス
  PLAYER_STATUS_CHANGED = 'player-status-changed',
  MY_STATUS_CHANGED = 'my-status-changed',
  // 吹き出し詳細表示（React側でダイアログを出す）
  SHOW_AWAY_MESSAGE = 'show-away-message',
  // 近接時のマイク制御
  PROXIMITY_ENTER = 'proximity-enter',
  PROXIMITY_LEAVE = 'proximity-leave',
  MEETING_ROOM_ENTER = 'meeting-room-enter',
  MEETING_ROOM_EXIT = 'meeting-room-exit',
  MEETING_WHITEBOARD_REMOTE_UPDATE = 'meeting-whiteboard-remote-update',
  // 看板（全員同期）
  SIGNBOARD_ADDED = 'signboard-added',
  SIGNBOARD_REMOVED = 'signboard-removed',
  SIGNBOARD_MOVED = 'signboard-moved',
  SIGNBOARD_SCALED = 'signboard-scaled',
  SIGNBOARD_UPDATED = 'signboard-updated',
  // 看板の設置を確定（入力ダイアログ → クリック位置に設置）
  SIGNBOARD_PLACE = 'signboard-place',
  // ノック（呼び出し）
  KNOCK_RECEIVED = 'knock-received',
  // エモート（頭上リアクション）
  EMOTE_RECEIVED = 'emote-received',
}
