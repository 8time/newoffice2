import bcrypt from 'bcrypt'
import fs from 'fs'
import path from 'path'
import { Room, Client, ServerError } from 'colyseus'
import { Dispatcher } from '@colyseus/command'
import { Player, OfficeState, Computer, Whiteboard, Signboard, PlacedItem } from './schema/OfficeState'
import { Message } from '../../types/Messages'
import { IRoomData } from '../../types/Rooms'
import { whiteboardRoomIds } from './schema/OfficeState'
import PlayerUpdateCommand from './commands/PlayerUpdateCommand'
import PlayerUpdateNameCommand from './commands/PlayerUpdateNameCommand'
import {
  ComputerAddUserCommand,
  ComputerRemoveUserCommand,
} from './commands/ComputerUpdateArrayCommand'
import {
  WhiteboardAddUserCommand,
  WhiteboardRemoveUserCommand,
} from './commands/WhiteboardUpdateArrayCommand'
import ChatMessageUpdateCommand from './commands/ChatMessageUpdateCommand'

const ATTENDANCE_FILE = path.join(__dirname, '../../attendance.json')
const SIGNBOARDS_FILE = path.join(__dirname, '../../signboards.json')
const BUILDER_FILE = path.join(__dirname, '../../builder.json')

// ─── マップビルダー設置物の永続化 ──────────────────────────────────────────────

interface PlacedItemRecord {
  id: string
  itemType: string
  x: number
  y: number
  frame: number
  direction: string
}

interface BuilderData {
  items: PlacedItemRecord[]
  meetingEntrance: { x: number; y: number } | null
}

function loadBuilder(): BuilderData {
  try {
    if (fs.existsSync(BUILDER_FILE)) {
      return JSON.parse(fs.readFileSync(BUILDER_FILE, 'utf-8'))
    }
  } catch {}
  return { items: [], meetingEntrance: null }
}

function saveBuilder(state: OfficeState) {
  try {
    const items: PlacedItemRecord[] = []
    state.placedItems.forEach((item, id) => {
      items.push({ id, itemType: item.itemType, x: item.x, y: item.y, frame: item.frame, direction: item.direction })
    })
    const meetingEntrance =
      state.meetingEntranceX >= 0 ? { x: state.meetingEntranceX, y: state.meetingEntranceY } : null
    fs.writeFileSync(BUILDER_FILE, JSON.stringify({ items, meetingEntrance }, null, 2), 'utf-8')
  } catch (e) {
    console.error('[Builder] 保存失敗:', e)
  }
}

// ─── 看板永続化 ────────────────────────────────────────────────────────────────

interface SignboardRecord {
  id: string
  x: number
  y: number
  text: string
  image: string
  url: string
  createdBy: string
  bgColor: string
  textColor: string
  scale: number
}

function loadSignboards(): SignboardRecord[] {
  try {
    if (fs.existsSync(SIGNBOARDS_FILE)) {
      return JSON.parse(fs.readFileSync(SIGNBOARDS_FILE, 'utf-8'))
    }
  } catch {}
  return []
}

function saveSignboards(signboards: { forEach: (cb: (sign: Signboard, id: string) => void) => void }) {
  try {
    const records: SignboardRecord[] = []
    signboards.forEach((sign, id) => {
      records.push({ id, x: sign.x, y: sign.y, text: sign.text, image: sign.image, url: sign.url, createdBy: sign.createdBy, bgColor: sign.bgColor, textColor: sign.textColor, scale: sign.scale })
    })
    fs.writeFileSync(SIGNBOARDS_FILE, JSON.stringify(records, null, 2), 'utf-8')
  } catch (e) {
    console.error('[Signboards] 保存失敗:', e)
  }
}

// ─── 勤怠 ─────────────────────────────────────────────────────────────────────

interface AttendanceRecord {
  name: string
  sessionId: string
  date: string        // YYYY-MM-DD
  checkIn: string     // ISO timestamp
  checkOut: string | null
}

function loadAttendance(): AttendanceRecord[] {
  try {
    if (fs.existsSync(ATTENDANCE_FILE)) {
      return JSON.parse(fs.readFileSync(ATTENDANCE_FILE, 'utf-8'))
    }
  } catch {}
  return []
}

