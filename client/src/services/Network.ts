import { Client, Room } from 'colyseus.js'
import { IComputer, IOfficeState, IPlayer, IWhiteboard, ISignboard, IPlacedItem } from '../../../types/IOfficeState'
import { Message, KICKED_BY_OTHER_TAB } from '../../../types/Messages'
import { IRoomData, RoomType } from '../../../types/Rooms'
import { ItemType } from '../../../types/Items'
import WebRTC from '../web/WebRTC'
import { phaserEvents, Event } from '../events/EventCenter'
import { getClientId } from '../util/clientId'
import { saveReconnectIntent } from '../util/reconnect'
import { recordDisconnect, printDisconnectLog, clearDisconnectLog } from '../util/disconnectLog'
import store from '../stores'
import {
  setSessionId,
  setPlayerNameMap,
  removePlayerNameMap,
  setPlayerStatus,
  removePlayerStatus,
  setPlayerHandRaised,
  removePlayerHandRaised,
  setPlayerMeetingRoomId,
  removePlayerMeetingRoomId,
  setPlayerAudioMuted,
  removePlayerAudioMuted,
  setPlayerScreenSharing,
  removePlayerScreenSharing,
  setPlayerUserKey,
  removePlayerUserKey,
} from '../stores/UserStore'
import { addDmMessage, setDmHistory, setDmName, DMMessage } from '../stores/DMStore'
import { setStamps, Stamp } from '../stores/StampStore'
import {
  setLobbyJoined,
  setJoinedRoomData,
  setAvailableRooms,
  addAvailableRooms,
  removeAvailableRooms,
  setDisconnectReason,
} from '../stores/RoomStore'
import {
  pushChatMessage,
  removeChatMessage,
  pushFileMessage,
  updateChatReaders,
  FileAttachment,
} from '../stores/ChatStore'

// WebSocketのcloseコードを人が読める説明にする（切断原因の切り分け用）
function describeCloseCode(code: number): string {
  switch (code) {
    case 1000: return '正常終了'
    case 1001: return '離脱（タブを閉じた/リロード等）'
    case 1006: return '異常終了・closeフレーム無し＝経路が無言で切断'
    case 1011: return 'サーバー内部エラー'
    case 1012: return 'サーバー再起動'
    case 4000: return '別タブに追い出された'
    default: return code >= 4000 ? 'アプリ独自コード' : 'その他'
  }
}

export default class Network {
  private client: Client
  private room?: Room<IOfficeState>
  private lobby!: Room
  webRTC?: WebRTC
  // アイドル切断を防ぐための心拍タイマー
  private heartbeatTimer?: ReturnType<typeof setInterval>

  mySessionId!: string

  constructor() {
    // 前回までの切断履歴をコンソールへ出す（再接続後もここで必ず見える）。
    // いつでも window.__disconnectLog() で再表示・__clearDisconnectLog() で消せる。
    printDisconnectLog()
    ;(window as unknown as { __disconnectLog?: () => void; __clearDisconnectLog?: () => void }).__disconnectLog = printDisconnectLog
    ;(window as unknown as { __clearDisconnectLog?: () => void }).__clearDisconnectLog = clearDisconnectLog

    const protocol = window.location.protocol.replace('http', 'ws')
    const endpoint =
      process.env.NODE_ENV === 'production'
        ? import.meta.env.VITE_SERVER_URL
        : `${protocol}//${window.location.hostname}:2567`
    this.client = new Client(endpoint)
    this.joinLobbyRoom().then(() => {
      store.dispatch(setLobbyJoined(true))
    })

    phaserEvents.on(Event.MY_PLAYER_NAME_CHANGE, this.updatePlayerName, this)
    phaserEvents.on(Event.MY_PLAYER_TEXTURE_CHANGE, this.updatePlayer, this)
    phaserEvents.on(Event.PLAYER_DISCONNECTED, this.playerStreamDisconnect, this)
  }

