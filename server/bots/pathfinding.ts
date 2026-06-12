import fs from 'fs'
import path from 'path'

const GRID_CELL = 16

function pointInPolygon(px: number, py: number, poly: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export class CollisionGrid {
  cols: number
  rows: number
  blocked: Uint8Array

  constructor(mapW: number, mapH: number) {
    this.cols = Math.ceil(mapW / GRID_CELL)
    this.rows = Math.ceil(mapH / GRID_CELL)
    this.blocked = new Uint8Array(this.cols * this.rows)
  }

  mark(gx: number, gy: number) {
    if (gx >= 0 && gx < this.cols && gy >= 0 && gy < this.rows)
      this.blocked[gy * this.cols + gx] = 1
  }

  isBlocked(gx: number, gy: number): boolean {
    if (gx < 0 || gx >= this.cols || gy < 0 || gy >= this.rows) return true
    return this.blocked[gy * this.cols + gx] === 1
  }

  markRect(x: number, y: number, w: number, h: number) {
    const x0 = Math.floor(x / GRID_CELL), y0 = Math.floor(y / GRID_CELL)
    const x1 = Math.ceil((x + w) / GRID_CELL), y1 = Math.ceil((y + h) / GRID_CELL)
    for (let gy = y0; gy < y1; gy++)
      for (let gx = x0; gx < x1; gx++) this.mark(gx, gy)
  }

  markPolygon(ox: number, oy: number, points: { x: number; y: number }[]) {
    const pts = points.map(p => ({ x: ox + p.x, y: oy + p.y }))
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of pts) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y
    }
    const gx0 = Math.floor(minX / GRID_CELL), gy0 = Math.floor(minY / GRID_CELL)
    const gx1 = Math.ceil(maxX / GRID_CELL), gy1 = Math.ceil(maxY / GRID_CELL)
    for (let gy = gy0; gy <= gy1; gy++)
      for (let gx = gx0; gx <= gx1; gx++) {
        const cx = gx * GRID_CELL + GRID_CELL / 2
        const cy = gy * GRID_CELL + GRID_CELL / 2
        if (pointInPolygon(cx, cy, pts)) this.mark(gx, gy)
      }
  }

  nearestOpen(gx: number, gy: number): { x: number; y: number } | null {
    for (let r = 1; r < 30; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
          if (!this.isBlocked(gx + dx, gy + dy)) return { x: gx + dx, y: gy + dy }
        }
    return null
  }

  findPath(sx: number, sy: number, tx: number, ty: number): { x: number; y: number }[] | null {
    const sgx = Math.round(sx / GRID_CELL), sgy = Math.round(sy / GRID_CELL)
    const tgx = Math.round(tx / GRID_CELL), tgy = Math.round(ty / GRID_CELL)

    const goal = this.isBlocked(tgx, tgy) ? this.nearestOpen(tgx, tgy) : { x: tgx, y: tgy }
    if (!goal) return null
    const start = this.isBlocked(sgx, sgy) ? this.nearestOpen(sgx, sgy) : { x: sgx, y: sgy }
    if (!start) return null

    const key = (x: number, y: number) => y * this.cols + x
    const gScore = new Map<number, number>()
    const fScore = new Map<number, number>()
    const cameFrom = new Map<number, number>()
    const openSet = new Set<number>()
    const closedSet = new Set<number>()

    const h = (x: number, y: number) => Math.abs(x - goal.x) + Math.abs(y - goal.y)
    const sk = key(start.x, start.y)
    gScore.set(sk, 0)
    fScore.set(sk, h(start.x, start.y))
    openSet.add(sk)

    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]

    for (let iter = 0; iter < 10000; iter++) {
      if (openSet.size === 0) return null

      let bestK = -1, bestF = Infinity
      for (const k of openSet) {
        const f = fScore.get(k)!
        if (f < bestF) { bestF = f; bestK = k }
      }

      const cx = bestK % this.cols, cy = Math.floor(bestK / this.cols)

      if (cx === goal.x && cy === goal.y) {
        const trail: { x: number; y: number }[] = []
        let cur: number | undefined = bestK
        while (cur !== undefined) {
          trail.unshift({ x: (cur % this.cols) * GRID_CELL, y: Math.floor(cur / this.cols) * GRID_CELL })
          cur = cameFrom.get(cur)
        }
        return simplifyPath(trail)
      }

      openSet.delete(bestK)
      closedSet.add(bestK)

      for (const [dx, dy] of dirs) {
        const nx = cx + dx, ny = cy + dy
        if (this.isBlocked(nx, ny)) continue
        if (dx !== 0 && dy !== 0) {
          if (this.isBlocked(cx + dx, cy) || this.isBlocked(cx, cy + dy)) continue
        }
        const nk = key(nx, ny)
        if (closedSet.has(nk)) continue
        const ng = gScore.get(bestK)! + (dx !== 0 && dy !== 0 ? 1.414 : 1)
        if (ng < (gScore.get(nk) ?? Infinity)) {
          cameFrom.set(nk, bestK)
          gScore.set(nk, ng)
          fScore.set(nk, ng + h(nx, ny))
          openSet.add(nk)
        }
      }
    }
    return null
  }
}

function simplifyPath(p: { x: number; y: number }[]): { x: number; y: number }[] {
  if (p.length <= 2) return p
  const result = [p[0]]
  for (let i = 1; i < p.length - 1; i++) {
    const prev = result[result.length - 1], cur = p[i], next = p[i + 1]
    if (cur.x - prev.x !== next.x - cur.x || cur.y - prev.y !== next.y - cur.y) result.push(cur)
  }
  result.push(p[p.length - 1])
  return result
}

export function loadCollisionGrid(): CollisionGrid {
  const collisionPath = path.join(__dirname, '../../client/public/assets/collision.json')
  const MAP_W = 1672, MAP_H = 941
  const grid = new CollisionGrid(MAP_W, MAP_H)

  const W = 32
  grid.markRect(0, 0, MAP_W, W)
  grid.markRect(0, MAP_H - W, MAP_W, W)
  grid.markRect(0, 0, W, MAP_H)
  grid.markRect(MAP_W - W, 0, W, MAP_H)

  if (!fs.existsSync(collisionPath)) return grid

  const data = JSON.parse(fs.readFileSync(collisionPath, 'utf-8'))
  let offsetX = 0, offsetY = 0
  const imgLayer = data.layers?.find((l: any) => l.type === 'imagelayer')
  if (imgLayer) { offsetX = imgLayer.offsetx ?? 0; offsetY = imgLayer.offsety ?? 0 }

  let rects = 0, polys = 0
  for (const layer of (data.layers || [])) {
    if (!layer.objects) continue
    for (const obj of layer.objects) {
      const ax = obj.x - offsetX, ay = obj.y - offsetY
      if (obj.polygon) { grid.markPolygon(ax, ay, obj.polygon); polys++ }
      else if (obj.width && obj.height && !obj.polyline && !obj.ellipse && !obj.point) {
        grid.markRect(ax, ay, obj.width, obj.height); rects++
      }
    }
  }

  let blocked = 0
  for (let i = 0; i < grid.blocked.length; i++) if (grid.blocked[i]) blocked++
  console.log(`[Pathfind] ${grid.cols}x${grid.rows} grid, ${rects} rects + ${polys} polys, ${blocked} blocked cells`)
  return grid
}