function saveAttendance(records: AttendanceRecord[]) {
  try {
    fs.writeFileSync(ATTENDANCE_FILE, JSON.stringify(records, null, 2), 'utf-8')
  } catch (e) {
    console.error('[Attendance] 保存失敗:', e)
  }
}

export function recordCheckIn(sessionId: string, name: string) {
  const records = loadAttendance()
  const now = new Date()
  const date = now.toISOString().slice(0, 10)
  const existing = records.find((r) => r.sessionId === sessionId && r.date === date)
  if (!existing) {
    records.push({ name, sessionId, date, checkIn: now.toISOString(), checkOut: null })
    saveAttendance(records)
    console.log(`[Attendance] 出社記録: ${name} (${sessionId}) at ${now.toISOString()}`)
  }
}

export function recordCheckOut(sessionId: string) {
  const records = loadAttendance()
  const date = new Date().toISOString().slice(0, 10)
  const rec = records.find((r) => r.sessionId === sessionId && r.date === date && !r.checkOut)
  if (rec) {
    rec.checkOut = new Date().toISOString()
    saveAttendance(records)
    console.log(`[Attendance] 退社記録: ${rec.name} at ${rec.checkOut}`)
  }
}

export function getAttendanceForDate(date: string): AttendanceRecord[] {
  return loadAttendance().filter((r) => r.date === date)
}

export class SkyOffice extends Room<OfficeState> {
  private dispatcher = new Dispatcher(this)
  private name: string
  private description: string
  private password: string | null = null
  private meetingWhiteboardSnapshots = new Map<string, unknown>()
  private currentJukeboxState = {
    index: -1,
    status: 'stopped',
    name: '',
    url: '',
    isLocal: false
  }

