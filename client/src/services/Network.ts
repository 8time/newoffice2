import { Client, Room } from 'colyseus.js'
import { IComputer, IOfficeState, IPlayer, IWhiteboard, ISignboard, IPlacedItem } from '../../../types/IOfficeState'
import { Message } from '../../../types/Messages'
import { IRoomData, RoomType } from '../../../types/Rooms'
import { ItemType } from '../../../types/Items'
import WebRTC from '../web/WebRTC'
import { phaserEvents, Event } from '../events/EventCenter'
import store from '../stores'
import { setSessionId, setPlayerNameMap, removePlayerNameMap, setPlayerStatus, removePlayerStatus } from '../stores/UserStore'
import {
  setLobbyJoined,
  setJoinedRoomData,
  setAvailableRooms,
  addAvailableRooms,
  removeAvailableRooms,
} from '../stores/RoomStore'
import {
  pushChatMessage,
  pushFileMessage,
  pushPlayerJoinedMessage,
  pushPlayerLeftMessage,
  updateChatReaders,
  FileAttachment,
} from '../stores/ChatStore'
import { setWhiteboardUrls } from '../stores/WhiteboardStore'

export default class Network {
  private client: Client
  private room?: Room<IOfficeState>
  private lobby!: Room
  webRTC?: WebRTC

  mySessionId!: string

  constructor() {
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
    this.room = await this.client.joinOrCreate(RoomType.PUBLIC)
    this.initialize()
  }

  // method to join a custom room
  async joinCustomById(roomId: string, password: string | null) {
    this.room = await this.client.joinById(roomId, { password })
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
    })
    this.initialize()
  }

  // set up all network listeners before the game starts
  initialize() {
    if (!this.room) return

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
          if (field === 'name' && value !== '') {
            phaserEvents.emit(Event.PLAYER_JOINED, player, key)
            store.dispatch(setPlayerNameMap({ id: key, name: value as string }))
            store.dispatch(pushPlayerJoinedMessage(value as string))
          }

          // ステータス・離席理由の変化をストアに反映
          if (field === 'status' || field === 'awayMessage') {
            store.dispatch(setPlayerStatus({
              id: key,
              status: player.status,
              awayMessage: player.awayMessage,
            }))
          }
        })
      }
    }

    // an instance removed from the players MapSchema
    this.room.state.players.onRemove = (player: IPlayer, key: string) => {
      phaserEvents.emit(Event.PLAYER_LEFT, key)
      this.webRTC?.deleteVideoStream(key)
      this.webRTC?.deleteOnCalledVideoStream(key)
      store.dispatch(pushPlayerLeftMessage(player.name))
      store.dispatch(removePlayerNameMap(key))
      store.dispatch(removePlayerStatus(key))
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
      store.dispatch(
        setWhiteboardUrls({
          whiteboardId: key,
          roomId: whiteboard.roomId,
        })
      )
      // track changes on every child object's connectedUser
      whiteboard.connectedUser.onAdd = (item, index) => {
        phaserEvents.emit(Event.ITEM_USER_ADDED, item, key, ItemType.WHITEBOARD)
      }
      whiteboard.connectedUser.onRemove = (item, index) => {
        phaserEvents.emit(Event.ITEM_USER_REMOVED, item, key, ItemType.WHITEBOARD)
      }
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

    this.room.onMessage(Message.JUKEBOX_SYNC, (message) => {
      phaserEvents.emit('network-jukebox-sync', message)
    })

    // ノック受信
    this.room.onMessage(Message.KNOCK_PLAYER, (message: { fromSessionId: string; fromName: string }) => {
      phaserEvents.emit(Event.KNOCK_RECEIVED, message.fromSessionId, message.fromName)
    })

    // エモート受信（Phaser側で頭上に表示）
    this.room.onMessage(Message.SEND_EMOTE, (message: { sessionId: string; emoji: string }) => {
      phaserEvents.emit(Event.EMOTE_RECEIVED, message.sessionId, message.emoji)
    })

    // ファイル受信（チャットに表示）
    this.room.onMessage(
      Message.SEND_FILE_MESSAGE,
      (message: { author: string; file: FileAttachment; id?: string }) => {
        store.dispatch(pushFileMessage({ author: message.author, file: message.file, id: message.id }))
      }
    )
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

  sendMeetingWhiteboardUpdate(roomId: string, payload: unknown) {
    this.room?.send(Message.MEETING_WHITEBOARD_SYNC, { roomId, payload })
  }

  requestMeetingWhiteboardSnapshot(roomId: string) {
    this.room?.send(Message.REQUEST_MEETING_WHITEBOARD_SNAPSHOT, { roomId })
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

  sendEmote(emoji: string) {
    this.room?.send(Message.SEND_EMOTE, { emoji })
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