  /**
   * method to join Colyseus' built-in LobbyRoom, which automatically notifies
   * connected clients whenever rooms with "realtime listing" have updates
   */
  async joinLobbyRoom() {
    this.lobby = await this.client.joinOrCreate(RoomType.LOBBY)

    this.lobby.onMessage('rooms', (rooms) => {
      store.dispatch(setAvailableRooms(rooms))
    })

    this.lobby.onMessage('+', ([roomId, room]) => {
      store.dispatch(addAvailableRooms({ roomId, room }))
    })

    this.lobby.onMessage('-', (roomId) => {
      store.dispatch(removeAvailableRooms(roomId))
    })
  }

  // method to join the public lobby
  async joinOrCreatePublic() {
    this.room = await this.client.joinOrCreate(RoomType.PUBLIC, { clientId: getClientId() })
    this.initialize()
  }

  // method to join a custom room
  async joinCustomById(roomId: string, password: string | null) {
    this.room = await this.client.joinById(roomId, { password, clientId: getClientId() })
    this.initialize()
  }

  // 合言葉(roomKey)で固定ルームに入る。既存の同じ合言葉の部屋があれば合流し、
  // 無ければ作る。空室で一旦消えても、次回同じ合言葉で作り直されるためURLは常に有効。
  async joinOrCreateKeyed(roomKey: string, name?: string, password: string | null = null) {
    this.room = await this.client.joinOrCreate(RoomType.KEYED, {
      roomKey,
      name: name || `ルーム: ${roomKey}`,
      description: '',
      password,
      autoDispose: true,
      clientId: getClientId(),
    })
    this.initialize()
  }

  // method to create a custom room
  async createCustom(roomData: IRoomData) {
    const { name, description, password, autoDispose } = roomData
    this.room = await this.client.create(RoomType.CUSTOM, {
      name,
      description,
      password,
      autoDispose,
      clientId: getClientId(),
    })
    this.initialize()
  }

