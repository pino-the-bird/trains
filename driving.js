// Two things he can add for whoever drives (29 Oct): signals you drive by, and a timetable to keep.
//
// Signals: a signal at every station and every two and a half kilometres between, each for one way, on the left of
// the line it works as they are in Britain, and each showing what is really ahead of it: red with a train in the
// section, one yellow before a red, two before that, green with the road clear. They are worked from the trains on the
// line (railway.js), so the train in front of you turns them red. The speed the line can be taken at, from how sharply
// it curves, on boards at the side. Driving, the horn sounds coming up to a caution and it is yours to say you have
// seen it (A, or the button), or the brakes go on; a red passed stops the train.
//
// A timetable to keep: the train you drive has its times (its trip's, railway.js), stations have boards with what
// leaves next, the guard rings twice when it is time to go, and at the end of the run you get how it went, to keep.

import * as THREE from 'three'
import { clamp } from './geo.js'
import { solid, textCanvas } from './draw.js'
import { hhmm } from './railway.js'

const BLOCK = 2500
const RED = 0xff2a2a, YELLOW = 0xffc23a, GREEN = 0x25d04d, OFF = 0x1c1c20

/** A line's signals, each way: [{ s, dir }], at the end of every platform going out and every BLOCK between. */
export function signalsOf(line) {
  const out = []
  for (const dir of [1, -1]) {
    const at = []
    for (const st of line.stops) { const s = st.s + dir * 90; if (s > 60 && s < line.length - 60) at.push(s) }
    const sorted = at.sort((a, b) => a - b)
    const all = [...sorted]
    // and between them, so no section is longer than a block
    const ends = [60, ...sorted, line.length - 60]
    for (let k = 1; k < ends.length; k++) { const gap = ends[k] - ends[k - 1], n = Math.floor(gap / BLOCK); for (let j = 1; j <= n; j++) all.push(ends[k - 1] + (gap * j) / (n + 1)) }
    for (const s of all.sort((a, b) => a - b)) out.push({ s, dir, aspect: GREEN, lamps: null })
  }
  return out
}

/**
 * The speed a line can be taken at, every 100 m, from how sharply it curves (a curve of radius r at about the square
 * root of 0.8 r metres a second, no faster than the line), in steps of 5 mph, and held for 400 m either side so it
 * reads as a limit and not a wobble. Returns a Float32Array of metres a second, one for every 100 m.
 */
export function limitsOf(line) {
  const n = Math.ceil(line.length / 100) + 1, raw = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const s = clamp(i * 100, 30, line.length - 30)
    const [ax, az] = line.tangent(s - 30), [bx, bz] = line.tangent(s + 30)
    const k = Math.abs(ax * bz - az * bx) / 60
    const v = k > 1e-6 ? Math.sqrt(0.8 / k) : Infinity
    const mph = Math.min(line.speed * 2.23694, Math.floor((v * 2.23694) / 5) * 5)
    raw[i] = Math.max(15, mph) / 2.23694
  }
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) { let m = Infinity; for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) m = Math.min(m, raw[j]); out[i] = m }
  return out
}

