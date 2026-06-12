import { GeminiClient } from './gemini-client'
import { KeibaData } from './keiba-data'
import {
  AgentAction, Perception, MemoryEntry, PersonalityTemplate,
  ActiveDebate, MAX_MEMORY_ENTRIES, AREAS,
} from './types'

export class AgentBrain {
  personality: PersonalityTemplate
  memory: MemoryEntry[] = []
  currentPrediction = ''
  lastChatTime = 0
  lastSignboardTime = 0
  tickCount = 0

  // ミッション進行状態（ミッション変更で自動リセット）
  private lastMission = ''
  private hasFetched = false
  private hasReported = false
  private hasFinalPick = false

  constructor(
    personality: PersonalityTemplate,
    private gemini: GeminiClient,
    private keibaData: KeibaData,
  ) {
    this.personality = personality
  }

  async decide(perception: Perception): Promise<AgentAction> {
    this.tickCount++

    // ミッション変更を検知してフラグをリセット
    if (perception.mission !== this.lastMission) {
      this.lastMission = perception.mission
      this.hasFetched = false
      this.hasReported = false
      this.hasFinalPick = false
    }

    // 討論中なら返答を最優先
    if (perception.activeDebate?.myTurn) {
      if (this.gemini.quotaExhausted) {
        return this.fallbackDebateReply(perception.activeDebate)
      }
      return this.generateDebateReply(perception.activeDebate, perception)
    }

    // ── ミッション稼働中: デスク役割に応じたパイプライン ──
    if (perception.mission) {
      const deskAction = await this.deskDecide(perception)
      if (deskAction) return deskAction
    }

    // ── ミッションなし or デスク待機: 自由行動（散歩・雑談） ──
    if (this.gemini.quotaExhausted) {
      return this.fallbackDecide(perception)
    }

    const prompt = this.buildDecisionPrompt(perception)
    try {
      const res = await this.gemini.generate(prompt, 150, this.personality.temperature)
      const action = this.parseDecision(res.text, perception)
      this.addMemory('observation', `tick${this.tickCount}: ${action.type}`, 2)
      return action
    } catch (err) {
      return this.fallbackDecide(perception)
    }
  }

  // ── デスク役割別の判断（ゼミ・パイプライン） ──
  // 戻り値 null = このデスクは今やることがない → 自由行動にフォールスルー
  private async deskDecide(p: Perception): Promise<AgentAction | null> {
    const bots = p.nearbyPlayers.filter(pl => pl.isBot)

    switch (this.personality.desk) {
      case 'A': {
        // データ収集班: レースIDがあれば調査、完了したら報告
        if (!p.missionRaceId) {
          // IDが無い課題 → 散歩しつつ待機（たまに告知）
          return this.tickCount % 3 === 0
            ? { type: 'chat', message: '課題にレースIDが必要だ' }
            : { type: 'wander', target: this.pickTarget() }
        }
        if (!p.dataReady && !this.hasFetched) {
          this.hasFetched = true
          return { type: 'fetch_data', raceId: p.missionRaceId }
        }
        if (p.dataReady && !this.hasReported) {
          this.hasReported = true
          return {
            type: 'report',
            message: `データ取得完了: ${p.missionRaceId}`,
            knowledge: { topic: p.missionRaceId, content: p.raceSummary },
          }
        }
        // 役目を終えたら散歩
        return this.tickCount % 2 === 0 ? { type: 'wander', target: this.pickTarget() } : { type: 'idle' }
      }

      case 'B': {
        // 分析班: デスクAの完了を待ち、数値を報告
        if (!p.dataReady) {
          return { type: 'idle' } // データ待ち
        }
        if (!this.hasReported) {
          this.hasReported = true
          const msg = this.buildAnalysisReport(p)
          this.currentPrediction = msg
          return { type: 'report', message: msg, knowledge: { topic: p.missionRaceId || '分析', content: p.raceSummary } }
        }
        return this.tickCount % 2 === 0 ? { type: 'wander', target: this.pickTarget() } : { type: 'idle' }
      }

      case 'C': {
        // 戦略・討論班: データが揃ったら討論・最終予想
        if (!p.dataReady) {
          return { type: 'idle' } // データ待ち
        }
        // 近くにAI仲間がいれば討論を持ちかける
        if (bots.length > 0 && this.tickCount % 2 === 0) {
          const opener = await this.buildConstrainedOpener(p)
          return { type: 'debate_initiate', targetAgent: bots[0].name, topic: p.missionRaceId || '本命', opener }
        }
        // 最終予想をまだ出していなければ出す
        if (!this.hasFinalPick) {
          this.hasFinalPick = true
          const pick = await this.buildConstrainedPick(p)
          this.currentPrediction = pick
          this.addMemory('prediction', pick, 5)
          return { type: 'report', message: pick }
        }
        return this.tickCount % 2 === 0 ? { type: 'wander', target: this.pickTarget() } : { type: 'idle' }
      }
    }
    return null
  }