  // set up all network listeners before the game starts
  initialize() {
    if (!this.room) return

    // 切断されたら理由を控えておく。特に「同じブラウザの別タブで同じ部屋を開いた」場合は
    // サーバーが古いタブを追い出す（1ブラウザ=1キャラを保つため）。
    // これを無視すると、古いタブはマップを描き続けるのに送信だけが届かず、
    // 「看板が置けない・消せない」という原因の分からない状態になる。
    this.room.onLeave((code) => {
      // 切断の原因を特定できるよう、必ずコードを残す。
      // 1000=正常, 1001=離脱(タブ閉じ等), 1006=異常終了(closeフレーム無し＝中継や
      // ネットワークが無言でTCPを切った＝「突然の沈黙」), 4000番台=アプリ独自。
      // 定期的に1006で切れるなら経路のアイドル切断が濃厚。
      const reason = describeCloseCode(code)
      console.warn(`[Network] 切断されました code=${code} (${reason})`)
      // リロードで消えないよう履歴に残す。再接続後の読み込み時にまとめて表示される
      recordDisconnect(code, reason)
      // 心拍を止める（再入室後に多重起動しないように）
      this.stopHeartbeat()
      if (code === KICKED_BY_OTHER_TAB) {
        // 別タブに追い出された場合は自動で戻らない。
        // 戻すと今度は向こうを追い出すことになり、タブ同士で奪い合いになる。
        store.dispatch(setDisconnectReason('other-tab'))
        return
      }
      // サーバーの再起動や瞬断。復帰後に自動で同じ部屋へ戻れるよう控えておく
      saveReconnectIntent({ roomKey: store.getState().room.roomKey || null })
      store.dispatch(setDisconnectReason('lost'))
    })

    // 中継（Render等）がアイドルとみなしてWebSocketを無言で切るのを防ぐため、
    // 実データのメッセージを25秒ごとに送る。プロトコルのping/pongを数えない
    // 中継でも、これは本物のデータフレームなので確実に「通信中」と認識される。
    this.startHeartbeat()

    this.lobby.leave()
    this.mySessionId = this.room.sessionId
    store.dispatch(setSessionId(this.room.sessionId))
    this.webRTC = new WebRTC(this.mySessionId, this)

    // new instance added to the players MapSchema
    this.room.state.players.onAdd = (player: IPlayer, key: string) => {
      if (key === this.mySessionId) return

      // track changes on every child object inside the players MapSchema
      player.onChange = (changes) => {
        changes.forEach((change) => {
          const { field, value } = change
          phaserEvents.emit(Event.PLAYER_UPDATED, field, value, key)

          // when a new player finished setting up player name
          // 入室はサイドバーの「今日の出社記録」と「在席メンバー」で分かるため、
          // チャット欄には流さない（会話が埋もれるのを防ぐ）
          if (field === 'name' && value !== '') {
            phaserEvents.emit(Event.PLAYER_JOINED, player, key)
            store.dispatch(setPlayerNameMap({ id: key, name: value as string }))
          }

          // ステータス・離席理由の変化をストアに反映
          if (field === 'status' || field === 'awayMessage') {
            store.dispatch(setPlayerStatus({
              id: key,
              status: player.status,
              awayMessage: player.awayMessage,
            }))
          }

          // 挙手状態の変化をストアに反映
          if (field === 'handRaised') {
            store.dispatch(setPlayerHandRaised({ id: key, handRaised: player.handRaised }))
          }

          // 入室中のミーティングルームIDの変化をストアに反映
          if (field === 'meetingRoomId') {
            store.dispatch(setPlayerMeetingRoomId({ id: key, meetingRoomId: player.meetingRoomId }))
          }

          // マイクミュート状態の変化をストアに反映
          if (field === 'isAudioMuted') {
            store.dispatch(setPlayerAudioMuted({ id: key, isAudioMuted: player.isAudioMuted }))
          }

          // 画面共有状態の変化をストアに反映
          if (field === 'isScreenSharing') {
            store.dispatch(setPlayerScreenSharing({ id: key, isScreenSharing: player.isScreenSharing }))
          }

          // DM用のuserKeyをストアに反映（名前が分かればDMの表示名も記録）
          if (field === 'userKey' && player.userKey) {
            store.dispatch(setPlayerUserKey({ id: key, userKey: player.userKey }))
            if (player.name) store.dispatch(setDmName({ userKey: player.userKey, name: player.name }))
          }
        })

        // 参加直後にuserKeyが既に入っている場合にも反映する
        if (player.userKey) {
          store.dispatch(setPlayerUserKey({ id: key, userKey: player.userKey }))
          if (player.name) store.dispatch(setDmName({ userKey: player.userKey, name: player.name }))
        }
      }
    }

    // an instance removed from the players MapSchema
    this.room.state.players.onRemove = (player: IPlayer, key: string) => {
      // 退室も入室と同様、サイドバーの「今日の出社記録」「在席メンバー」で分かるため
      // チャット欄には流さない（会話が埋もれるのを防ぐ）
      phaserEvents.emit(Event.PLAYER_LEFT, key)
      this.webRTC?.deleteVideoStream(key)
      this.webRTC?.deleteOnCalledVideoStream(key)
      store.dispatch(removePlayerNameMap(key))
      store.dispatch(removePlayerStatus(key))
      store.dispatch(removePlayerHandRaised(key))
      store.dispatch(removePlayerMeetingRoomId(key))
      store.dispatch(removePlayerAudioMuted(key))
      store.dispatch(removePlayerScreenSharing(key))
      store.dispatch(removePlayerUserKey(key))
    }

    // new instance added to the computers MapSchema
    this.room.state.computers.onAdd = (computer: IComputer, key: string) => {
      // track changes on every child object's connectedUser
      computer.connectedUser.onAdd = (item, index) => {
        phaserEvents.emit(Event.ITEM_USER_ADDED, item, key, ItemType.COMPUTER)
      }
      computer.connectedUser.onRemove = (item, index) => {
        phaserEvents.emit(Event.ITEM_USER_REMOVED, item, key, ItemType.COMPUTER)
      }
    }

    // new instance added to the whiteboards MapSchema
    this.room.state.whiteboards.onAdd = (whiteboard: IWhiteboard, key: string) => {
      // track changes on every child object's connectedUser
      whiteboard.connectedUser.onAdd = (item, index) => {
        phaserEvents.emit(Event.ITEM_USER_ADDED, item, key, ItemType.WHITEBOARD)
      }
      whiteboard.connectedUser.onRemove = (item, index) => {
        phaserEvents.emit(Event.ITEM_USER_REMOVED, item, key, ItemType.WHITEBOARD)
      }
    }

    // 送信取消された発言をこちらの画面からも消す
    this.room.state.chatMessages.onRemove = (item) => {
      store.dispatch(removeChatMessage(item.id))
    }

    // new instance added to the chatMessages ArraySchema
    this.room.state.chatMessages.onAdd = (item, index) => {
      store.dispatch(pushChatMessage(item))
      
      // 既読配列の変更を監視
      item.readers.onAdd = () => {
        store.dispatch(updateChatReaders({ id: item.id, readers: Array.from(item.readers) }))
      }
      item.readers.onRemove = () => {
        store.dispatch(updateChatReaders({ id: item.id, readers: Array.from(item.readers) }))
      }
    }

    // 看板（全員同期）の追加/削除/移動をPhaser側へ通知
    this.room.state.signboards.onAdd = (signboard: ISignboard, key: string) => {
      phaserEvents.emit(Event.SIGNBOARD_ADDED, {
        id: key,
        x: signboard.x,
        y: signboard.y,
        text: signboard.text,
        image: signboard.image,
        url: signboard.url,
        createdBy: signboard.createdBy,
        bgColor: signboard.bgColor || '#fff8e1',
        textColor: signboard.textColor || '#1a1a1a',
        scale: signboard.scale || 1,
      })
      // 位置変更（ドラッグ移動）を監視して再配置
      signboard.onChange = (changes) => {
        if (changes.some((c) => c.field === 'x' || c.field === 'y')) {
          phaserEvents.emit(Event.SIGNBOARD_MOVED, { id: key, x: signboard.x, y: signboard.y })
        }
        if (changes.some((c) => c.field === 'scale')) {
          phaserEvents.emit(Event.SIGNBOARD_SCALED, { id: key, scale: signboard.scale })
        }
        const contentFields = ['text', 'image', 'url', 'bgColor', 'textColor']
        if (changes.some((c) => contentFields.includes(c.field))) {
          phaserEvents.emit(Event.SIGNBOARD_UPDATED, {
            id: key,
            x: signboard.x,
            y: signboard.y,
            text: signboard.text,
            image: signboard.image,
            url: signboard.url,
            bgColor: signboard.bgColor,
            textColor: signboard.textColor,
            scale: signboard.scale,
          })
        }
      }
    }
    this.room.state.signboards.onRemove = (_signboard: ISignboard, key: string) => {
      phaserEvents.emit(Event.SIGNBOARD_REMOVED, key)
    }

    // マップビルダー設置物（全員同期）の追加/削除/移動をPhaser側へ通知
    this.room.state.placedItems.onAdd = (item: IPlacedItem, key: string) => {
      phaserEvents.emit(Event.BUILDER_ITEM_ADDED, {
        id: key,
        itemType: item.itemType,
        x: item.x,
        y: item.y,
        frame: item.frame,
        direction: item.direction,
      })
      item.onChange = (changes) => {
        if (changes.some((c) => c.field === 'x' || c.field === 'y')) {
          phaserEvents.emit(Event.BUILDER_ITEM_MOVED, { id: key, x: item.x, y: item.y })
        }
      }
    }
    this.room.state.placedItems.onRemove = (_item: IPlacedItem, key: string) => {
      phaserEvents.emit(Event.BUILDER_ITEM_REMOVED, key)
    }

    // ミーティングルーム入口（全員同期）
    this.room.state.onChange = (changes) => {
      if (changes.some((c) => c.field === 'meetingEntranceX' || c.field === 'meetingEntranceY')) {
        phaserEvents.emit(Event.MEETING_ENTRANCE_CHANGED, {
          x: this.room!.state.meetingEntranceX,
          y: this.room!.state.meetingEntranceY,
        })
      }
    }

    // when the server sends room data
    this.room.onMessage(Message.SEND_ROOM_DATA, (content) => {
      store.dispatch(setJoinedRoomData(content))
    })

    // when a user sends a message
    this.room.onMessage(Message.ADD_CHAT_MESSAGE, ({ clientId, content }) => {
      phaserEvents.emit(Event.UPDATE_DIALOG_BUBBLE, clientId, content)
    })

    // スタンプの台帳。サーバーが配る一覧で丸ごと置き換える
    this.room.onMessage(Message.STAMP_LIST, (stamps: Record<string, Stamp>) => {
      store.dispatch(setStamps(stamps))
    })
    this.room.send(Message.REQUEST_STAMPS)

    // when a peer disconnects with myPeer
    this.room.onMessage(Message.DISCONNECT_STREAM, (clientId: string) => {
      this.webRTC?.deleteOnCalledVideoStream(clientId)
    })

    // when a computer user stops sharing screen
    this.room.onMessage(Message.STOP_SCREEN_SHARE, (clientId: string) => {
      const computerState = store.getState().computer
      computerState.shareScreenManager?.onUserLeft(clientId)
    })

    this.room.onMessage(Message.MEETING_WHITEBOARD_SYNC, ({ roomId, payload }) => {
      phaserEvents.emit(Event.MEETING_WHITEBOARD_REMOTE_UPDATE, roomId, payload)
    })

    this.room.onMessage(Message.MEETING_DOC_SYNC, ({ roomId, content }) => {
      phaserEvents.emit(Event.MEETING_DOC_REMOTE_UPDATE, roomId, content)
    })

    this.room.onMessage(Message.MEETING_TABS_SYNC, ({ roomId, tabs }) => {
      phaserEvents.emit(Event.MEETING_TABS_REMOTE_UPDATE, roomId, tabs)
    })

    this.room.onMessage(Message.MEETING_ACTIVE_TAB_SYNC, ({ roomId, tabId, byName }) => {
      phaserEvents.emit(Event.MEETING_ACTIVE_TAB_REMOTE_UPDATE, roomId, tabId, byName)
    })

    // DM受信（自分が送った分のエコーも含む）。通知（ポップアップ＋音）はDMNotificationが
    // Redux状態から検出して出すので、ここではストアに入れるだけ
    this.room.onMessage(Message.DM_MESSAGE, (msg: DMMessage) => {
      store.dispatch(addDmMessage({ myUserKey: getClientId(), msg }))
    })

    // DM履歴の受信（入室時にまとめて届く受信箱も含む）
    this.room.onMessage(Message.DM_HISTORY, ({ withUserKey, messages }: { withUserKey: string; messages: DMMessage[] }) => {
      store.dispatch(setDmHistory({ otherKey: withUserKey, messages }))
    })
    // 自分宛のDM（いなくなった相手からの置手紙も含む）をまとめて受け取る。
    // DM_HISTORYハンドラ登録の「後」に要求するので、応答を取りこぼさない
    this.room.send(Message.REQUEST_DM_INBOX)

    this.room.onMessage(Message.JUKEBOX_SYNC, (message) => {
      phaserEvents.emit('network-jukebox-sync', message)
    })

    // ノック受信
    this.room.onMessage(Message.KNOCK_PLAYER, (message: { fromSessionId: string; fromName: string }) => {
      phaserEvents.emit(Event.KNOCK_RECEIVED, message.fromSessionId, message.fromName)
    })

    // エモート受信（Phaser側で頭上に表示）
    this.room.onMessage(
      Message.SEND_EMOTE,
      (message: { sessionId: string; emoji: string; stampId?: string }) => {
        phaserEvents.emit(Event.EMOTE_RECEIVED, message.sessionId, message.emoji, message.stampId)
      }
    )

    // ファイル受信（チャットに表示）
    this.room.onMessage(
      Message.SEND_FILE_MESSAGE,
      (message: { author: string; file: FileAttachment; id?: string }) => {
        store.dispatch(pushFileMessage({ author: message.author, file: message.file, id: message.id }))
      }
    )
  }