  async onCreate(options: IRoomData) {
    const { name, description, password, autoDispose } = options
    this.name = name
    this.description = description
    this.autoDispose = autoDispose

    let hasPassword = false
    if (password) {
      const salt = await bcrypt.genSalt(10)
      this.password = await bcrypt.hash(password, salt)
      hasPassword = true
    }
    this.setMetadata({ name, description, hasPassword })

    this.setState(new OfficeState())

    // 看板データを永続化ファイルから復元
    const savedSignboards = loadSignboards()
    savedSignboards.forEach((record) => {
      const sign = new Signboard()
      sign.x = record.x
      sign.y = record.y
      sign.text = record.text || ''
      sign.image = record.image || ''
      sign.url = record.url || ''
      sign.createdBy = record.createdBy || ''
      sign.bgColor = /^#[0-9a-f]{6}$/i.test(record.bgColor || '') ? record.bgColor : '#fff8e1'
      sign.textColor = /^#[0-9a-f]{6}$/i.test(record.textColor || '') ? record.textColor : '#1a1a1a'
      sign.scale = Math.min(3, Math.max(0.3, Number(record.scale) || 1))
      this.state.signboards.set(record.id, sign)
    })
    if (savedSignboards.length > 0) {
      console.log(`[Signboards] ${savedSignboards.length} 件の看板を復元しました`)
    }

    // マップビルダー設置物を永続化ファイルから復元
    const savedBuilder = loadBuilder()
    savedBuilder.items.forEach((record) => {
      const item = new PlacedItem()
      item.itemType = record.itemType || 'chair'
      item.x = record.x
      item.y = record.y
      item.frame = record.frame || 0
      item.direction = record.direction || ''
      this.state.placedItems.set(record.id, item)
    })
    if (savedBuilder.meetingEntrance) {
      this.state.meetingEntranceX = savedBuilder.meetingEntrance.x
      this.state.meetingEntranceY = savedBuilder.meetingEntrance.y
    }
    if (savedBuilder.items.length > 0) {
      console.log(`[Builder] ${savedBuilder.items.length} 件の設置物を復元しました`)
    }

    // HARD-CODED: Add 5 computers in a room
    for (let i = 0; i < 5; i++) {
      this.state.computers.set(String(i), new Computer())
    }

    // HARD-CODED: Add 3 whiteboards in a room
    for (let i = 0; i < 3; i++) {
      this.state.whiteboards.set(String(i), new Whiteboard())
    }

    this.onMessage(Message.CONNECT_TO_COMPUTER, (client, message: { computerId: string }) => {
      this.dispatcher.dispatch(new ComputerAddUserCommand(), {
        client,
        computerId: message.computerId,
      })
    })

    this.onMessage(Message.DISCONNECT_FROM_COMPUTER, (client, message: { computerId: string }) => {
      this.dispatcher.dispatch(new ComputerRemoveUserCommand(), {
        client,
        computerId: message.computerId,
      })
    })

    this.onMessage(Message.STOP_SCREEN_SHARE, (client, message: { computerId: string }) => {
      const computer = this.state.computers.get(message.computerId)
      computer.connectedUser.forEach((id) => {
        this.clients.forEach((cli) => {
          if (cli.sessionId === id && cli.sessionId !== client.sessionId) {
            cli.send(Message.STOP_SCREEN_SHARE, client.sessionId)
          }
        })
      })
    })

    this.onMessage(Message.CONNECT_TO_WHITEBOARD, (client, message: { whiteboardId: string }) => {
      this.dispatcher.dispatch(new WhiteboardAddUserCommand(), {
        client,
        whiteboardId: message.whiteboardId,
      })
    })

    this.onMessage(
      Message.DISCONNECT_FROM_WHITEBOARD,
      (client, message: { whiteboardId: string }) => {
        this.dispatcher.dispatch(new WhiteboardRemoveUserCommand(), {
          client,
          whiteboardId: message.whiteboardId,
        })
      }
    )

    this.onMessage(
      Message.UPDATE_PLAYER,
      (client, message: { x: number; y: number; anim: string }) => {
        this.dispatcher.dispatch(new PlayerUpdateCommand(), {
          client,
          x: message.x,
          y: message.y,
          anim: message.anim,
        })
      }
    )

    this.onMessage(Message.UPDATE_PLAYER_NAME, (client, message: { name: string }) => {
      this.dispatcher.dispatch(new PlayerUpdateNameCommand(), {
        client,
        name: message.name,
      })
      // 名前が設定されたタイミングで勤怠を記録
      if (message.name) {
        recordCheckIn(client.sessionId, message.name)
      }
    })

    this.onMessage(Message.UPDATE_VIDEO_STATUS, (client, message: { isVideoOff: boolean }) => {
      const player = this.state.players.get(client.sessionId)
      if (player) {
        player.isVideoOff = message.isVideoOff
      }
    })

    this.onMessage(Message.UPDATE_MEDIA_STATUS, (client, message: { isVideoOff: boolean; isAudioMuted: boolean }) => {
      const player = this.state.players.get(client.sessionId)
      if (player) {
        player.isVideoOff = message.isVideoOff
        player.isAudioMuted = message.isAudioMuted
      }
    })

    this.onMessage(Message.READY_TO_CONNECT, (client) => {
      const player = this.state.players.get(client.sessionId)
      if (player) player.readyToConnect = true
    })

    this.onMessage(Message.VIDEO_CONNECTED, (client) => {
      const player = this.state.players.get(client.sessionId)
      if (player) player.videoConnected = true
    })

    this.onMessage(Message.DISCONNECT_STREAM, (client, message: { clientId: string }) => {
      this.clients.forEach((cli) => {
        if (cli.sessionId === message.clientId) {
          cli.send(Message.DISCONNECT_STREAM, client.sessionId)
        }
      })
    })

    this.onMessage(Message.ADD_CHAT_MESSAGE, (client, message: { content: string }) => {
      this.dispatcher.dispatch(new ChatMessageUpdateCommand(), {
        client,
        content: message.content,
      })
      this.broadcast(
        Message.ADD_CHAT_MESSAGE,
        { clientId: client.sessionId, content: message.content },
        { except: client }
      )
    })

    // チャット既読処理
    this.onMessage(Message.READ_CHAT_MESSAGE, (client, message: { id: string }) => {
      const chatMessage = this.state.chatMessages.find(m => m.id === message.id)
      if (chatMessage) {
        if (!chatMessage.readers.includes(client.sessionId)) {
          chatMessage.readers.push(client.sessionId)
        }
      }
    })

    // 着席中/離席中ステータス更新
    this.onMessage(
      Message.MEETING_WHITEBOARD_SYNC,
      (client, message: { roomId: string; payload: unknown }) => {
        this.meetingWhiteboardSnapshots.set(message.roomId, message.payload)
        this.broadcast(
          Message.MEETING_WHITEBOARD_SYNC,
          { roomId: message.roomId, payload: message.payload, clientId: client.sessionId },
          { except: client }
        )
      }
    )

    this.onMessage(
      Message.REQUEST_MEETING_WHITEBOARD_SNAPSHOT,
      (client, message: { roomId: string }) => {
        const payload = this.meetingWhiteboardSnapshots.get(message.roomId)
        if (payload) {
          client.send(Message.MEETING_WHITEBOARD_SYNC, { roomId: message.roomId, payload })
        }
      }
    )

    this.onMessage(
      Message.UPDATE_STATUS,
      (client, message: { status: string; awayMessage: string }) => {
        const player = this.state.players.get(client.sessionId)
        if (player) {
          player.status = message.status
          player.awayMessage = message.awayMessage || ''
        }
      }
    )

    // 看板を設置（全員に同期）
    this.onMessage(
      Message.ADD_SIGNBOARD,
      (client, message: { x: number; y: number; text: string; image: string; url: string; bgColor?: string; textColor?: string; scale?: number }) => {
        const sign = new Signboard()
        sign.x = message.x
        sign.y = message.y
        sign.text = (message.text || '').slice(0, 500)
        sign.image = message.image || ''
        sign.url = (message.url || '').slice(0, 2000)
        sign.createdBy = client.sessionId
        sign.bgColor = /^#[0-9a-f]{6}$/i.test(message.bgColor || '') ? message.bgColor! : '#fff8e1'
        sign.textColor = /^#[0-9a-f]{6}$/i.test(message.textColor || '') ? message.textColor! : '#1a1a1a'
        sign.scale = Math.min(3, Math.max(0.3, Number(message.scale) || 1))
        const id = `sign_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        this.state.signboards.set(id, sign)
        saveSignboards(this.state.signboards)
      }
    )

    // 看板を撤去
    this.onMessage(Message.REMOVE_SIGNBOARD, (client, message: { id: string }) => {
      if (this.state.signboards.has(message.id)) {
        this.state.signboards.delete(message.id)
        saveSignboards(this.state.signboards)
      }
    })

    // 看板を移動・スケール変更（全員に同期）
    this.onMessage(Message.UPDATE_SIGNBOARD, (client, message: { id: string; x?: number; y?: number; scale?: number }) => {
      const sign = this.state.signboards.get(message.id)
      if (sign) {
        if (message.x !== undefined) sign.x = message.x
        if (message.y !== undefined) sign.y = message.y
        if (message.scale !== undefined) sign.scale = Math.min(3, Math.max(0.3, message.scale))
        saveSignboards(this.state.signboards)
      }
    })

    // 看板のコンテンツ変更（全員に同期）
    this.onMessage(Message.UPDATE_SIGNBOARD_CONTENT, (client, message: { id: string; text?: string; image?: string; url?: string; bgColor?: string; textColor?: string; scale?: number }) => {
      const sign = this.state.signboards.get(message.id)
      if (sign) {
        if (message.text !== undefined) sign.text = (message.text || '').slice(0, 500)
        if (message.image !== undefined) sign.image = message.image || ''
        if (message.url !== undefined) sign.url = (message.url || '').slice(0, 2000)
        if (message.bgColor !== undefined && /^#[0-9a-f]{6}$/i.test(message.bgColor)) sign.bgColor = message.bgColor
        if (message.textColor !== undefined && /^#[0-9a-f]{6}$/i.test(message.textColor)) sign.textColor = message.textColor
        if (message.scale !== undefined) sign.scale = Math.min(3, Math.max(0.3, message.scale))
        saveSignboards(this.state.signboards)
      }
    })

    // ジュークボックスのリアルタイム同期（全員に配信）
    this.onMessage(
      Message.JUKEBOX_SYNC,
      (client, message: { index: number; status: string; name: string; url: string; isLocal: boolean }) => {
        this.currentJukeboxState = message
        this.broadcast(Message.JUKEBOX_SYNC, message, { except: client })
      }
    )

    this.onMessage(Message.REQUEST_JUKEBOX_STATE, (client) => {
      client.send(Message.JUKEBOX_SYNC, this.currentJukeboxState)
    })

    // ノック（呼び出し）: 送信者 → 対象者のみに転送
    this.onMessage(Message.KNOCK_PLAYER, (client, message: { targetSessionId: string }) => {
      const sender = this.state.players.get(client.sessionId)
      const target = this.clients.find((c) => c.sessionId === message.targetSessionId)
      if (target && sender) {
        target.send(Message.KNOCK_PLAYER, {
          fromSessionId: client.sessionId,
          fromName: sender.name,
        })
      }
    })

    // エモート: 全員にブロードキャスト（送信者含む）
    this.onMessage(Message.SEND_EMOTE, (client, message: { emoji: string }) => {
      this.broadcast(Message.SEND_EMOTE, {
        sessionId: client.sessionId,
        emoji: (message.emoji || '👍').slice(0, 4),
      })
    })

    // ファイル送信: 送信者以外の全員へ転送（送信者名を付与）
    this.onMessage(
      Message.SEND_FILE_MESSAGE,
      (client, message: { file: { name: string; type: string; url: string; size: number } }) => {
        const player = this.state.players.get(client.sessionId)
        const author = player?.name || '名無し'
        this.broadcast(
          Message.SEND_FILE_MESSAGE,
          { author, file: message.file },
          { except: client }
        )
      }
    )

    // ─── マップビルダー設置物（全員同期・永続化） ──────────────────────────────
    this.onMessage(
      Message.ADD_BUILDER_ITEM,
      (client, message: { id: string; itemType: string; x: number; y: number; frame: number; direction?: string }) => {
        if (!message.id) return
        const item = new PlacedItem()
        item.itemType = message.itemType || 'chair'
        item.x = message.x
        item.y = message.y
        item.frame = message.frame || 0
        item.direction = message.direction || ''
        this.state.placedItems.set(message.id, item)
        saveBuilder(this.state)
      }
    )

    this.onMessage(Message.REMOVE_BUILDER_ITEM, (client, message: { id: string }) => {
      if (this.state.placedItems.has(message.id)) {
        this.state.placedItems.delete(message.id)
        saveBuilder(this.state)
      }
    })

    this.onMessage(Message.MOVE_BUILDER_ITEM, (client, message: { id: string; x: number; y: number }) => {
      const item = this.state.placedItems.get(message.id)
      if (item) {
        item.x = message.x
        item.y = message.y
        saveBuilder(this.state)
      }
    })

    this.onMessage(Message.CLEAR_BUILDER_ITEMS, () => {
      this.state.placedItems.clear()
      saveBuilder(this.state)
    })

    this.onMessage(Message.SET_MEETING_ENTRANCE, (client, message: { x: number; y: number }) => {
      this.state.meetingEntranceX = message.x
      this.state.meetingEntranceY = message.y
      saveBuilder(this.state)
    })
  }

  async onAuth(client: Client, options: { password: string | null }) {
    if (this.password) {
      const validPassword = await bcrypt.compare(options.password, this.password)
      if (!validPassword) {
        throw new ServerError(403, 'Password is incorrect!')
      }
    }
    return true
  }

  onJoin(client: Client, options: any) {
    this.state.players.set(client.sessionId, new Player())
    client.send(Message.SEND_ROOM_DATA, {
      id: this.roomId,
      name: this.name,
      description: this.description,
    })
  }

  onLeave(client: Client, consented: boolean) {
    // 退社記録
    recordCheckOut(client.sessionId)

    if (this.state.players.has(client.sessionId)) {
      this.state.players.delete(client.sessionId)
    }
    this.state.computers.forEach((computer) => {
      if (computer.connectedUser.has(client.sessionId)) {
        computer.connectedUser.delete(client.sessionId)
      }
    })
    this.state.whiteboards.forEach((whiteboard) => {
      if (whiteboard.connectedUser.has(client.sessionId)) {
        whiteboard.connectedUser.delete(client.sessionId)
      }
    })
  }

  onDispose() {
    this.state.whiteboards.forEach((whiteboard) => {
      if (whiteboardRoomIds.has(whiteboard.roomId)) whiteboardRoomIds.delete(whiteboard.roomId)
    })

    console.log('room', this.roomId, 'disposing...')
    this.dispatcher.stop()
  }
}
