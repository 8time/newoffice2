import https from 'https'
import { GEMINI_STAGGER_MS } from './types'

export interface GeminiResponse {
  text: string
  tokenCount: number
}

interface QueueEntry {
  resolve: (v: GeminiResponse) => void
  reject: (e: Error) => void
  prompt: string
  maxTokens: number
  temperature: number
}

export class GeminiClient {
  private apiKey: string
  private model: string
  private queue: QueueEntry[] = []
  private processing = false
  private lastRequestTime = 0
  private minIntervalMs: number
  totalRequests = 0
  totalTokens = 0
  quotaExhausted = false
  private consecutiveFailures = 0

  constructor(apiKey: string, opts?: { model?: string; minIntervalMs?: number }) {
    this.apiKey = apiKey
    this.model = opts?.model || 'gemini-2.0-flash-lite'
    this.minIntervalMs = opts?.minIntervalMs || 6000
  }

  async generate(prompt: string, maxTokens = 200, temperature = 0.7): Promise<GeminiResponse> {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject, prompt, maxTokens, temperature })
      this.processQueue()
    })
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return
    this.processing = true

    while (this.queue.length > 0) {
      const elapsed = Date.now() - this.lastRequestTime
      if (elapsed < this.minIntervalMs) {
        await sleep(this.minIntervalMs - elapsed)
      }

      const req = this.queue.shift()!
      this.lastRequestTime = Date.now()

      try {
        const result = await this.callApi(req.prompt, req.maxTokens, req.temperature)
        this.totalRequests++
        this.totalTokens += result.tokenCount
        this.consecutiveFailures = 0
        this.quotaExhausted = false
        if (this.totalRequests % 5 === 1) console.log(`[Gemini] requests=${this.totalRequests} tokens=${this.totalTokens} queue=${this.queue.length}`)
        req.resolve(result)
      } catch (err: any) {
        this.consecutiveFailures++
        if (err.message?.includes('429') || err.message?.includes('quota')) {
          if (this.consecutiveFailures >= 3) {
            this.quotaExhausted = true
            console.warn(`[Gemini] Quota exhausted after ${this.consecutiveFailures} failures. Switching to fallback mode.`)
            // Drain remaining queue with rejections
            req.reject(err)
            while (this.queue.length > 0) this.queue.shift()!.reject(err)
            break
          }
          const backoff = 30000 + Math.random() * 30000
          console.warn(`[Gemini] 429 (${this.consecutiveFailures}/3), backing off ${Math.round(backoff / 1000)}s`)
          await sleep(backoff)
          this.queue.unshift(req)
        } else {
          console.error(`[Gemini] Error: ${err.message?.slice(0, 150)}`)
          req.reject(err)
        }
      }
    }

    this.processing = false
  }

  private callApi(prompt: string, maxTokens: number, temperature: number): Promise<GeminiResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    })

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url)
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }

      const req = https.request(options, (res) => {
        let data = ''
        res.on('data', (chunk: string) => (data += chunk))
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`Gemini ${res.statusCode}: ${data.slice(0, 200)}`))
          }
          try {
            const parsed = JSON.parse(data)
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || ''
            const tokenCount = parsed.usageMetadata?.totalTokenCount || 0
            resolve({ text: text.trim(), tokenCount })
          } catch (e) {
            reject(new Error(`Gemini parse error: ${(e as Error).message}`))
          }
        })
      })
      req.on('error', reject)
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Gemini timeout')) })
      req.write(body)
      req.end()
    })
  }

  getStats() {
    return { totalRequests: this.totalRequests, totalTokens: this.totalTokens, queueLength: this.queue.length }
  }
}

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)) }