  // Gameシーンの準備が整った後に呼ぶ。入室時点で既にサーバー状態にある看板・設置物・会議室入口を
  // 再度Phaser側へ通知して描画させる。onAdd/onChangeは入室直後（Gameシーンがリスナー登録する前）に
  // 発火してしまい、既存アイテムの描画イベントが取りこぼされるため、ここで明示的に再生する。
  replayExistingState() {
    if (!this.room) return
    this.room.state.signboards.forEach((signboard, key) => {
      phaserEvents.emit(Event.SIGNBOARD_ADDED, {
        id: key,
        x: signboard.x,
        y: signboard.y,
        text: signboard.text,
        image: signboard.image,
        url: signboard.url,
        createdBy: signboard.createdBy,
        bgColor: signboard.bgColor || '#fff8e1',
        textColor: signboard.textColor || '#1a1a1a',
        scale: signboard.scale || 1,
      })
    })
    this.room.state.placedItems.forEach((item, key) => {
      phaserEvents.emit(Event.BUILDER_ITEM_ADDED, {
        id: key,
        itemType: item.itemType,
        x: item.x,
        y: item.y,
        frame: item.frame,
        direction: item.direction,
      })
    })
    if (this.room.state.meetingEntranceX >= 0) {
      phaserEvents.emit(Event.MEETING_ENTRANCE_CHANGED, {
        x: this.room.state.meetingEntranceX,
        y: this.room.state.meetingEntranceY,
      })
    }
  }