  // ── デスクB: 分析レポート生成（数値優先・50字） ──
  private buildAnalysisReport(p: Perception): string {
    // raceSummary には上位馬+ペースが入っている。簡潔に。
    return p.raceSummary ? p.raceSummary.slice(0, 50) : '分析中...'
  }

  // ── デスクC: 制約付き討論の口火（C-1リスク / C-2大穴） ──
  private async buildConstrainedOpener(p: Perception): Promise<string> {
    if (this.gemini.quotaExhausted) {
      return this.personality.debateRole === 'conservative'
        ? 'その本命、展開リスクは考慮したか？'
        : '人気薄に一発ある。根拠を聞け'
    }
    const constraint = this.personality.debateRole === 'conservative'
      ? 'データに現れないリスク・マイナス要素を1つ指摘して問え。'
      : '統計が低くても大穴を開ける馬を1頭、根拠と共に推せ。'
    const prompt = `あなたは「${this.personality.name}」（${this.personality.role}）。${this.personality.speakingStyle}
レース: ${p.raceSummary}
${constraint}
40文字以内で討論の口火を切れ。返答のみ。`
    try {
      const res = await this.gemini.generate(prompt, 60, this.personality.temperature)
      return res.text.replace(/["""{}]/g, '').trim().slice(0, 50)
    } catch {
      return 'この予想、議論の余地がある'
    }
  }

  // ── デスクC: 制約付き最終予想 ──
  private async buildConstrainedPick(p: Perception): Promise<string> {
    if (this.gemini.quotaExhausted) {
      return this.personality.debateRole === 'conservative'
        ? `堅実本命: ${p.raceSummary.slice(0, 40)}`
        : `大穴狙い: ${p.raceSummary.slice(0, 40)}`
    }
    const constraint = this.personality.debateRole === 'conservative'
      ? 'リスクを踏まえた堅実な本命・対抗を挙げよ。'
      : '大穴を1頭含めた買い目を挙げよ。'
    const prompt = `あなたは「${this.personality.name}」（${this.personality.role}）。${this.personality.speakingStyle}
レース: ${p.raceSummary}
${constraint}
50文字以内で結論のみ。`
    try {
      const res = await this.gemini.generate(prompt, 80, this.personality.temperature)
      return res.text.replace(/["""{}]/g, '').trim().slice(0, 60)
    } catch {
      return `${p.raceSummary.slice(0, 40)}`
    }
  }

  // ── フォールバック脳（Geminiクォータ切れ時） ──
  private fallbackDecide(p: Perception): AgentAction {
    const humans = p.nearbyPlayers.filter(pl => !pl.isBot)
    const bots = p.nearbyPlayers.filter(pl => pl.isBot)
    const hasMission = !!p.mission

    // 課題が出ている場合は積極的に分析・討論
    if (hasMission) {
      const mPhase = this.tickCount % 4
      switch (mPhase) {
        case 0:
          // 予想を出す
          const pred = this.fallbackPrediction()
          this.currentPrediction = pred
          this.addMemory('prediction', pred, 4)
          return { type: 'chat', message: `${p.mission}→ ${pred.slice(0, 60)}` }
        case 1:
          // 仲間と討論
          if (bots.length > 0) {
            return { type: 'debate_initiate', targetAgent: bots[0].name, topic: p.mission, opener: `${p.mission}について、どう分析する？` }
          }
          return { type: 'chat', message: this.fallbackChat() }
        case 2:
          return { type: 'wander', target: this.pickTarget() }
        case 3:
          return { type: 'chat', message: this.fallbackChat() }
      }
    }

    // 通常モード: ティック数に応じてローテーション
    const phase = this.tickCount % 5
    switch (phase) {
      case 0:
      case 1:
        return { type: 'wander', target: this.pickTarget() }
      case 2:
        return { type: 'chat', message: this.fallbackChat() }
      case 3:
        if (bots.length > 0) {
          return { type: 'debate_initiate', targetAgent: bots[0].name, topic: '予想の根拠', opener: this.fallbackOpener() }
        }
        if (!this.currentPrediction) {
          const pred = this.fallbackPrediction()
          this.currentPrediction = pred
          this.addMemory('prediction', pred, 4)
          return { type: 'update_prediction', prediction: pred }
        }
        return { type: 'wander', target: this.pickTarget() }
      case 4:
        if (Math.random() < 0.5) {
          const pred = this.fallbackPrediction()
          this.currentPrediction = pred
          return { type: 'update_prediction', prediction: pred }
        }
        return { type: 'wander', target: this.pickTarget() }
      default:
        return { type: 'idle' }
    }
  }

