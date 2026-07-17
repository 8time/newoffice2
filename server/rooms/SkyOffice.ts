import bcrypt from 'bcrypt'
import path from 'path'
import { registerDoc, readDoc, writeDoc } from '../storage'
import { Room, Client, ServerError } from 'colyseus'
import { Dispatcher } from '@colyseus/command'
import { Player, OfficeState, Computer, Whiteboard, Signboard, PlacedItem, ChatMessage } from './schema/OfficeState'
import { Message, KICKED_BY_OTHER_TAB } from '../../types/Messages'
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

// 保存するデータの一覧。ローカル実行時は従来どおり同じJSONファイルへ書き出し、
// SUPABASE_URLがあればSupabaseへ保存する（Renderの無料枠はディスクが再起動で消えるため）。
const DOCS = {
  attendance: path.join(__dirname, '../../attendance.json'),
  signboards: path.join(__dirname, '../../signboards.json'),
  builder: path.join(__dirname, '../../builder.json'),
  whiteboards: path.join(__dirname, '../../meeting-whiteboards.json'),
  meetingDocs: path.join(__dirname, '../../meeting-docs.json'),
  meetingTabs: path.join(__dirname, '../../meeting-tabs.json'),
  chat: path.join(__dirname, '../../chat-history.json'),
  dm: path.join(__dirname, '../../dm-history.json'),
} as const
Object.entries(DOCS).forEach(([key, file]) => registerDoc(key, file))

// ─── チャット履歴の永続化（ルームごと・日付区切りでさかのぼれるように保持） ─────

interface ChatRecord {
  id: string
  author: string
  // 送信取消の本人判定用。再起動後も本人だと分かるように保存する
  authorKey?: string
  createdAt: number
  content: string
}

// ルームキーごとに直近のチャットを保持する
const CHAT_HISTORY_LIMIT = 500

function loadChatHistory(): Record<string, ChatRecord[]> {
  return readDoc<Record<string, ChatRecord[]>>('chat', {})
}

function saveChatHistory(all: Record<string, ChatRecord[]>) {
  writeDoc('chat', all)
}

// ─── ダイレクトメッセージ(DM)の永続化 ───────────────────────────────────────────

const DM_HISTORY_LIMIT = 500

interface DMRecord {
  id: string
  fromUserKey: string
  toUserKey: string
  fromName: string
  content: string
  createdAt: number
}

// 2人のuserKeyから会話IDを作る（順不同で同じIDになるようソート）
function dmConversationId(a: string, b: string): string {
  return [a, b].sort().join('__')
}

function loadDmHistory(): Record<string, DMRecord[]> {
  return readDoc<Record<string, DMRecord[]>>('dm', {})
}

function saveDmHistory(all: Record<string, DMRecord[]>) {
  writeDoc('dm', all)
}

// ─── ミーティングルームのホワイトボード永続化 ────────────────────────────────

function loadWhiteboards(): Record<string, unknown> {
  return readDoc<Record<string, unknown>>('whiteboards', {})
}

// 削除済み要素は同期のたびに増え続けるため、24時間以上前に更新されたものは
// ディスク保存時に間引く（他クライアントへの反映はメモリ上のreconcileで完結済み）
const DELETED_ELEMENT_TTL_MS = 24 * 60 * 60 * 1000

function pruneStaleDeletedElements(payload: any): unknown {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.elements)) return payload
  const now = Date.now()
  const elements = payload.elements.filter((el: any) => {
    if (!el || !el.isDeleted) return true
    const updated = typeof el.updated === 'number' ? el.updated : now
    return now - updated < DELETED_ELEMENT_TTL_MS
  })
  return { ...payload, elements }
}

function saveWhiteboards(snapshots: Map<string, unknown>) {
  const obj: Record<string, unknown> = {}
  snapshots.forEach((payload, roomId) => { obj[roomId] = pruneStaleDeletedElements(payload) })
  writeDoc('whiteboards', obj)
}

// ─── ミーティングルームの議事録メモ永続化 ──────────────────────────────────────

function loadMeetingDocs(): Record<string, string> {
  return readDoc<Record<string, string>>('meetingDocs', {})
}

function saveMeetingDocs(snapshots: Map<string, string>) {
  const obj: Record<string, string> = {}
  snapshots.forEach((content, roomId) => { obj[roomId] = content })
  writeDoc('meetingDocs', obj)
}