  // method to register event listener and call back function when a item user added
  onChatMessageAdded(callback: (playerId: string, content: string) => void, context?: any) {
    phaserEvents.on(Event.UPDATE_DIALOG_BUBBLE, callback, context)
  }

  // method to register event listener and call back function when a item user added
  onItemUserAdded(
    callback: (playerId: string, key: string, itemType: ItemType) => void,
    context?: any
  ) {
    phaserEvents.on(Event.ITEM_USER_ADDED, callback, context)
  }

  // method to register event listener and call back function when a item user removed
  onItemUserRemoved(
    callback: (playerId: string, key: string, itemType: ItemType) => void,
    context?: any
  ) {
    phaserEvents.on(Event.ITEM_USER_REMOVED, callback, context)
  }

  // method to register event listener and call back function when a player joined
  onPlayerJoined(callback: (Player: IPlayer, key: string) => void, context?: any) {
    phaserEvents.on(Event.PLAYER_JOINED, callback, context)
  }

  // method to register event listener and call back function when a player left
  onPlayerLeft(callback: (key: string) => void, context?: any) {
    phaserEvents.on(Event.PLAYER_LEFT, callback, context)
  }

  // method to register event listener and call back function when myPlayer is ready to connect
  onMyPlayerReady(callback: (key: string) => void, context?: any) {
    phaserEvents.on(Event.MY_PLAYER_READY, callback, context)
  }

