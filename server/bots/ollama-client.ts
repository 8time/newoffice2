import http from 'http'

export interface LLMResponse {
  text: string
  tokenCount: number
}

export class OllamaClient {
  private model: string
  private host: string
  private port: number
  totalRequests = 0
  totalTokens = 0
  quotaExhausted = false

  constructor(opts?: { model?: string; host?: string; port?: number }) {
    this.model = opts?.model || process.env.OLLAMA_MODEL || 'gemma3:12b'
    this.host = opts?.host || process.env.OLLAMA_HOST || 'localhost'
    this.port = opts?.port || Number(process.env.OLLAMA_PORT) || 11434
  }

  async generate(prompt: string, maxTokens = 200, temperature = 0.7): Promise<LLMResponse> {
    const body = JSON.stringify({
      model: this.model,
      prompt,
      stream: false,
      options: { num_predict: maxTokens, temperature },
    })

    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.host,
        port: this.port,
        path: '/api/generate',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }

      const req = http.request(options, (res) => {
        let data = ''
        res.on('data', (chunk: string) => (data += chunk))
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`Ollama ${res.statusCode}: ${data.slice(0, 200)}`))
          }
          try {
            const parsed = JSON.parse(data)
            const text = (parsed.response || '').trim()
            const tokenCount = parsed.eval_count || 0
            this.totalRequests++
            this.totalTokens += tokenCount
            if (this.totalRequests % 5 === 1) {
              console.log(`[Ollama] requests=${this.totalRequests} tokens=${this.totalTokens}`)
            }
            resolve({ text, tokenCount })
          } catch (e) {
            reject(new Error(`Ollama parse error: ${(e as Error).message}`))
          }
        })
      })
      req.on('error', (err) => reject(new Error(`Ollama connection error: ${err.message} (is Ollama running?)`)))
      req.setTimeout(60000, () => { req.destroy(); reject(new Error('Ollama timeout')) })
      req.write(body)
      req.end()
    })
  }

  getStats() {
    return { totalRequests: this.totalRequests, totalTokens: this.totalTokens, queueLength: 0 }
  }
}
