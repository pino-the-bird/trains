// The map of the whole railway (29 Oct, with every line running at once): Britain's coast, every line he has, its
// stations, and every train on it where it is now, moving. Drag to move it, scroll or pinch to come closer, tap a train
// to ride it. Drawn flat, the way a signal box diagram is, in Pino's colours.

import { toXZ, clamp } from './geo.js'
import { hhmm } from './railway.js'

const COLOURS = { dmu: '#2fd1ff', express: '#f4f2ee', freight: '#f0c44d', steam: '#e14a89' }

export class NetMap {
  constructor(el, { network, rail, onPick, onClose }) {
    this.el = el
    this.network = network
    this.rail = rail
    this.onPick = onPick
    this.onClose = onClose
    this.open = false
    this.coast = null
    // every line's path and stops in the frame, and the km along it of each point, to put a train where it is
    this.lines = network.lines.map((l) => ({ slug: l.slug, name: l.name, pts: l.path.map(([lat, lon, km]) => { const [x, z] = toXZ(lat, lon); return { x, z, s: km * 1000 } }) }))
    this.byslug = new Map(this.lines.map((l) => [l.slug, l]))
    el.innerHTML = '<canvas></canvas><div class="maphead"><b>the railway</b> <span class="mapclock"></span><button class="mapclose">close</button></div><div class="maptip">drag to move, scroll or pinch to zoom, tap a train to ride it</div>'
    this.cv = el.querySelector('canvas')
    this.g = this.cv.getContext('2d')
    el.querySelector('.mapclose').onclick = () => { this.hide(); this.onClose?.() }
    fetch('./coast.json').then((r) => (r.ok ? r.json() : null)).then((c) => { if (c) { this.coast = c.rings.map((ring) => ring.map(([lat, lon]) => toXZ(lat, lon))); this.draw(this.follow) } }).catch(() => {})
    this.fit()
    this.wire()
  }
  /** The whole railway in view. */
  fit() {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const l of this.lines) for (const p of l.pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z) }
    this.cx = (x0 + x1) / 2; this.cz = (z0 + z1) / 2
    this.span = Math.max(x1 - x0, z1 - z0) * 1.15 + 20000
  }
  toggle(follow) { this.open ? this.hide() : this.show(follow) }
  show(follow) { this.open = true; this.el.style.display = 'block'; this.follow = follow; this.resize(); this.draw(follow) }
  hide() { this.open = false; this.el.style.display = 'none' }
  resize() { const r = this.el.getBoundingClientRect(), d = Math.min(2, devicePixelRatio); this.cv.width = Math.round(r.width * d); this.cv.height = Math.round(r.height * d); this.dpr = d }
  get scale() { return Math.min(this.cv.width, this.cv.height) / this.span }
  sx(x) { return this.cv.width / 2 + (x - this.cx) * this.scale }
  sy(z) { return this.cv.height / 2 + (z - this.cz) * this.scale }
  at(slug, s) {
    const l = this.byslug.get(slug); if (!l) return null
    const P = l.pts; let lo = 0, hi = P.length - 1
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].s <= s) lo = m; else hi = m }
    const a = P[lo], b = P[hi], t = clamp((s - a.s) / ((b.s - a.s) || 1), 0, 1)
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
  }
  draw(follow) {
    if (!this.open) return
    this.follow = follow
    const g = this.g, W = this.cv.width, H = this.cv.height, d = this.dpr || 1
    g.fillStyle = '#0b0b0d'; g.fillRect(0, 0, W, H)
    // the land
    if (this.coast) {
      g.fillStyle = '#17181c'; g.strokeStyle = '#3a3a40'; g.lineWidth = 1 * d
      for (const ring of this.coast) { g.beginPath(); ring.forEach(([x, z], k) => (k ? g.lineTo(this.sx(x), this.sy(z)) : g.moveTo(this.sx(x), this.sy(z)))); g.closePath(); g.fill(); g.stroke() }
    }
    // the lines and their stations
    const zoom = this.scale * 1000   // pixels a kilometre
    for (const l of this.lines) {
      g.strokeStyle = follow?.line.slug === l.slug ? '#f4f2ee' : '#8d8a84'; g.lineWidth = (follow?.line.slug === l.slug ? 3 : 2) * d
      g.beginPath(); l.pts.forEach((p, k) => (k ? g.lineTo(this.sx(p.x), this.sy(p.z)) : g.moveTo(this.sx(p.x), this.sy(p.z)))); g.stroke()
    }
    g.font = `${11 * d}px ui-monospace, Menlo, monospace`
    for (const nl of this.network.lines) {
      for (const st of nl.stops) {
        const p = this.at(nl.slug, st.km * 1000); if (!p) continue
        const r = (zoom > 3 ? 2 : 1) * d
        g.fillStyle = '#a7cd07'; g.fillRect(this.sx(p.x) - r, this.sy(p.z) - r, r * 2, r * 2)
        if (zoom > 6) { g.fillStyle = '#c9c6bf'; g.fillText(st.name, this.sx(p.x) + 6 * d, this.sy(p.z) - 4 * d) }
      }
      // the line's name at its middle when the whole railway is in view
      if (zoom <= 6) { const p = this.at(nl.slug, nl.lengthKm * 500); if (p) { g.fillStyle = '#f4f2ee'; g.fillText(nl.name, this.sx(p.x) + 8 * d, this.sy(p.z)) } }
    }
    // the trains, where they are now
    this.dots = []
    let running = 0
    for (const u of this.rail.units) {
      if (u.phase === 'stabled') continue
      running++
      const p = this.at(u.line.slug, u.s - u.dir * u.len / 2); if (!p) continue
      const x = this.sx(p.x), y = this.sy(p.z)
      this.dots.push({ x, y, u })
      g.fillStyle = COLOURS[u.kind] || '#2fd1ff'
      g.beginPath(); g.arc(x, y, (u === follow ? 6 : 4) * d, 0, Math.PI * 2); g.fill()
      if (u === follow) { g.strokeStyle = '#e14a89'; g.lineWidth = 3 * d; g.beginPath(); g.arc(x, y, 11 * d, 0, Math.PI * 2); g.stroke() }
      if (zoom > 3 || u === follow) { g.fillStyle = '#f4f2ee'; g.fillText(`${u.headcode}${u.late > 90 ? ` +${Math.round(u.late / 60)}` : ''}`, x + 8 * d, y + 12 * d) }
    }
    this.el.querySelector('.mapclock').textContent = `${hhmm(this.rail.clock)}, ${running} trains running`
  }
  wire() {
    const cv = this.cv
    const pointers = new Map()
    let moved = 0, pinch = null
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), span: this.span } } })
    cv.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId); if (!p) return
      const dx = e.clientX - p.x, dy = e.clientY - p.y
      p.x = e.clientX; p.y = e.clientY
      if (pointers.size === 2 && pinch) { const [a, b] = [...pointers.values()]; this.span = clamp(pinch.span * pinch.d / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), 4000, 1500000) }
      else { moved += Math.abs(dx) + Math.abs(dy); this.cx -= (dx * this.dpr) / this.scale; this.cz -= (dy * this.dpr) / this.scale }
      this.draw(this.follow)
    })
    const up = (e) => {
      const was = pointers.has(e.pointerId)
      pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null
      if (!was || moved > 6 || pointers.size) return
      // a tap: the nearest train within reach
      const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * this.dpr, y = (e.clientY - r.top) * this.dpr
      let best = null, bd = 22 * this.dpr
      for (const dot of this.dots || []) { const dd = Math.hypot(dot.x - x, dot.y - y); if (dd < bd) { bd = dd; best = dot.u } }
      if (best) this.onPick?.(best)
    }
    cv.addEventListener('pointerup', up)
    cv.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); pinch = null })
    cv.addEventListener('wheel', (e) => {
      e.preventDefault()
      const r = cv.getBoundingClientRect(), mx = (e.clientX - r.left) * this.dpr, my = (e.clientY - r.top) * this.dpr
      const wx = this.cx + (mx - this.cv.width / 2) / this.scale, wz = this.cz + (my - this.cv.height / 2) / this.scale
      this.span = clamp(this.span * Math.exp(e.deltaY * 0.0015), 4000, 1500000)
      this.cx = wx - (mx - this.cv.width / 2) / this.scale; this.cz = wz - (my - this.cv.height / 2) / this.scale
      this.draw(this.follow)
    }, { passive: false })
    addEventListener('resize', () => { if (this.open) { this.resize(); this.draw(this.follow) } })
  }
}