  private fallbackChat(): string {
    const horses = this.keibaData.topPick()
    const templates: Record<string, string[]> = {
      bloodline: [
        horses ? `${horses.umaban}番${horses.name}...${horses.blood}が気になる` : '血統を精査中...',
        `${this.personality.catchphrase}`,
        '母父の影響、見逃せないな',
      ],
      data: [
        horses ? `${horses.umaban}番${horses.name}、U指数${horses.u}。注目だ` : 'データ分析中...',
        `${this.personality.catchphrase}`,
        'オメガ指数の高い馬を探そう',
      ],
      odds: [
        '人気馬を疑え。穴はどこだ',
        `${this.personality.catchphrase}`,
        '過大評価されてる馬がいるはずだ',
      ],
      training: ['追い切りの動きが全てを語る', `${this.personality.catchphrase}`],
      jockey: ['騎手の選択が結果を左右する', `${this.personality.catchphrase}`],
      pace: ['展開次第で結果は変わる', `${this.personality.catchphrase}`],
    }
    const pool = templates[this.personality.dataFocus] || [`${this.personality.catchphrase}`]
    return pool[Math.floor(Math.random() * pool.length)]
  }

  private fallbackOpener(): string {
    const openers = [
      'おい、本命どう思う？',
      '次のレース、意見を聞かせてくれ',
      '面白いデータを見つけたんだが',
      '予想の根拠、教えてくれないか',
    ]
    return openers[Math.floor(Math.random() * openers.length)]
  }

  private fallbackPrediction(): string {
    const top = this.keibaData.topPick()
    const shots = this.keibaData.longshots()
    switch (this.personality.dataFocus) {
      case 'bloodline':
        return top ? `◎${top.umaban}番${top.name}(${top.blood}) ${this.personality.catchphrase}` : '分析中...'
      case 'data':
        return top ? `◎${top.umaban}番${top.name}(U:${top.u} Ω:${top.omega}) ${this.personality.catchphrase}` : '分析中...'
      case 'odds':
        return shots.length ? `穴狙い！${shots.map(s => `★${s.umaban}番${s.name}`).join(' ')}` : '穴馬調査中...'
      default:
        return top ? `注目: ${top.umaban}番${top.name}` : '分析中...'
    }
  }

  private fallbackDebateReply(debate: ActiveDebate): AgentAction {
    const conservative = [
      'その本命、展開が向かねば飛ぶぞ',
      'データに出ないリスクを見落とすな',
      '人気馬にも不安要素はある',
    ]
    const intuitive = [
      'だが大穴に一発の根拠がある',
      'statが低くても買える馬がいる',
      '人気薄こそ妙味、見てろ',
    ]
    const neutral = [
      'なるほど、だが私はこう見る',
      'データが示す事実は別だ',
      '一理あるが結論は違う',
    ]
    const pool = this.personality.debateRole === 'conservative' ? conservative
      : this.personality.debateRole === 'intuitive' ? intuitive : neutral
    const msg = pool[Math.floor(Math.random() * pool.length)]
    return { type: 'debate_reply', debateId: debate.debateId, message: msg }
  }

  private buildDecisionPrompt(p: Perception): string {
    const nearby: string[] = []
    const humans = p.nearbyPlayers.filter(pl => !pl.isBot)
    const bots = p.nearbyPlayers.filter(pl => pl.isBot)
    if (humans.length) nearby.push(`人間: ${humans.map(h => h.name || '名無し').join(', ')}`)
    if (bots.length) nearby.push(`AI仲間: ${bots.map(b => b.name).join(', ')}`)

    const chat = p.recentChatMessages.slice(-4).map(m => `${m.author}: ${m.content.slice(0, 50)}`).join('\n')
    const mem = this.memory.filter(m => m.importance >= 3).slice(-3).map(m => m.content).join('; ')

    let raceInfo = ''
    if (p.currentRaceData) {
      const horses = p.currentRaceData.topHorses.slice(0, 4)
        .map(h => `${h.umaban}番${h.name}(U:${h.uIndex},血統:${h.blood})`)
        .join(' / ')
      raceInfo = `レース: ${horses}`
    }

    const missionLine = p.mission ? `\n★課題: 「${p.mission}」— この課題に沿って分析・討論・予想せよ。` : ''

    return `あなたは「${this.personality.name}」。${this.personality.role}の専門家AI。
${this.personality.speakingStyle}
口癖:「${this.personality.catchphrase}」
傾向: ${this.personality.biases.join('; ')}${missionLine}

周囲: ${nearby.length ? nearby.join(' | ') : '誰もいない'}
${chat ? `チャット:\n${chat}` : ''}
${raceInfo}
${mem ? `記憶: ${mem}` : ''}
予想: ${this.currentPrediction || '未定'}

JSONで1つ行動を選べ:
{"action":"idle"}
{"action":"wander"}
{"action":"chat","message":"70文字以内"}
${bots.length ? `{"action":"debate","target":"AI名","topic":"話題","opener":"70文字以内"}` : ''}
{"action":"predict","prediction":"予想200文字以内"}
${p.mission ? '→課題が出ている。分析して予想を出すか、仲間と議論せよ。' : ''}
${humans.length ? '→人間が近い。挨拶か予想を共有せよ。' : ''}
${bots.length ? '→AI仲間が近い。議論してもよい。' : ''}
JSONのみ出力。`
  }

