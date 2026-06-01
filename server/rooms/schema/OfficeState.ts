import { Schema, ArraySchema, SetSchema, MapSchema, type } from '@colyseus/schema'
import {
  IPlayer,
  IOfficeState,
  IComputer,
  IWhiteboard,
  IChatMessage,
  ISignboard,
} from '../../../types/IOfficeState'

export class Player extends Schema implements IPlayer {
  @type('string') name = ''
  @type('number') x = 705
  @type('number') y = 500
  @type('string') anim = 'adam_idle_down'
  @type('boolean') readyToConnect = false
  @type('boolean') videoConnected = false
  @type('boolean') isVideoOff = false
  @type('boolean') isAudioMuted = false
  @type('string') status = 'present'      // 'present' | 'away'
  @type('string') awayMessage = ''         // 離席理由
}

export class Computer extends Schema implements IComputer {
  @type({ set: 'string' }) connectedUser = new SetSchema<string>()
}

export class Whiteboard extends Schema implements IWhiteboard {
  @type('string') roomId = getRoomId()
  @type({ set: 'string' }) connectedUser = new SetSchema<string>()
}

export class ChatMessage extends Schema implements IChatMessage {
  @type('string') id = ''
  @type('string') author = ''
  @type('number') createdAt = new Date().getTime()
  @type('string') content = ''
  @type(['string']) readers = new ArraySchema<string>()
}

export class Signboard extends Schema implements ISignboard {
  @type('number') x = 0
  @type('number') y = 0
  @type('string') text = ''
  @type('string') image = ''
  @type('string') url = ''
  @type('string') createdBy = ''
}

export class OfficeState extends Schema implements IOfficeState {
  @type({ map: Player })
  players = new MapSchema<Player>()

  @type({ map: Computer })
  computers = new MapSchema<Computer>()

  @type({ map: Whiteboard })
  whiteboards = new MapSchema<Whiteboard>()

  @type([ChatMessage])
  chatMessages = new ArraySchema<ChatMessage>()

  @type({ map: Signboard })
  signboards = new MapSchema<Signboard>()
}

export const whiteboardRoomIds = new Set<string>()
const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const charactersLength = characters.length

function getRoomId(): string {
  let result = ''
  for (let i = 0; i < 12; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength))
  }
  if (!whiteboardRoomIds.has(result)) {
    whiteboardRoomIds.add(result)
    return result
  } else {
    console.log('roomId exists, remaking another one.')
    return getRoomId()
  }
}