  // method to register event listener and call back function when my video is connected
  onMyPlayerVideoConnected(callback: (key: string) => void, context?: any) {
    phaserEvents.on(Event.MY_PLAYER_VIDEO_CONNECTED, callback, context)
  }

  // method to register event listener and call back function when a player updated
  onPlayerUpdated(
    callback: (field: string, value: number | string, key: string) => void,
    context?: any
  ) {
    phaserEvents.on(Event.PLAYER_UPDATED, callback, context)
  }

  // method to send player updates to Colyseus server
  updatePlayer(currentX: number, currentY: number, currentAnim: string) {
    this.room?.send(Message.UPDATE_PLAYER, { x: currentX, y: currentY, anim: currentAnim })
  }

  // method to send player name to Colyseus server
  updatePlayerName(currentName: string) {
    this.room?.send(Message.UPDATE_PLAYER_NAME, { name: currentName })
  }

  // method to send video status to Colyseus server
  updateVideoStatus(isVideoOff: boolean) {
    this.room?.send(Message.UPDATE_VIDEO_STATUS, { isVideoOff })
  }

  // method to send media status to Colyseus server
  updateMediaStatus(isVideoOff: boolean, isAudioMuted: boolean) {
    this.room?.send(Message.UPDATE_MEDIA_STATUS, { isVideoOff, isAudioMuted })
  }