export class Signals {
  constructor(near, ctx) { this.near = near; this.ctx = ctx; this.lines = new Map() }
  /** A line's signals and limits, and the posts and boards for it, built as the camera comes near. */
  add(line) {
    if (this.lines.has(line.slug)) return
    const sigs = signalsOf(line), lim = limitsOf(line)
    this.lines.set(line.slug, { line, sigs, lim })
    for (const sg of sigs) {
      const [x, z] = line.centre(sg.s)
      this.near.add({ kind: 'signal', x, z, reach: 2500, build: () => this.post(line, sg) })
    }
    // a board where the limit drops, before the curve that needs it
    for (let i = 1; i < lim.length; i++) {
      if (lim[i] >= lim[i - 1] - 0.5) continue
      for (const dir of [1, -1]) {
        const s = dir > 0 ? i * 100 - 300 : i * 100 + 300
        if (s < 60 || s > line.length - 60) continue
        const mph = Math.round(Math.min(lim[i], lim[i - 1]) * 2.23694)
        const [x, z] = line.centre(s)
        this.near.add({ kind: 'limit', x, z, reach: 1800, build: () => this.board(line, s, dir, mph) })
      }
    }
  }
  post(line, sg) {
    const g = new THREE.Group()
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4.6, 0.18), solid(0x8d8a84)); post.position.y = 2.3; g.add(post)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.9, 0.3), solid(0x15151a)); head.position.y = 4.7; g.add(head)
    sg.lamps = [0.6, 0.15, -0.3, -0.75].map((dy, k) => { const l = new THREE.Mesh(new THREE.CircleGeometry(0.15, 10), new THREE.MeshBasicMaterial({ color: OFF })); l.position.set(0, 4.7 + dy * 0.9, 0.16); g.add(l); l.userData.k = k; return l })
    // (on the left of the line it works, facing the trains coming)
    line.placeAlong(g, sg.s, sg.dir * (1.7 * line.twoAt(sg.s) + 2.9), 0)
    if (sg.dir < 0) g.rotateY(Math.PI)
    g.rotateY(Math.PI)
    this.paint(sg)
    return g
  }
  board(line, s, dir, mph) {
    const g = new THREE.Group()
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2, 0.12), solid(0x8d8a84)); post.position.y = 1; g.add(post)
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8), new THREE.MeshBasicMaterial({ map: textCanvas([String(mph)], { w: 256, h: 192, size: 120, box: true, accent: '#f4f2ee' }) }))
    face.position.y = 2.3; g.add(face)
    line.placeAlong(g, s, dir * (1.7 * line.twoAt(s) + 2.6), 0)
    g.rotateY(dir > 0 ? Math.PI : 0)
    return g
  }
  paint(sg) {
    if (!sg.lamps || sg.lamps[0].userData.gone) return
    // top yellow (double), green, yellow, red, as a four-aspect head reads top to bottom
    const lit = sg.aspect === GREEN ? [1] : sg.aspect === YELLOW ? [2] : sg.aspect === 'YY' ? [0, 2] : [3]
    sg.lamps.forEach((l, k) => l.material.color.set(lit.includes(k) ? (k === 3 ? RED : k === 1 ? GREEN : YELLOW) : OFF))
  }
  /** Every signal on the lines in, set from the trains on them: what is in the section ahead of each. */
  step(units) {
    for (const { line, sigs } of this.lines.values()) {
      const on = units.filter((u) => u.line.slug === line.slug && u.phase !== 'stabled')
      for (const dir of [1, -1]) {
        const mine = sigs.filter((x) => x.dir === dir)
        if (dir < 0) mine.reverse()
        // walk from the far end back, so each knows what the next shows
        let next = null, after = null
        for (let k = mine.length - 1; k >= 0; k--) {
          const sg = mine[k], end = next ? next.s : dir > 0 ? line.length : 0
          const lo = Math.min(sg.s, end), hi = Math.max(sg.s, end)
          // a train in the section going this way, or anything at all where there is one track
          const held = on.some((u) => { const a = Math.min(u.s, u.s - u.dir * u.len), b = Math.max(u.s, u.s - u.dir * u.len); return a < hi && b > lo && (u.dir === dir || line.twoAt((lo + hi) / 2) < 0.5) })
          const aspect = held ? RED : !next ? YELLOW : next.aspect === RED ? YELLOW : next.aspect === YELLOW ? 'YY' : GREEN
          if (sg.aspect !== aspect) { sg.aspect = aspect; this.paint(sg) }
          after = next; next = sg
        }
      }
    }
  }
  /** For the train you are with: the next signal ahead, the limit here and the one ahead. */
  ahead(u) {
    const e = this.lines.get(u.line.slug)
    if (!e) return null
    const nx = e.sigs.filter((x) => x.dir === u.dir && (x.s - u.s) * u.dir > 0).sort((a, b) => (a.s - b.s) * u.dir)[0] || null
    const i = clamp(Math.round(u.s / 100), 0, e.lim.length - 1), j = clamp(Math.round((u.s + u.dir * 600) / 100), 0, e.lim.length - 1)
    return { signal: nx, dist: nx ? Math.abs(nx.s - u.s) : Infinity, limit: e.lim[i], next: e.lim[j] }
  }
  static isCaution(a) { return a === YELLOW || a === 'YY' }
  static isRed(a) { return a === RED }
}

/**
 * The duty of whoever drives: the train's times and how close they are kept, the warning horn and the red, the limits,
 * the stops on the mark, and the card at the end. sound: { horn, bell, say } (sim.js's), or nulls.
 */