// ─── ミーティングルームのタブ構成永続化 ────────────────────────────────────────

function loadMeetingTabs(): Record<string, unknown> {
  return readDoc<Record<string, unknown>>('meetingTabs', {})
}

function saveMeetingTabs(snapshots: Map<string, unknown>) {
  const obj: Record<string, unknown> = {}
  snapshots.forEach((tabs, roomId) => { obj[roomId] = tabs })
  writeDoc('meetingTabs', obj)
}

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
  return readDoc<BuilderData>('builder', { items: [], meetingEntrance: null })
}

function saveBuilder(state: OfficeState) {
  try {
    const items: PlacedItemRecord[] = []
    state.placedItems.forEach((item, id) => {
      items.push({ id, itemType: item.itemType, x: item.x, y: item.y, frame: item.frame, direction: item.direction })
    })
    const meetingEntrance =
      state.meetingEntranceX >= 0 ? { x: state.meetingEntranceX, y: state.meetingEntranceY } : null
    writeDoc('builder', { items, meetingEntrance })
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

// 看板はルーム（合言葉）ごとに分けて保存する。以前は全ルーム共通の単一配列だったため、
// 別ルームの空状態で上書きされて看板が消えることがあった。
function loadAllSignboards(): Record<string, SignboardRecord[]> {
  const parsed = readDoc<Record<string, SignboardRecord[]> | SignboardRecord[]>('signboards', {})
  // 旧形式（配列）の場合は 'public' ルームのものとして移行する
  if (Array.isArray(parsed)) return { public: parsed }
  return parsed
}

function loadSignboards(roomKey: string): SignboardRecord[] {
  const all = loadAllSignboards()
  return all[roomKey] || []
}

function saveSignboards(
  signboards: { forEach: (cb: (sign: Signboard, id: string) => void) => void },
  roomKey: string
) {
  try {
    const records: SignboardRecord[] = []
    signboards.forEach((sign, id) => {
      records.push({ id, x: sign.x, y: sign.y, text: sign.text, image: sign.image, url: sign.url, createdBy: sign.createdBy, bgColor: sign.bgColor, textColor: sign.textColor, scale: sign.scale })
    })
    const all = loadAllSignboards()
    all[roomKey] = records
    writeDoc('signboards', all)
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

// 出社記録を残す日数。サイドバーに出すのは当日分だけで、遡って見る画面も無いため
// 長く持つ意味がない。上限が無いと毎日の出退勤が永久に積み上がる。
const ATTENDANCE_RETENTION_DAYS = 2

function loadAttendance(): AttendanceRecord[] {
  return readDoc<AttendanceRecord[]>('attendance', [])
}

// 古い記録を落とす。recordはYYYY-MM-DDのdateを持つので日付で比較する
function pruneAttendance(records: AttendanceRecord[]): AttendanceRecord[] {
  const cutoff = new Date(Date.now() - ATTENDANCE_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
  return records.filter((r) => r && typeof r.date === 'string' && r.date >= cutoff)
}

function saveAttendance(records: AttendanceRecord[]) {
  writeDoc('attendance', pruneAttendance(records))
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
  private whiteboardSaveTimer?: NodeJS.Timeout
  private meetingDocSnapshots = new Map<string, string>()
  private docSaveTimer?: NodeJS.Timeout
  private meetingTabsSnapshots = new Map<string, unknown>()
  // 会議室ID → 現在みんなが見ているタブID（全員で同じ板を見るため。永続化はしない）
  private meetingActiveTabs = new Map<string, string>()
  // sessionId → clientId（同じブラウザからの重複接続を検出して1キャラに保つため）
  private clientIdBySession = new Map<string, string>()
  // このルームのチャット履歴を保存するキー（固定ルームは合言葉で識別）
  private chatKey = 'public'
  private chatSaveTimer?: NodeJS.Timeout
  private currentJukeboxState = {
    index: -1,
    status: 'stopped',
    name: '',
    url: '',
    isLocal: false
  }

  async onCreate(options: IRoomData) {
    const { description, password, autoDispose, roomKey } = options
    // 合言葉で作られた固定ルームは名前が省略されることがあるので合言葉を名前に補う
    const name = options.name || (roomKey ? `ルーム: ${roomKey}` : 'Room')
    this.name = name
    this.description = description || ''
    this.autoDispose = autoDispose

    let hasPassword = false
    if (password) {
      const salt = await bcrypt.genSalt(10)
      this.password = await bcrypt.hash(password, salt)
      hasPassword = true
    }
    // roomKeyはfilterByの照合に使われる。metadataにも入れておく。
    this.setMetadata({ name, description: this.description, hasPassword, roomKey: roomKey || '' })

    // チャット履歴の保存キー（固定ルームは合言葉、それ以外は名前で分ける）
    this.chatKey = roomKey || name || 'public'

    this.setState(new OfficeState())

    // チャット履歴を永続化ファイルから復元（日付区切りでさかのぼれるように）
    const savedChat = loadChatHistory()[this.chatKey]
    if (Array.isArray(savedChat) && savedChat.length > 0) {
      savedChat.slice(-CHAT_HISTORY_LIMIT).forEach((rec) => {
        const m = new ChatMessage()
        m.id = rec.id
        m.author = rec.author
        m.authorKey = rec.authorKey || ''
        m.createdAt = rec.createdAt
        m.content = rec.content
        this.state.chatMessages.push(m)
      })
      console.log(`[Chat] ${savedChat.length} 件の履歴を復元しました (${this.chatKey})`)
    }

    // ミーティングルームのホワイトボードを永続化ファイルから復元
    const savedWhiteboards = loadWhiteboards()
    Object.entries(savedWhiteboards).forEach(([roomId, payload]) => {
      this.meetingWhiteboardSnapshots.set(roomId, payload)
    })
    const wbCount = Object.keys(savedWhiteboards).length
    if (wbCount > 0) {
      console.log(`[Whiteboards] ${wbCount} 件のホワイトボードを復元しました`)
    }

    // ミーティングルームの議事録メモを永続化ファイルから復元
    const savedDocs = loadMeetingDocs()
    Object.entries(savedDocs).forEach(([roomId, content]) => {
      this.meetingDocSnapshots.set(roomId, content)
    })
    const docCount = Object.keys(savedDocs).length
    if (docCount > 0) {
      console.log(`[MeetingDocs] ${docCount} 件のメモを復元しました`)
    }

    // ミーティングルームのタブ構成を永続化ファイルから復元
    const savedTabs = loadMeetingTabs()
    Object.entries(savedTabs).forEach(([roomId, tabs]) => {
      this.meetingTabsSnapshots.set(roomId, tabs)
    })
    const tabsCount = Object.keys(savedTabs).length
    if (tabsCount > 0) {
      console.log(`[MeetingTabs] ${tabsCount} 件のタブ構成を復元しました`)
    }

    // 看板データを永続化ファイルから復元
    const savedSignboards = loadSignboards(this.chatKey)
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

    this.onMessage(Message.UPDATE_SCREEN_SHARING, (client, message: { isScreenSharing: boolean }) => {
      const player = this.state.players.get(client.sessionId)
      if (player) player.isScreenSharing = !!message.isScreenSharing
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
      this.scheduleChatSave()
    })

    // 発言の取り消し（送信取消）。stateから消すと全員の画面からも消える
    this.onMessage(Message.REMOVE_CHAT_MESSAGE, (client, message: { id: string }) => {
      if (!message?.id) return
      const idx = this.state.chatMessages.findIndex((m) => m.id === message.id)
      if (idx === -1) return
      const msg = this.state.chatMessages[idx]
      const player = this.state.players.get(client.sessionId)
      // 取り消せるのは本人の発言だけ。名前は変更できるためキーで判定する。
      // authorKeyを持たない古い発言だけは、やむを得ず名前で判定する。
      const myKey = player?.userKey || ''
      const isOwn = msg.authorKey
        ? !!myKey && msg.authorKey === myKey
        : !!player?.name && msg.author === player.name
      if (!isOwn) return
      this.state.chatMessages.splice(idx, 1)
      this.scheduleChatSave()
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
      (client, message: { roomId: string; payload: any }) => {
        if (!message.roomId || !message.payload) return
        // クライアントは画像(files)だけでなく要素(elements)も「前回同期以降に変化した分」だけを
        // 差分で送ってくる。スナップショットは常に全量を持つ必要があるため、
        // 既存のfiles・elementsの両方とidベースでマージして保存する。
        const prev = this.meetingWhiteboardSnapshots.get(message.roomId) as any
        const prevFiles = (prev && typeof prev === 'object' && prev.files) || {}
        const prevElements: any[] = (prev && typeof prev === 'object' && Array.isArray(prev.elements)) ? prev.elements : []
        const incomingFiles = (message.payload.files && typeof message.payload.files === 'object') ? message.payload.files : {}
        const incomingElements: any[] = Array.isArray(message.payload.elements) ? message.payload.elements : []

        const mergedElementsMap = new Map<string, any>(prevElements.map((el) => [el.id, el]))
        incomingElements.forEach((el) => { if (el && el.id) mergedElementsMap.set(el.id, el) })

        const mergedPayload = {
          ...message.payload,
          elements: Array.from(mergedElementsMap.values()),
          files: { ...prevFiles, ...incomingFiles },
        }
        this.meetingWhiteboardSnapshots.set(message.roomId, mergedPayload)
        this.scheduleWhiteboardSave()
        // 他クライアントへは差分payloadのまま転送する（受信側は既に過去のfiles・elementsを保持している）
        this.broadcastToMeetingRoom(
          message.roomId,
          Message.MEETING_WHITEBOARD_SYNC,
          { roomId: message.roomId, payload: message.payload, clientId: client.sessionId },
          client
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

    // ミーティングルームの議事録メモ同期
    this.onMessage(
      Message.MEETING_DOC_SYNC,
      (client, message: { roomId: string; content: string }) => {
        if (!message.roomId || typeof message.content !== 'string') return
        const content = message.content.slice(0, 100000)
        this.meetingDocSnapshots.set(message.roomId, content)
        this.scheduleDocSave()
        this.broadcastToMeetingRoom(
          message.roomId,
          Message.MEETING_DOC_SYNC,
          { roomId: message.roomId, content },
          client
        )
      }
    )

    this.onMessage(
      Message.REQUEST_MEETING_DOC_SNAPSHOT,
      (client, message: { roomId: string }) => {
        const content = this.meetingDocSnapshots.get(message.roomId)
        if (content !== undefined) {
          client.send(Message.MEETING_DOC_SYNC, { roomId: message.roomId, content })
        }
      }
    )

    // ミーティングルームのタブ構成同期
    this.onMessage(
      Message.MEETING_TABS_SYNC,
      (client, message: { roomId: string; tabs: unknown }) => {
        if (!message.roomId || !Array.isArray(message.tabs)) return
        const tabs = (message.tabs as any[])
          .slice(0, 30)
          .map((t) => ({
            id: String(t?.id ?? '').slice(0, 100),
            name: String(t?.name ?? '').slice(0, 100),
            color: typeof t?.color === 'string' ? t.color.slice(0, 20) : undefined,
          }))
          .filter((t) => t.id)
        this.meetingTabsSnapshots.set(message.roomId, tabs)
        saveMeetingTabs(this.meetingTabsSnapshots)
        this.broadcastToMeetingRoom(
          message.roomId,
          Message.MEETING_TABS_SYNC,
          { roomId: message.roomId, tabs },
          client
        )
      }
    )

    this.onMessage(
      Message.REQUEST_MEETING_TABS_SNAPSHOT,
      (client, message: { roomId: string }) => {
        const tabs = this.meetingTabsSnapshots.get(message.roomId)
        if (tabs !== undefined) {
          client.send(Message.MEETING_TABS_SYNC, { roomId: message.roomId, tabs })
        }
      }
    )

    // 会議室で「今みんなが見ているタブ」を同期（全員が同じ板を見るため）
    this.onMessage(
      Message.MEETING_ACTIVE_TAB_SYNC,
      (client, message: { roomId: string; tabId: string }) => {
        if (!message.roomId || typeof message.tabId !== 'string') return
        const tabId = message.tabId.slice(0, 100)
        this.meetingActiveTabs.set(message.roomId, tabId)
        const byName = this.state.players.get(client.sessionId)?.name || ''
        this.broadcastToMeetingRoom(
          message.roomId,
          Message.MEETING_ACTIVE_TAB_SYNC,
          { roomId: message.roomId, tabId, byName },
          client
        )
      }
    )

    this.onMessage(
      Message.REQUEST_MEETING_ACTIVE_TAB,
      (client, message: { roomId: string }) => {
        const tabId = this.meetingActiveTabs.get(message.roomId)
        if (tabId !== undefined) {
          client.send(Message.MEETING_ACTIVE_TAB_SYNC, { roomId: message.roomId, tabId, byName: '' })
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

    // ミーティングルーム入退室（在室IDを全員に同期）
    this.onMessage(Message.UPDATE_MEETING_ROOM_ID, (client, message: { meetingRoomId: string }) => {
      const player = this.state.players.get(client.sessionId)
      if (player) {
        player.meetingRoomId = message.meetingRoomId || ''
        // 入室・退室のたびに挙手状態はリセットする
        player.handRaised = false
      }
    })

    // 挙手のトグル（会議室にいる間のみ有効）
    this.onMessage(Message.RAISE_HAND, (client, message: { handRaised: boolean }) => {
      const player = this.state.players.get(client.sessionId)
      if (player && player.meetingRoomId) {
        player.handRaised = !!message.handRaised
      }
    })

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
        saveSignboards(this.state.signboards, this.chatKey)
      }
    )

    // 看板を撤去
    this.onMessage(Message.REMOVE_SIGNBOARD, (client, message: { id: string }) => {
      if (this.state.signboards.has(message.id)) {
        this.state.signboards.delete(message.id)
        saveSignboards(this.state.signboards, this.chatKey)
      }
    })

    // 看板を移動・スケール変更（全員に同期）
    this.onMessage(Message.UPDATE_SIGNBOARD, (client, message: { id: string; x?: number; y?: number; scale?: number }) => {
      const sign = this.state.signboards.get(message.id)
      if (sign) {
        if (message.x !== undefined) sign.x = message.x
        if (message.y !== undefined) sign.y = message.y
        if (message.scale !== undefined) sign.scale = Math.min(3, Math.max(0.3, message.scale))
        saveSignboards(this.state.signboards, this.chatKey)
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
        saveSignboards(this.state.signboards, this.chatKey)
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
      (client, message: { file: { name: string; type: string; url: string; size: number }; id?: string }) => {
        const player = this.state.players.get(client.sessionId)
        const author = player?.name || '名無し'
        this.broadcast(
          Message.SEND_FILE_MESSAGE,
          { author, file: message.file, id: message.id },
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

    // ─── ダイレクトメッセージ(DM) ─────────────────────────────────────────────
    this.onMessage(Message.SEND_DM, (client, message: { toUserKey: string; content: string; id?: string }) => {
      const sender = this.state.players.get(client.sessionId)
      if (!sender || !sender.userKey || !message.toUserKey) return
      const content = (message.content || '').slice(0, 2000)
      if (!content.trim()) return

      const record: DMRecord = {
        id: message.id || `dm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        fromUserKey: sender.userKey,
        toUserKey: message.toUserKey,
        fromName: sender.name || '名無し',
        content,
        createdAt: Date.now(),
      }

      // 永続化（会話ごと）
      const all = loadDmHistory()
      const convId = dmConversationId(record.fromUserKey, record.toUserKey)
      const list = all[convId] || []
      list.push(record)
      all[convId] = list.slice(-DM_HISTORY_LIMIT)
      saveDmHistory(all)

      // 送信者・受信者の両方（全タブ）へ配信
      this.clients.forEach((cli) => {
        const p = this.state.players.get(cli.sessionId)
        if (p && (p.userKey === record.fromUserKey || p.userKey === record.toUserKey)) {
          cli.send(Message.DM_MESSAGE, record)
        }
      })
    })

    this.onMessage(Message.REQUEST_DM_HISTORY, (client, message: { withUserKey: string }) => {
      const me = this.state.players.get(client.sessionId)
      if (!me || !me.userKey || !message.withUserKey) return
      const convId = dmConversationId(me.userKey, message.withUserKey)
      const all = loadDmHistory()
      client.send(Message.DM_HISTORY, {
        withUserKey: message.withUserKey,
        messages: all[convId] || [],
      })
    })
  }

  // 会議室（ホワイトボード／メモ／タブ）の同期メッセージを、その会議室にいる参加者にだけ配信する。
  // roomIdが "board_" で始まる場合はマップ上の設置ホワイトボードとみなし、
  // そのホワイトボードに接続中(connectedUser)のクライアントにだけ配信する。
  private broadcastToMeetingRoom(roomId: string, type: number, payload: unknown, exceptClient?: Client) {
    if (roomId.startsWith('board_')) {
      const whiteboardId = roomId.slice('board_'.length)
      const whiteboard = this.state.whiteboards.get(whiteboardId)
      if (!whiteboard) return
      this.clients.forEach((cli) => {
        if (cli === exceptClient) return
        if (whiteboard.connectedUser.has(cli.sessionId)) cli.send(type, payload)
      })
      return
    }
    // ホワイトボードやメモのチャンネルIDは "<会議室ID>__<タブID>" 形式でタブごとに分かれるが、
    // プレイヤーが持つmeetingRoomIdは会議室IDだけ。完全一致で比較すると誰にも配信されなくなるため、
    // "__" より前の会議室IDで在室判定する。
    const meetingRoomId = roomId.split('__')[0]
    this.clients.forEach((cli) => {
      if (cli === exceptClient) return
      const player = this.state.players.get(cli.sessionId)
      if (player && player.meetingRoomId === meetingRoomId) cli.send(type, payload)
    })
  }

  // ホワイトボードは描画中に高頻度で更新されるため、3秒デバウンスでまとめて保存
  private scheduleWhiteboardSave() {
    if (this.whiteboardSaveTimer) return
    this.whiteboardSaveTimer = setTimeout(() => {
      saveWhiteboards(this.meetingWhiteboardSnapshots)
      this.whiteboardSaveTimer = undefined
    }, 3000)
  }

  // チャットは送信のたびに保存すると重いので3秒デバウンスでまとめて保存
  private scheduleChatSave() {
    if (this.chatSaveTimer) return
    this.chatSaveTimer = setTimeout(() => {
      this.persistChat()
      this.chatSaveTimer = undefined
    }, 3000)
  }

  private persistChat() {
    const all = loadChatHistory()
    all[this.chatKey] = this.state.chatMessages.slice(-CHAT_HISTORY_LIMIT).map((m) => ({
      id: m.id,
      author: m.author,
      authorKey: m.authorKey,
      createdAt: m.createdAt,
      content: m.content,
    }))
    saveChatHistory(all)
  }

  // 議事録メモも入力のたびに送られてくるため、3秒デバウンスでまとめて保存
  private scheduleDocSave() {
    if (this.docSaveTimer) return
    this.docSaveTimer = setTimeout(() => {
      saveMeetingDocs(this.meetingDocSnapshots)
      this.docSaveTimer = undefined
    }, 3000)
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
    // 同じブラウザ(clientId)からの古い接続が残っていたら追い出す。
    // リロードや再接続で古いセッションのキャラ（幽霊）が残り、複数キャラが
    // ついてくるように見える問題を防ぐ（1ブラウザ=1キャラ）。
    const clientId = options?.clientId
    if (clientId) {
      this.clients.forEach((other) => {
        if (other.sessionId !== client.sessionId && this.clientIdBySession.get(other.sessionId) === clientId) {
          if (this.state.players.has(other.sessionId)) this.state.players.delete(other.sessionId)
          this.clientIdBySession.delete(other.sessionId)
          // 通常の切断(1000)で追い出すと、古いタブは理由が分からないまま
          // 「マップは映るが看板の設置も削除もできない」状態になってしまう。
          // 専用コードで追い出し、古いタブ側で理由を表示できるようにする。
          try { other.leave(KICKED_BY_OTHER_TAB) } catch {}
        }
      })
      this.clientIdBySession.set(client.sessionId, clientId)
    }

    const player = new Player()
    // clientIdをDM用の識別子として同期する（ブラウザ固定・再接続で不変）
    if (clientId) player.userKey = clientId
    this.state.players.set(client.sessionId, player)
    client.send(Message.SEND_ROOM_DATA, {
      id: this.roomId,
      name: this.name,
      description: this.description,
    })
  }

  onLeave(client: Client, consented: boolean) {
    // 退社記録
    recordCheckOut(client.sessionId)
    this.clientIdBySession.delete(client.sessionId)

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

    // 保留中のホワイトボード保存を確実に書き出す
    if (this.whiteboardSaveTimer) {
      clearTimeout(this.whiteboardSaveTimer)
      this.whiteboardSaveTimer = undefined
    }
    saveWhiteboards(this.meetingWhiteboardSnapshots)

    // 保留中の議事録メモ保存を確実に書き出す
    if (this.docSaveTimer) {
      clearTimeout(this.docSaveTimer)
      this.docSaveTimer = undefined
    }
    saveMeetingDocs(this.meetingDocSnapshots)

    // 保留中のチャット履歴を確実に書き出す
    if (this.chatSaveTimer) {
      clearTimeout(this.chatSaveTimer)
      this.chatSaveTimer = undefined
    }
    this.persistChat()

    console.log('room', this.roomId, 'disposing...')
    this.dispatcher.stop()
  }
}
