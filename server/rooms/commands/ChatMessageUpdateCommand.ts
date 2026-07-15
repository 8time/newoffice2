import { Command } from '@colyseus/command'
import { Client } from 'colyseus'
import { IOfficeState } from '../../../types/IOfficeState'
import { ChatMessage } from '../schema/OfficeState'

type Payload = {
  client: Client
  content: string
}

export default class ChatMessageUpdateCommand extends Command<IOfficeState, Payload> {
  execute(data: Payload) {
    const { client, content } = data
    const player = this.room.state.players.get(client.sessionId)
    const chatMessages = this.room.state.chatMessages

    if (!chatMessages) return

    /**
     * さかのぼり用に直近500件まで保持する（超えたら古いものから削除）
     */
    if (chatMessages.length >= 500) chatMessages.shift()

    const newMessage = new ChatMessage()
    newMessage.id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    newMessage.author = player.name
    newMessage.content = content
    chatMessages.push(newMessage)
  }
}