export class Duty {
  constructor({ signals, timetable, sound }) {
    this.signals = signals; this.timetable = timetable; this.sound = sound
    this.reset()
  }
  reset() { this.aws = null; this.acked = false; this.spad = 0; this.awsMissed = 0; this.over = 0; this.late = []; this.early = 0; this.marks = []; this.stops = 0; this.lastSig = null; this.msg = null; this.stopped = false; this.rightAway = false; this.km = 0 }
  /** Each frame while driving: u the unit, drive sim.js's drive state. Returns a brake demand (0 or 1). */
  step(u, drive, now, dt) {
    let brake = 0
    // (a message stays a few seconds, then goes)
    if (this.msg && this.msg !== this.shown) { this.shown = this.msg; this.msgAt = now }
    if (this.msg && now - this.msgAt > 8 && !this.stopped) this.msg = null
    this.km += (u.v * dt) / 1000
    if (this.signals) {
      const a = this.signals.ahead(u)
      if (a) {
        // the horn coming up to a caution: yours to say you have seen it, or the brakes go on
        if (a.signal && a.dist < 180 && this.lastSig !== a.signal) {
          this.lastSig = a.signal
          if (Signals.isCaution(a.signal.aspect)) { this.aws = { at: now, sig: a.signal }; this.acked = false; this.sound?.horn?.(0.25); this.msg = 'caution ahead: press A to say you have seen it' }
          else if (!Signals.isRed(a.signal.aspect)) { this.acked = false; this.sound?.bell?.() }
        }
        if (this.aws && !this.acked && now - this.aws.at > 2.7) { this.awsMissed++; this.aws = null; this.stopped = true; this.msg = 'the caution was not seen: the brakes went on' }
        // a red passed: the train is stopped
        if (a.signal && Signals.isRed(a.signal.aspect) && a.dist < 2 && u.v > 0.5) { this.spad++; this.stopped = true; this.msg = 'a signal at danger was passed: the train was stopped' }
        // over the limit
        if (u.v > a.limit + 1.5) { this.over += dt; if (u.v > a.limit + 4.5) { this.stopped = true; this.msg = `far over the limit of ${Math.round(a.limit * 2.23694)}: the brakes went on` } }
        this.limit = a.limit; this.nextLimit = a.next
      }
    }
    if (this.stopped) { brake = 1; if (u.v < 0.1) this.stopped = false }
    return brake
  }
  acknowledge() { if (this.aws) { this.acked = true; this.aws = null; this.msg = 'caution seen' } }
  /** At a stop with the doors opened: late or early by the timetable, and the mark. */
  arrived(u, i, mark, now) {
    this.stops++; this.marks.push(mark)
    const due = u.current?.times.find((x) => x.i === i)
    if (this.timetable && due) this.late.push(Math.round((now - due.arr) / 60))
    this.rightAway = false
  }
  /** The doors closed to go: early if before the time, and the guard's bells at the time. */
  canGo(u, i, now) {
    if (!this.timetable) return true
    const due = u.current?.times.find((x) => x.i === i)
    if (due && now < due.dep - 20) { this.early++; this.msg = `early: it goes at ${hhmm(due.dep)}`; return true }
    return true
  }
  ringIfDue(u, i, now) {
    if (!this.timetable || this.rightAway) return
    const due = u.current?.times.find((x) => x.i === i)
    if (due && now >= due.dep) { this.rightAway = true; this.sound?.bell?.(); setTimeout(() => this.sound?.bell?.(), 350); this.msg = 'right away: two bells from the guard' }
  }
  /** What the next stop is due, and how it stands now. */
  words(u, now) {
    const bits = []
    if (this.limit) bits.push(`limit ${Math.round(this.limit * 2.23694)}${this.nextLimit < this.limit - 0.5 ? `, ${Math.round(this.nextLimit * 2.23694)} ahead` : ''}`)
    if (this.timetable) {
      const due = u.current?.times.find((x) => x.i === u.next)
      if (due) { const d = Math.round((now - due.arr) / 60); bits.push(`${u.line.stops[u.next]?.name} due ${hhmm(due.arr)}${d > 0 ? `, ${d} min late` : d < 0 ? `, ${-d} min early` : ', on time'}`) }
    }
    if (this.msg) bits.push(this.msg)
    return bits.join(' · ')
  }
  /** The card at the end of a run: how it went, in plain words and a score out of a hundred. */
  card(u) {
    const late = this.late.length ? this.late[this.late.length - 1] : 0
    const onMark = this.marks.filter((m) => m >= 7).length
    let score = 100
    for (const l of this.late) score -= Math.max(0, l - 1) * 3
    score -= this.early * 5 + this.spad * 30 + this.awsMissed * 5 + Math.round(this.over / 5) * 2
    score += onMark
    score = clamp(Math.round(score), 0, 100)
    const tr = u.current
    const title = tr ? `the ${hhmm(tr.dep)} ${u.line.stops[tr.from].name} to ${u.line.stops[tr.to].name}` : `the ${u.line.name}`
    const lines = [
      `You drove ${title}, ${Math.round(this.km / 1.609)} miles on the ${u.line.name}.`,
      this.timetable ? (late > 1 ? `${late} minutes late at the end.` : late < -1 ? `${-late} minutes early at the end.` : 'On time at the end.') : '',
      `${onMark} of ${this.stops} stops on the mark.`,
      this.signals ? (this.spad ? `${this.spad} ${this.spad === 1 ? 'signal' : 'signals'} passed at danger.` : 'No signal passed at danger.') : '',
      this.signals && this.awsMissed ? `${this.awsMissed} ${this.awsMissed === 1 ? 'caution' : 'cautions'} not seen.` : '',
      this.signals ? (this.over > 5 ? `Over the limit for ${Math.round(this.over)} seconds.` : 'Every limit kept.') : '',
    ].filter(Boolean)
    return { score, lines, title }
  }
}