  updateScreenSharing(isScreenSharing: boolean) {
    this.room?.send(Message.UPDATE_SCREEN_SHARING, { isScreenSharing })
  }

  // 他プレイヤーの同期済み状態を参照する（WebRTC側でカメラOFF/画面共有の表示判定に使う）
  getPlayerState(sessionId: string): IPlayer | undefined {
    return this.room?.state.players.get(sessionId)
  }

  // 経路のアイドル切断を防ぐ心拍。25秒ごとに実データを送る。
  // 30〜60秒あたりで無言のWebSocketを切る中継が多いので、それより短くする。
  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      try { this.room?.send(Message.HEARTBEAT) } catch {}
    }, 25000)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }

  // method to send ready-to-connect signal to Colyseus server
  readyToConnect() {
    this.room?.send(Message.READY_TO_CONNECT)
    this.requestJukeboxState()
    phaserEvents.emit(Event.MY_PLAYER_READY)
  }

  // method to send ready-to-connect signal to Colyseus server
  videoConnected() {
    this.room?.send(Message.VIDEO_CONNECTED)
    phaserEvents.emit(Event.MY_PLAYER_VIDEO_CONNECTED)
  }

  // method to send stream-disconnection signal to Colyseus server
  playerStreamDisconnect(id: string) {
    this.room?.send(Message.DISCONNECT_STREAM, { clientId: id })
    this.webRTC?.deleteVideoStream(id)
  }

  connectToComputer(id: string) {
    this.room?.send(Message.CONNECT_TO_COMPUTER, { computerId: id })
  }

  disconnectFromComputer(id: string) {
    this.room?.send(Message.DISCONNECT_FROM_COMPUTER, { computerId: id })
  }

  connectToWhiteboard(id: string) {
    this.room?.send(Message.CONNECT_TO_WHITEBOARD, { whiteboardId: id })
  }

  disconnectFromWhiteboard(id: string) {
    this.room?.send(Message.DISCONNECT_FROM_WHITEBOARD, { whiteboardId: id })
  }

  onStopScreenShare(id: string) {
    this.room?.send(Message.STOP_SCREEN_SHARE, { computerId: id })
  }

  // スタンプを登録する（画像は先に /api/files へ上げ、URLだけを渡す）
  addStamp(data: { name: string; category: string; url: string; type: string }) {
    this.room?.send(Message.ADD_STAMP, data)
  }

  // 自分が登録したスタンプを消す（サーバー側で本人か検証される）
  removeStamp(id: string) {
    this.room?.send(Message.REMOVE_STAMP, { id })
  }

  // 自分の発言を取り消す（サーバー側で本人か検証される）
  removeChatMessage(id: string) {
    this.room?.send(Message.REMOVE_CHAT_MESSAGE, { id })
  }

  addChatMessage(content: string) {
    this.room?.send(Message.ADD_CHAT_MESSAGE, { content: content })
  }

  markAsRead(messageId: string) {
    this.room?.send(Message.READ_CHAT_MESSAGE, { id: messageId })
  }

  updateStatus(status: string, awayMessage: string) {
    this.room?.send(Message.UPDATE_STATUS, { status, awayMessage })
  }

  updateMeetingRoomId(meetingRoomId: string) {
    this.room?.send(Message.UPDATE_MEETING_ROOM_ID, { meetingRoomId })
  }

  raiseHand(handRaised: boolean) {
    this.room?.send(Message.RAISE_HAND, { handRaised })
  }

  sendMeetingWhiteboardUpdate(roomId: string, payload: unknown) {
    this.room?.send(Message.MEETING_WHITEBOARD_SYNC, { roomId, payload })
  }

  requestMeetingWhiteboardSnapshot(roomId: string) {
    this.room?.send(Message.REQUEST_MEETING_WHITEBOARD_SNAPSHOT, { roomId })
  }

  sendMeetingDocUpdate(roomId: string, content: string) {
    this.room?.send(Message.MEETING_DOC_SYNC, { roomId, content })
  }

  requestMeetingDocSnapshot(roomId: string) {
    this.room?.send(Message.REQUEST_MEETING_DOC_SNAPSHOT, { roomId })
  }

  sendMeetingTabsUpdate(roomId: string, tabs: unknown) {
    this.room?.send(Message.MEETING_TABS_SYNC, { roomId, tabs })
  }

  requestMeetingTabsSnapshot(roomId: string) {
    this.room?.send(Message.REQUEST_MEETING_TABS_SNAPSHOT, { roomId })
  }

  sendMeetingActiveTabUpdate(roomId: string, tabId: string) {
    this.room?.send(Message.MEETING_ACTIVE_TAB_SYNC, { roomId, tabId })
  }

  requestMeetingActiveTab(roomId: string) {
    this.room?.send(Message.REQUEST_MEETING_ACTIVE_TAB, { roomId })
  }

  addSignboard(data: { x: number; y: number; text: string; image: string; url: string; bgColor?: string; textColor?: string; scale?: number }) {
    this.room?.send(Message.ADD_SIGNBOARD, data)
  }

  removeSignboard(id: string) {
    this.room?.send(Message.REMOVE_SIGNBOARD, { id })
  }

  updateSignboard(id: string, x: number, y: number) {
    this.room?.send(Message.UPDATE_SIGNBOARD, { id, x, y })
  }

  updateSignboardScale(id: string, scale: number) {
    this.room?.send(Message.UPDATE_SIGNBOARD, { id, scale })
  }

  updateSignboardContent(data: { id: string; text?: string; image?: string; url?: string; bgColor?: string; textColor?: string; scale?: number }) {
    this.room?.send(Message.UPDATE_SIGNBOARD_CONTENT, data)
  }

  sendJukeboxSync(data: { index: number; status: string; name: string; url: string; isLocal: boolean }) {
    this.room?.send(Message.JUKEBOX_SYNC, data)
  }

  requestJukeboxState() {
    this.room?.send(Message.REQUEST_JUKEBOX_STATE)
  }

  knockPlayer(targetSessionId: string) {
    this.room?.send(Message.KNOCK_PLAYER, { targetSessionId })
  }

  sendDm(toUserKey: string, content: string) {
    const id = `dm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    this.room?.send(Message.SEND_DM, { toUserKey, content, id })
  }

  requestDmHistory(withUserKey: string) {
    this.room?.send(Message.REQUEST_DM_HISTORY, { withUserKey })
  }

  // 頭上に出す。絵文字か、登録スタンプ（stampId）のどちらか
  sendEmote(emoji: string, stampId?: string) {
    this.room?.send(Message.SEND_EMOTE, { emoji, stampId })
  }

  sendFileMessage(file: FileAttachment, id: string) {
    this.room?.send(Message.SEND_FILE_MESSAGE, { file, id })
  }

  // ─── マップビルダー設置物（全員同期） ──────────────────────────────────────
  addBuilderItem(item: { id: string; itemType: string; x: number; y: number; frame: number; direction?: string }) {
    this.room?.send(Message.ADD_BUILDER_ITEM, item)
  }

  removeBuilderItem(id: string) {
    this.room?.send(Message.REMOVE_BUILDER_ITEM, { id })
  }

  moveBuilderItem(id: string, x: number, y: number) {
    this.room?.send(Message.MOVE_BUILDER_ITEM, { id, x, y })
  }

  clearBuilderItems() {
    this.room?.send(Message.CLEAR_BUILDER_ITEMS)
  }

  setMeetingEntrance(x: number, y: number) {
    this.room?.send(Message.SET_MEETING_ENTRANCE, { x, y })
  }
}
