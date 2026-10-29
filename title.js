// A title screen with a map of every line (his to add, 29 Oct): what you see first. The title, every line he has on a
// map of Britain in his colours, a card for the one picked (a photograph from along it, how long it is, its stations,
// how often he has run it and the last thing he said about it), the hour to set off at, and depart. It opens on the
// line he ran last, with that line running behind it. A link to a line goes straight in, past it.

import { toXZ } from './geo.js'

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export class Title {
  /** el: the overlay. lines: the network's lines. pick: the slug it opens on. hours: [[label, hour]]. onDepart({ slug, hour }). */
  constructor(el, { lines, pick, hours, now = true, onDepart }) {
    this.el = el
    this.lines = lines
    this.pick = pick
    this.hour = now ? 'now' : hours[2]?.[1]
    this.onDepart = onDepart
    this.paths = lines.map((l) => ({ slug: l.slug, pts: (l.path || []).map(([lat, lon]) => toXZ(lat, lon)) }))
    el.innerHTML = `
      <div class="tl-head"><h1>Pino's train simulator</h1><p>Real railway lines across Britain, built by Pino on the cafe computer.</p></div>
      <div class="tl-body">
        <div class="tl-mapwrap"><canvas class="tl-map"></canvas><div class="tl-hint">Tap a line to pick it.</div></div>
        <div class="tl-side">
          <div class="tl-card"></div>
          <div class="tl-hours">${now ? '<button data-h="now">now</button>' : ''}${hours.map(([label, h]) => `<button data-h="${h}">${label}</button>`).join('')}</div>
          <button class="tl-go">depart</button>
          <div class="tl-list">${lines.map((l) => `<button data-slug="${esc(l.slug)}">${esc(l.name)}</button>`).join('')}</div>
        </div>
      </div>`
    this.cv = el.querySelector('.tl-map')
    for (const b of el.querySelectorAll('.tl-hours button')) b.onclick = () => { this.hour = b.dataset.h === 'now' ? 'now' : Number(b.dataset.h); this.paint() }
    for (const b of el.querySelectorAll('.tl-list button')) b.onclick = () => { this.pick = b.dataset.slug; this.paint() }
    el.querySelector('.tl-go').onclick = () => { this.hide(); this.onDepart({ slug: this.pick, hour: this.hour }) }
    this.cv.addEventListener('click', (e) => this.tap(e))
    fetch('./coast.json').then((r) => (r.ok ? r.json() : null)).then((c) => { if (c) { this.coast = c.rings.map((ring) => ring.map(([lat, lon]) => toXZ(lat, lon))); this.draw() } }).catch(() => {})
    addEventListener('resize', () => { if (this.open) this.draw() })
  }
  show() { this.open = true; this.el.style.display = 'flex'; this.paint() }
  hide() { this.open = false; this.el.style.display = 'none' }
  paint() {
    const l = this.lines.find((x) => x.slug === this.pick) || this.lines[0]
    if (!l) return
    this.pick = l.slug
    const stations = (l.stops || []).length
    const ph = l.photo
    this.el.querySelector('.tl-card').innerHTML = `
      ${ph ? `<img src="${esc(ph.thumb)}" alt="${esc(ph.title)}"><div class="tl-credit">${esc(ph.title)}, photo by <a href="${esc(ph.page)}" target="_blank" rel="noopener">${esc(ph.author)}</a>, ${esc(ph.licence)}</div>` : ''}
      <h2>${esc(l.name)}</h2>
      <p>${esc(l.from)} to ${esc(l.to)}. ${Math.round(l.lengthKm / 1.609)} miles, ${stations} stations.</p>
      ${l.runs ? `<p class="tl-dim">Pino has run it ${l.runs} ${l.runs === 1 ? 'time' : 'times'}.</p>` : '<p class="tl-dim">Pino has not run it yet.</p>'}
      ${l.note ? `<p class="tl-note">"${esc(l.note)}"<br><span class="tl-dim">Pino</span></p>` : ''}`
    for (const b of this.el.querySelectorAll('.tl-hours button')) b.classList.toggle('on', (b.dataset.h === 'now' ? 'now' : Number(b.dataset.h)) === this.hour)
    for (const b of this.el.querySelectorAll('.tl-list button')) b.classList.toggle('on', b.dataset.slug === this.pick)
    this.draw()
  }
  /** The map: the coast, every line, the one picked brighter, its ends named. */
  draw() {
    const cv = this.cv, r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio)
    if (!r.width) return
    cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d)
    const g = cv.getContext('2d')
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const p of this.paths) for (const [x, z] of p.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z) }
    // (Britain round the lines, with room)
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, span = Math.max(x1 - x0, (z1 - z0) * cv.width / cv.height) * 1.2 + 40000
    const k = cv.width / span
    this.view = { cx, cz, k, W: cv.width, H: cv.height, d }
    const sx = (x) => cv.width / 2 + (x - cx) * k, sy = (z) => cv.height / 2 + (z - cz) * k
    g.fillStyle = '#0b0b0d'; g.fillRect(0, 0, cv.width, cv.height)
    if (this.coast) {
      g.fillStyle = '#17181c'; g.strokeStyle = '#3a3a40'; g.lineWidth = d
      for (const ring of this.coast) { g.beginPath(); ring.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sy(z)) : g.moveTo(sx(x), sy(z)))); g.closePath(); g.fill(); g.stroke() }
    }
    for (const p of this.paths) {
      const on = p.slug === this.pick
      g.strokeStyle = on ? '#e14a89' : '#a7cd07'; g.lineWidth = (on ? 5 : 2.5) * d; g.lineCap = 'round'; g.lineJoin = 'round'
      g.beginPath(); p.pts.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sy(z)) : g.moveTo(sx(x), sy(z)))); g.stroke()
    }
    const l = this.lines.find((x) => x.slug === this.pick), p = this.paths.find((x) => x.slug === this.pick)
    if (l && p?.pts.length) {
      g.font = `bold ${12 * d}px ui-monospace, Menlo, monospace`; g.fillStyle = '#f4f2ee'
      for (const [[x, z], name] of [[p.pts[0], l.from], [p.pts[p.pts.length - 1], l.to]]) { g.beginPath(); g.arc(sx(x), sy(z), 4 * d, 0, Math.PI * 2); g.fill(); g.fillText(name, sx(x) + 8 * d, sy(z) + 4 * d) }
    }
  }
  tap(e) {
    const v = this.view; if (!v) return
    const r = this.cv.getBoundingClientRect(), mx = (e.clientX - r.left) * v.d, my = (e.clientY - r.top) * v.d
    let best = null, bd = 30 * v.d
    for (const p of this.paths) for (const [x, z] of p.pts) { const dd = Math.hypot(v.W / 2 + (x - v.cx) * v.k - mx, v.H / 2 + (z - v.cz) * v.k - my); if (dd < bd) { bd = dd; best = p.slug } }
    if (best) { this.pick = best; this.paint() }
  }
}

/** The line he ran last, from the network's record of his runs, or null. */
export function lastRun(lines) {
  let best = null
  for (const l of lines) if (l.lastAt && (!best || l.lastAt > best.lastAt)) best = l
  return best?.slug || null
}
