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
}

export interface IOfficeState extends Schema {
  players: MapSchema<IPlayer>
  computers: MapSchema<IComputer>
  whiteboards: MapSchema<IWhiteboard>
  chatMessages: ArraySchema<IChatMessage>
  signboards: MapSchema<ISignboard>
}