/** Boards on a platform with what leaves next: the time, where it is going, and when it is expected. */
export class Boards {
  constructor(near) { this.near = near; this.list = []; this.t = 0 }
  add(line, sim) {
    for (const [i, st] of line.stops.entries()) {
      const [x, z] = line.centre(st.s)
      const b = { line, sim, i, tex: null, mesh: null, last: '' }
      this.list.push(b)
      this.near.add({ kind: 'board', x, z, reach: 1500, build: () => {
        const g = new THREE.Group()
        const legs = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.12), solid(0x55524c)); legs.position.y = 3.3; g.add(legs)
        for (const dx of [-1.2, 1.2]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.3, 0.1), solid(0x55524c)); p.position.set(dx, 1.65, 0); g.add(p) }
        b.tex = textCanvas(['departures'], { w: 512, h: 256, size: 40 })
        b.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshBasicMaterial({ map: b.tex, side: THREE.DoubleSide }))
        b.mesh.position.y = 2.55; g.add(b.mesh)
        b.last = ''
        line.placeAlong(g, st.s + 8, (line.twoAt(st.s) > 0.5 ? 1.7 : 0) + 1.5 + 2.6 + 1.2, 1)
        return g
      } })
    }
  }
  /** Once a minute of the railway's clock, each board in view written again. */
  step(now) {
    for (const b of this.list) {
      if (!b.mesh || b.mesh.userData.gone) continue
      const deps = []
      for (const u of b.sim.units) for (const tr of u.trips) { const t = tr.times.find((x) => x.i === b.i); if (t && t.dep >= now - 30 && tr.to !== b.i) deps.push({ t: t.dep, to: b.sim.stops[tr.to].name, late: u.current === tr ? u.late : 0 }) }
      deps.sort((x, y) => x.t - y.t)
      const rows = deps.slice(0, 3).map((d) => `${hhmm(d.t)} ${d.to.slice(0, 18)}${d.late > 90 ? ` +${Math.round(d.late / 60)}` : ''}`)
      const key = rows.join('|')
      if (key === b.last) continue
      b.last = key
      const cv = b.tex.image, g = cv.getContext('2d')
      g.fillStyle = '#0b0b0d'; g.fillRect(0, 0, cv.width, cv.height)
      g.fillStyle = '#f0c44d'; g.font = 'bold 34px ui-monospace, Menlo, monospace'; g.textBaseline = 'top'
      g.fillText(b.sim.stops[b.i].name.slice(0, 24), 16, 12)
      g.font = '30px ui-monospace, Menlo, monospace'
      rows.forEach((r, k) => g.fillText(r, 16, 66 + k * 56))
      if (!rows.length) { g.fillStyle = '#8d8a84'; g.fillText('no more trains today', 16, 66) }
      b.tex.needsUpdate = true
    }
  }
}
