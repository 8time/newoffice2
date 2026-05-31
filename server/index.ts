import http from 'http'
import express from 'express'
import cors from 'cors'
import { Server, LobbyRoom } from 'colyseus'
import { monitor } from '@colyseus/monitor'
import { RoomType } from '../types/Rooms'

// import socialRoutes from "@colyseus/social/express"

import { SkyOffice, getAttendanceForDate } from './rooms/SkyOffice'

const port = Number(process.env.PORT || 2567)
const app = express()

app.use(cors())
app.use(express.json())

import fs from 'fs'
import path from 'path'

// クライアントのビルドファイル（dist）を静的配信
app.use(express.static(path.join(process.cwd(), 'client/dist')))


// 勤怠記録取得API（?date=YYYY-MM-DD、省略時は今日）
app.get('/api/attendance', (req, res) => {
  const date = (req.query.date as string) || new Date().toISOString().slice(0, 10)
  res.json(getAttendanceForDate(date))
})

// client/public/assets/audio/ フォルダ内のmp3ファイルを動的にスキャンして返すAPI
app.get('/api/audio-list', (req, res) => {
  const audioDir = path.join(__dirname, '../client/public/assets/audio')
  try {
    if (fs.existsSync(audioDir)) {
      const files = fs.readdirSync(audioDir)
      const mp3Files = files
        .filter(file => file.toLowerCase().endsWith('.mp3') && file.toLowerCase() !== 'ping.mp3')
        .map(file => ({
          name: file.replace(/\.[^/.]+$/, ""), // 拡張子を削除して曲名に
          url: `assets/audio/${file}`,
          isLocal: false
        }))
      res.json(mp3Files)
    } else {
      res.json([])
    }
  } catch (err) {
    console.error('Failed to read audio directory:', err)
    res.status(500).json({ error: 'Failed to read audio directory' })
  }
})

const server = http.createServer(app)
const gameServer = new Server({
  server,
})

// register room handlers
gameServer.define(RoomType.LOBBY, LobbyRoom)
gameServer.define(RoomType.PUBLIC, SkyOffice, {
  name: 'Public Lobby',
  description: 'For making friends and familiarizing yourself with the controls',
  password: null,
  autoDispose: false,
})
gameServer.define(RoomType.CUSTOM, SkyOffice).enableRealtimeListing()

/**
 * Register @colyseus/social routes
 *
 * - uncomment if you want to use default authentication (https://docs.colyseus.io/server/authentication/)
 * - also uncomment the import statement
 */
// app.use("/", socialRoutes);

// register colyseus monitor AFTER registering your room handlers
app.use('/colyseus', monitor())

// SPAのクライアント側ルーティング対応（API等以外の全リクエストで index.html を返す）
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/colyseus')) {
    return next()
  }
  res.sendFile(path.join(process.cwd(), 'client/dist/index.html'))
})

gameServer.listen(port)
console.log(`Listening on ws://localhost:${port}`)