  private parseDecision(raw: string, p: Perception): AgentAction {
    try {
      const match = raw.match(/\{[^}]+\}/)
      if (!match) return { type: 'idle' }
      const j = JSON.parse(match[0])

      switch (j.action) {
        case 'chat':
          return { type: 'chat', message: (j.message || '').slice(0, 70) }
        case 'wander':
          return { type: 'wander', target: this.pickTarget() }
        case 'debate': {
          const t = p.nearbyPlayers.find(pl => pl.isBot && pl.name === j.target)
          if (t) return { type: 'debate_initiate', targetAgent: t.name, topic: (j.topic || '').slice(0, 50), opener: (j.opener || '').slice(0, 70) }
          return { type: 'wander', target: this.pickTarget() }
        }
        case 'predict':
          this.currentPrediction = (j.prediction || '').slice(0, 200)
          this.addMemory('prediction', this.currentPrediction, 4)
          return { type: 'update_prediction', prediction: this.currentPrediction }
        case 'signboard':
          return { type: 'post_signboard', text: (j.text || '').slice(0, 200), x: p.self.x, y: p.self.y }
        default:
          return { type: 'idle' }
      }
    } catch {
      return { type: 'idle' }
    }
  }

  private async generateDebateReply(debate: ActiveDebate, p: Perception): Promise<AgentAction> {
    const history = debate.exchanges.map(e => `${e.speaker}: ${e.message}`).join('\n')
    const isLast = debate.exchangeCount >= 3

    // 制約付きペルソナ（馴れ合い防止）
    const constraint = this.personality.debateRole === 'conservative'
      ? '相手の主張に対し、データに現れないリスク・マイナス要素を必ず1つ指摘せよ。安易に同意するな。'
      : this.personality.debateRole === 'intuitive'
        ? '統計が低くても大穴の根拠を提示せよ。本命党に流されるな。'
        : `${this.personality.debateStyle}。安易に同意するな。`

    const raceLine = p.raceSummary ? `\nレース: ${p.raceSummary}` : ''

    const prompt = `あなたは「${this.personality.name}」（${this.personality.role}）。${this.personality.speakingStyle}
「${debate.topic}」について${debate.partner}と議論中:
${history}${raceLine}

制約: ${constraint}
${isLast ? 'これが最後。結論をまとめよ。' : ''}あなたの番。50文字以内で返答のみ。挨拶不要。JSONなし。`

    try {
      const res = await this.gemini.generate(prompt, 70, this.personality.temperature)
      const reply = res.text.replace(/["""{}]/g, '').trim().slice(0, 50)
      this.addMemory('debate', `${debate.partner}と: ${reply}`, 4)
      return { type: 'debate_reply', debateId: debate.debateId, message: reply }
    } catch {
      return { type: 'debate_reply', debateId: debate.debateId, message: this.fallbackDebateReply(debate).type === 'debate_reply' ? (this.fallbackDebateReply(debate) as any).message : '考え直す' }
    }
  }

  private pickTarget() {
    const a = AREAS[Math.floor(Math.random() * AREAS.length)]
    return { x: a.x + randInt(-20, 20), y: a.y + randInt(-20, 20), label: a.label }
  }

  addMemory(type: MemoryEntry['type'], content: string, importance: number) {
    this.memory.push({ tick: this.tickCount, timestamp: Date.now(), type, content, importance })
    if (this.memory.length > MAX_MEMORY_ENTRIES) {
      this.memory.sort((a, b) => b.importance - a.importance || b.tick - a.tick)
      this.memory = this.memory.slice(0, MAX_MEMORY_ENTRIES)
    }
  }
}

function randInt(a: number, b: number) { return Math.floor(Math.random() * (b - a + 1)) + a }
