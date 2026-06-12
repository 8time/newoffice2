import { Schema, ArraySchema, SetSchema, MapSchema } from '@colyseus/schema'

export interface IPlayer extends Schema {
  name: string
  x: number
  y: number
  anim: string
  readyToConnect: boolean
  videoConnected: boolean
  isVideoOff: boolean
  isAudioMuted: boolean
  status: string       // 'present' | 'away'
  awayMessage: string  // 離席理由
  meetingRoomId: string // 入室中のミーティングルームID（空なら未入室）
}

export interface IComputer extends Schema {
  connectedUser: SetSchema<string>
}

export interface IWhiteboard extends Schema {
  roomId: string
  connectedUser: SetSchema<string>
}

export interface IChatMessage extends Schema {
  id: string
  author: string
  createdAt: number
  content: string
  readers: ArraySchema<string>
}

export interface ISignboard extends Schema {
  x: number
  y: number
  text: string
  image: string // base64 data URL（空なら画像なし）
  url: string   // クリックで開くリンク（空ならリンクなし）
  createdBy: string
  bgColor: string    // 看板背景色 CSS hex (#rrggbb)
  textColor: string  // テキスト色 CSS hex
  scale: number      // 表示スケール (0.3〜3.0)
}

export interface IPlacedItem extends Schema {
  itemType: string   // 'chair' | 'computer' | 'whiteboard' | 'vendingmachine' | 'meetingroom'
  x: number
  y: number
  frame: number
  direction: string  // 空文字なら向き指定なし
}

export interface IOfficeState extends Schema {
  players: MapSchema<IPlayer>
  computers: MapSchema<IComputer>
  whiteboards: MapSchema<IWhiteboard>
  chatMessages: ArraySchema<IChatMessage>
  signboards: MapSchema<ISignboard>
  placedItems: MapSchema<IPlacedItem>
  meetingEntranceX: number  // -1 = 未設定
  meetingEntranceY: number
}
