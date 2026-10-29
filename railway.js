// The railway: every line running at once, a day's timetable each, trains on all of them (29 Oct, Sam: "have all the
// lines running properly at the same time, and to have multiple trains and lines running parallel ... we essentially
// want a working uk train simulator").
//
// Each line has a clock-face timetable from first train to last, from both ends, and the fewest units that can work
// it, each going back and forth all day as real ones do. The trains run themselves: they pull away, run up to the
// line's speed, brake into each station, wait, and keep their distance from the train in front. Where there is one
// track, a train takes the stretch to the next loop for itself before it goes, and one coming the other way waits in
// its loop until it is clear; where there are two, they pass. The railway runs on the clock of the place it is in, so
// whoever opens it sees the same trains where they are now. Nothing here draws; the engine puts a train in the world
// for each unit near the camera.
//
// Without "every line running at once" (features.json) it is one line and one train, his, going back and forth from
// twenty to seven in the morning, as it always was.

import { clamp, sm, hashStr, mulberry } from './geo.js'
import { KINDS, lengthOf } from './kinds.js'

export const ACCEL = 0.55, BRAKE = 0.7, DWELL = 40, TURN = 150, LAYOVER = 6 * 60
const TAPER = 90
const DAY = 86400
const DAY_START = 4 * 3600            // the railway's day runs from four in the morning to four the next
const SIDINGS = 15 * 60               // a train waiting longer than this for its next trip waits in the sidings
const CATCH_UP = 90 * 60             // how far back it starts running when it opens, from where the timetable has them

/** What the railway needs of a line: its length, its stops, how many tracks where, how fast. */
export class SimLine {
  constructor({ slug, name, from, to, length, stops, tracks = [], speed = 26.8, every = 60, freight = 0, steam = [], kind = 'dmu', future = false, ghost = false }) {
    Object.assign(this, { slug, name, from, to, length, speed, every, freight, steam, kind, future, ghost })
    const n = Math.ceil(length / 10) + 1
    this.two = new Float32Array(n)
    for (const [a0, b0, k] of tracks) {
      if (k < 2) continue
      const a = a0 * 1000, b = b0 * 1000
      for (let i = Math.max(0, Math.floor((a - TAPER) / 10)); i <= Math.min(n - 1, Math.ceil((b + TAPER) / 10)); i++) { const s = i * 10; this.two[i] = Math.max(this.two[i], Math.min(sm(a - TAPER, a, s), 1 - sm(b, b + TAPER, s))) }
    }
    this.stops = stops.map((st) => ({ ...st, loop: this.twoAt(st.s) > 0.9 }))
    // the stretches of one track, between the places trains can pass: one stretch each, held by one way at a time
    this.sections = []
    let a = null
    for (let i = 0; i < n; i++) {
      const single = this.two[i] < 0.5
      if (single && a == null) a = i * 10
      if (!single && a != null) { this.sections.push({ a, b: i * 10, dir: 0, held: new Set() }); a = null }
    }
    if (a != null) this.sections.push({ a, b: length, dir: 0, held: new Set() })
    // (a line of one track with no loop at all still has to work: its middle station is made a loop)
    if (this.sections.length === 1 && this.sections[0].a <= 10 && this.sections[0].b >= length - 10 && this.stops.length > 2 && length > 8000) {
      const mid = this.stops[Math.floor(this.stops.length / 2)]
      this.sections = [{ a: 0, b: mid.s - 150, dir: 0, held: new Set() }, { a: mid.s + 150, b: length, dir: 0, held: new Set() }]
      mid.loop = true
      this.passing = [mid.s - 150, mid.s + 150]
    }
    this.units = []
  }
  twoAt(s) { const f = clamp(s / 10, 0, this.two.length - 1), i = Math.floor(f); const v = this.two[i] + (this.two[Math.min(this.two.length - 1, i + 1)] - this.two[i]) * (f - i); return this.passing && s > this.passing[0] && s < this.passing[1] ? 1 : v }
  /** Where a train going dir stops at a stop: its middle at the middle of the platform, never off the end of the line. */
  stopPoint(i, dir, len) { return clamp(this.stops[i].s + dir * len / 2, len + 2, this.length - 2) }
}

/** How long it takes to run d metres from a stand to a stand at most v fast. */
function runTime(d, v) {
  const dAcc = (v * v) / (2 * ACCEL), dBrk = (v * v) / (2 * BRAKE)
  if (d < dAcc + dBrk) { const vp = Math.sqrt((2 * d * ACCEL * BRAKE) / (ACCEL + BRAKE)); return vp / ACCEL + vp / BRAKE }
  return v / ACCEL + v / BRAKE + (d - dAcc - dBrk) / v
}

/**
 * A trip: from one stop to another, the stops it calls at, and when it is due at each ({ i, arr, dep } in seconds of
 * the railway's day). calls: 'all' or 'ends' (a freight stops only where it is going).
 */
function planTrip(line, from, to, dep, kind, calls = 'all') {
  const dir = to > from ? 1 : -1, v = line.speed * (KINDS[kind]?.speed || 1), len = lengthOf(kind)
  const times = [{ i: from, arr: dep, dep }]
  let t = dep, last = line.stopPoint(from, dir, len)
  for (let i = from + dir; dir > 0 ? i <= to : i >= to; i += dir) {
    if (calls !== 'all' && i !== to) continue
    const p = line.stopPoint(i, dir, len)
    t += runTime(Math.abs(p - last), v)
    // (due on the minute, as a timetable says it)
    const arr = Math.ceil(t / 30) * 30
    const d = i === to ? arr : arr + DWELL
    times.push({ i, arr, dep: d })
    t = d; last = p
  }
  return { from, to, dir, dep, arr: times[times.length - 1].arr, kind, calls, times }
}

/** A unit: one train, its day of trips, and where it is. */
export class Unit {
  constructor(line, kind, id) {
    this.line = line; this.kind = kind; this.id = id
    this.len = lengthOf(kind)
    this.trips = []; this.trip = -1
    this.s = 0; this.v = 0; this.dir = 1; this.side = 1
    this.phase = 'stabled'; this.next = 0; this.dwell = 0
    this.travelled = 0
    this.late = 0
    this.you = false
  }
  get current() { return this.trips[this.trip] || null }
  get dest() { const t = this.current || this.trips[0]; return t ? this.line.stops[t.to].name : this.line.to }
  get origin() { const t = this.current || this.trips[0]; return t ? this.line.stops[t.from].name : this.line.from }
  /** The stop it calls at next, as an index, or null. */
  get nextStop() { const t = this.current; if (!t || this.phase === 'stabled') return null; return this.next }
  /** What it is called on the board: the time it set off, from where, to where. */
  get title() { const t = this.current || this.trips.find((x) => x.dep >= 0) || this.trips[0]; if (!t) return this.line.name; return `${hhmm(t.dep)} ${this.line.stops[t.from].name} to ${this.line.stops[t.to].name}` }
  /** Its headcode, the way a signaller would know it: what it is, the line, the trip. */
  get headcode() { const t = this.current || this.trips[0]; const cls = this.kind === 'freight' ? 6 : this.kind === 'steam' ? 1 : 2; return `${cls}${String.fromCharCode(65 + (hashStr(this.line.slug) % 26))}${String((this.id * 7 + (t ? Math.floor(t.dep / 600) : 0)) % 100).padStart(2, '0')}` }
}

export const hhmm = (t) => { const d = ((Math.round(t / 60) * 60) % DAY + DAY) % DAY; return `${String(Math.floor(d / 3600)).padStart(2, '0')}:${String(Math.floor(d / 60) % 60).padStart(2, '0')}` }

/**
 * A line's day: departures from each end on the clock face, freights through the night, a steam special where the line
 * has one, and the fewest units that can work them (each picks up the next departure from where it is once it has had
 * its time at the end).
 */
export function planDay(line) {
  const rng = mulberry(hashStr(line.slug))
  const last = line.stops.length - 1
  // (no more often than the longest stretch of one track can carry, a train each way through it, with time to spare: a
  // timetable the line could not run built up a queue at a loop that never cleared)
  const longest = Math.max(0, ...line.sections.map((sec) => runTime(sec.b - sec.a + 400, line.speed * 0.9)))
  const every = Math.ceil(Math.max(Math.max(20, line.every) * 60, (2 * longest + 6 * 60)) / 900) * 900
  const offA = Math.floor(rng() * (every / 60)) * 60, offB = (offA + every / 2 + Math.floor(rng() * 10) * 60) % every
  const deps = []
  for (let t = 6 * 3600 + offA; t <= 22.5 * 3600; t += every) deps.push(planTrip(line, 0, last, t, line.kind))
  for (let t = 6 * 3600 + offB; t <= 22.5 * 3600; t += every) deps.push(planTrip(line, last, 0, t, line.kind))
  // every few trips is a longer train where the line is busy enough to have one
  if (line.kind === 'dmu' && line.twoAt(line.length / 2) > 0.5) deps.forEach((d, k) => { if (k % 4 === 1) Object.assign(d, planTrip(line, d.from, d.to, d.dep, line.future && k % 8 === 1 ? 'future' : 'express')) })
  deps.sort((a, b) => a.dep - b.dep)
  const units = []
  for (const trip of deps) {
    let u = units.find((x) => x.kind === trip.kind && x.free <= trip.dep && x.at === trip.from)
    if (!u) { u = new Unit(line, trip.kind, units.length); u.free = -Infinity; units.push(u) }
    u.trips.push(trip)
    u.at = trip.to; u.free = trip.arr + LAYOVER
  }
  // freights, end to end, some at night, stopping only where they are going
  for (let k = 0; k < line.freight; k++) {
    const u = new Unit(line, 'freight', units.length)
    const t = DAY_START + Math.floor(rng() * 20 * 3600 / 300) * 300
    const up = rng() < 0.5
    u.trips.push(planTrip(line, up ? 0 : last, up ? last : 0, t, 'freight', 'ends'))
    units.push(u)
  }
  // a steam special, there and back, on a line that has one
  for (const sp of line.steam || []) {
    const a = line.stops.findIndex((x) => x.name.includes(sp.from)), b = line.stops.findIndex((x) => x.name.includes(sp.to))
    if (a < 0 || b < 0 || a === b) continue
    const u = new Unit(line, 'steam', units.length)
    const out = planTrip(line, a, b, sp.at * 3600, 'steam')
    u.trips.push(out, planTrip(line, b, a, out.arr + 90 * 60, 'steam'))
    units.push(u)
  }
  // a ghost train after midnight, once he has added it: end to end, stopping nowhere, in nobody's way
  if (line.ghost) {
    const u = new Unit(line, 'ghost', units.length)
    const up = rng() < 0.5
    u.trips.push(planTrip(line, up ? 0 : last, up ? last : 0, 24 * 3600 + 5 * 60 + Math.floor(rng() * 50) * 60, 'ghost', 'ends'))
    units.push(u)
  }
  for (const u of units) { delete u.free; delete u.at }
  return units
}

export class Railway {
  /** lines: SimLines. network: true for every line's day; false for one line and his train back and forth. */
  constructor(lines, { network = true } = {}) {
    this.lines = lines
    this.network = network
    this.units = []
    this.clock = DAY_START
    this.onArrive = null
    this.onDepart = null
  }

  /** Start the railway at a time of day (seconds since midnight), with every train where it would be by then. */
  start(clockOfDay) {
    this.clock = clockOfDay < DAY_START ? clockOfDay + DAY : clockOfDay
    this.units = []
    for (const line of this.lines) {
      for (const s of line.sections) { s.dir = 0; s.held.clear() }
      if (this.network) line.units = planDay(line)
      else line.units = [this.shuttle(line)]
      this.units.push(...line.units)
    }
    if (!this.network) return
    // where the timetable has them a while ago, and then run to now
    const from = Math.max(DAY_START, this.clock - CATCH_UP)
    for (const u of this.units) this.placeAt(u, from)
    let t = from
    while (t < this.clock) { const dt = Math.min(6, this.clock - t); this.stepAll(dt, t + dt); t += dt }
  }

  /** His train back and forth on its own line, from the first stop. */
  shuttle(line, kind = line.kind || 'dmu') {
    const u = new Unit(line, kind, 0)
    u.shuttleKind = true
    const last = line.stops.length - 1
    u.trips.push(planTrip(line, 0, last, this.clock, kind))
    u.trip = 0; u.dir = 1; u.side = 1
    u.s = line.stopPoint(0, 1, u.len); u.next = 1; u.phase = 'dwell'; u.dwell = DWELL
    return u
  }

  /** A unit where its day says it is at time t: stood at a platform, between two stops, or put away for the night. */
  placeAt(u, t) {
    const line = u.line
    let k = u.trips.findIndex((x) => x.arr >= t)
    if (k < 0) { const tr = u.trips[u.trips.length - 1]; k = u.trips.length - 1; this.stand(u, k, tr.to, 'stabled'); u.ended = true; return }
    const tr = u.trips[k]
    if (t < tr.dep) {
      // waiting for this trip: in the sidings until a quarter of an hour before, then at its first platform
      this.stand(u, k, tr.from, t < tr.dep - SIDINGS ? 'stabled' : 'dwell')
      u.dwell = tr.dep - t
      return
    }
    // between two of its stops: as far along as the time says
    const times = tr.times
    let j = 0
    while (j < times.length - 1 && times[j + 1].arr <= t) j++
    u.trip = k; u.dir = tr.dir; u.side = tr.dir
    if (j >= times.length - 1) { this.stand(u, k, tr.to, 'dwell'); return }
    const a = times[j], b = times[j + 1]
    if (t < a.dep) { this.stand(u, k, a.i, 'dwell'); u.dwell = a.dep - t; u.next = b.i; return }
    const pa = line.stopPoint(a.i, tr.dir, u.len), pb = line.stopPoint(b.i, tr.dir, u.len)
    const f = clamp((t - a.dep) / ((b.arr - a.dep) || 1), 0, 1)
    u.s = pa + (pb - pa) * f
    u.v = Math.min(line.speed, 15)
    u.next = b.i; u.phase = 'run'
    this.hold(u)
  }
  stand(u, k, i, phase) {
    const tr = u.trips[k]
    u.trip = k
    u.dir = tr.dir
    u.side = u.dir
    u.s = u.line.stopPoint(i, u.dir, u.len)
    u.v = 0; u.phase = phase
    u.next = i === tr.to ? i : tr.calls === 'all' ? i + tr.dir : tr.to
    u.dwell = phase === 'dwell' ? DWELL : 0
    if (phase !== 'stabled') this.hold(u)
  }
  /** Off the running line altogether: whatever stretch of one track it held is let go. */
  free(u) { for (const sec of u.line.sections) if (sec.held.delete(u) && !sec.held.size) sec.dir = 0 }
  // a unit inside a stretch of one track holds it; one put where another already is waits at the loop before it
  hold(u) {
    for (const sec of u.line.sections) {
      if (!this.inside(u, sec)) continue
      if (sec.held.size && !sec.held.has(u)) {
        const entry = u.dir > 0 ? sec.a : sec.b
        u.s = clamp(entry - u.dir * 40, u.len + 2, u.line.length - 2); u.v = 0
        if (u.phase === 'dwell') u.phase = 'run'
        continue
      }
      sec.held.add(u); sec.dir = u.dir
    }
  }
  inside(u, sec) { const front = u.s, rear = u.s - u.dir * u.len; return Math.max(front, rear) > sec.a && Math.min(front, rear) < sec.b }

  /** Everything moves on by dt seconds. */
  step(dt) {
    let left = dt
    while (left > 0) { const d = Math.min(left, 1.5); this.clock += d; this.stepAll(d, this.clock); left -= d }
  }
  stepAll(dt, now) { for (const u of this.units) this.stepUnit(u, dt, now) }

  stepUnit(u, dt, now) {
    const line = u.line
    if (u.phase === 'stabled') {
      // (out of the sidings to the platform a quarter of an hour before its next trip; put away for the night after its last)
      const k = Math.max(0, u.trip), tr = u.trips[k]
      if (!u.ended && tr && now >= tr.dep - SIDINGS) {
        // (once the platform is clear of anything stood there going the same way)
        const at = line.stopPoint(tr.from, tr.dir, u.len)
        if (line.units.some((o) => o !== u && o.phase !== 'stabled' && o.dir === tr.dir && Math.abs(o.s - at) < u.len + o.len + 20)) return
        this.stand(u, k, tr.from, 'dwell'); u.dwell = tr.dep - now
      }
      return
    }
    if (u.you) { this.release(u); this.claim(u); return }
    if (u.phase === 'dwell' || u.phase === 'layover') {
      u.dwell -= dt
      const tr = u.current
      const due = tr ? (tr.times.find((x) => x.i === this.stopIndexAt(u))?.dep ?? 0) : 0
      if (u.dwell > 0 || (this.network && now < due)) return
      // the end of its trip: the next one, from here, the other way (the driver walks to the other end)
      if (tr && this.stopIndexAt(u) === tr.to && this.turnBack(u, now) !== 'go') return
      u.phase = 'run'
      this.onDepart?.(u)
    }
    this.runUnit(u, dt, now)
  }

  /**
   * At the end of a trip: the next one, from here, the other way. Returns 'wait' while it waits for its time, 'gone'
   * when its day is done, or 'go'.
   */
  turnBack(u, now) {
    const line = u.line, tr = u.current
    if (u.shuttleKind) {
      if (u.phase !== 'layover' && !u.you) { u.phase = 'layover'; u.dwell = TURN; return 'wait' }
      u.trips.push(planTrip(line, tr.to, tr.from, now, u.kind))
    }
    const nx = u.trips[u.trip + 1]
    if (!nx) { this.free(u); u.phase = 'stabled'; u.ended = true; return 'gone' }
    // (a long wait is in the sidings, out of the way of the trains coming in behind: until 29 Oct they stood at the
    // platform for two hours and everything behind them stood too)
    if (!u.shuttleKind && !u.you && now < nx.dep - SIDINGS) { this.free(u); u.trip++; u.phase = 'stabled'; return 'wait' }
    if (!u.shuttleKind && now < nx.dep - 30 && !u.you) { u.phase = 'layover'; u.dwell = nx.dep - now; return 'wait' }
    if (nx.dir !== u.dir) { u.s -= u.dir * u.len; u.dir = nx.dir; for (const sec of line.sections) if (sec.held.has(u)) sec.dir = u.dir }
    u.trip++
    u.next = nx.calls === 'all' ? nx.from + nx.dir : nx.to
    u.late = Math.max(0, now - nx.dep)
    return 'go'
  }

  runUnit(u, dt, now) {
    const line = u.line
    if (u.phase !== 'run') return
    const tr = u.current
    if (!tr) { u.phase = 'stabled'; return }
    const target = line.stopPoint(u.next, u.dir, u.len)
    const limit = this.authority(u, target)
    const dist = (limit - u.s) * u.dir
    const vmax = line.speed * (KINDS[u.kind]?.speed || 1)
    const want = Math.min(vmax, Math.sqrt(Math.max(0, 2 * BRAKE * (dist - 1))))
    u.v = want > u.v ? Math.min(want, u.v + ACCEL * dt) : Math.max(want, u.v - BRAKE * 1.6 * dt)
    let ds = u.v * dt
    if (ds >= dist) { ds = Math.max(0, dist); u.v = dist < 2 ? 0 : u.v }
    u.s += u.dir * ds
    u.travelled += ds
    // across to its own track where a second one opens (a crossover in the station throat), or, coming into the end of
    // its trip with a train stood at that platform, across to the other one
    let aim = u.dir
    if (u.next === tr.to && Math.abs(target - u.s) < 450 && line.twoAt(target) > 0.5) {
      const taken = line.units.some((o) => o !== u && o.phase !== 'stabled' && Math.abs(o.s - target) < o.len + u.len && Math.sign(o.side) === Math.sign(u.dir))
      if (taken) aim = -u.dir
    }
    if (ds > 0) u.side += clamp(aim - u.side, -ds / 150, ds / 150)
    this.release(u); this.claim(u)
    // at the stop it was making for
    if (Math.abs(u.s - target) < 1.5 && u.v < 0.5) {
      u.s = target; u.v = 0
      const due = tr.times.find((x) => x.i === u.next)
      u.late = due ? Math.max(0, now - due.arr) : 0
      u.dwell = u.next === tr.to ? 0 : DWELL
      u.phase = 'dwell'
      this.onArrive?.(u, u.next)
      if (u.next !== tr.to) u.next = tr.calls === 'all' ? u.next + u.dir : tr.to
    }
  }
  /** Which stop a unit is standing at (the one before the one it is making for). */
  stopIndexAt(u) { const tr = u.current; if (!tr) return -1; if (u.phase === 'dwell' && Math.abs(u.s - u.line.stopPoint(u.next, u.dir, u.len)) < 3) return u.next; let best = -1, bd = Infinity; u.line.stops.forEach((st, i) => { const d = Math.abs(u.line.stopPoint(i, u.dir, u.len) - u.s); if (d < bd) { bd = d; best = i } }); return best }

  /** How far a unit may go: its stop, the back of the train in front (with room to spare), the loop before a held stretch. */
  authority(u, limit) {
    const line = u.line, d = u.dir
    if (u.kind === 'ghost') return limit
    const closer = (x) => { if ((x - u.s) * d < (limit - u.s) * d) limit = x }
    for (const o of line.units) {
      // (one put away for the night is in the sidings, off the running line)
      if (o === u || o.phase === 'stabled' || o.kind === 'ghost') continue
      const rear = o.s - o.dir * o.len
      // the train in front going the same way, on the same track (one at the other platform is not in the way)
      const sameTrack = line.twoAt(o.s) < 0.5 || Math.sign(o.side) === Math.sign(u.side) || Math.abs(o.side) < 0.5
      if (o.dir === d && (rear - u.s) * d > 0 && sameTrack) closer(rear - d * 120)
    }
    // the next stretch of one track ahead: one train in it at a time, as the token on a single line has it, so a train
    // waits in the loop before it until it is clear (a train following into a dead end would never get out again)
    // (in the order the train comes to them)
    for (const sec of d > 0 ? line.sections : [...line.sections].reverse()) {
      const entry = d > 0 ? sec.a : sec.b
      const ahead = (entry - u.s) * d
      if (ahead < -1 || this.inside(u, sec)) continue
      if (ahead > 6000) break
      if (sec.held.size && !sec.held.has(u)) closer(entry - d * 40)
      break
    }
    return limit
  }
  /** A stretch of one track taken as a train comes up to it (with room to stop), and let go once it is through. */
  claim(u) {
    if (u.kind === 'ghost') return
    const d = u.dir, brake = (u.v * u.v) / (2 * BRAKE) + 400
    for (const sec of u.line.sections) {
      const entry = d > 0 ? sec.a : sec.b
      const ahead = (entry - u.s) * d
      if (this.inside(u, sec) || (ahead >= -1 && ahead < brake)) {
        if (sec.held.has(u) || sec.held.size) continue
        // (only the train at the front of the queue for it: the one behind taking it first held up both for good)
        if (!this.inside(u, sec) && u.line.units.some((o) => o !== u && o.phase !== 'stabled' && o.dir === d && (o.s - u.s) * d > 0 && (entry - o.s) * d > -o.len)) continue
        sec.held.add(u); sec.dir = d
      }
    }
  }
  release(u) { for (const sec of u.line.sections) if (sec.held.has(u) && !this.inside(u, sec) && ((d) => ((d > 0 ? sec.a : sec.b) - u.s) * d < 0)(u.dir)) { sec.held.delete(u); if (!sec.held.size) sec.dir = 0 } }

  /** The units on the move or stood at a platform (not put away), for the map and the list. */
  get out() { return this.units.filter((u) => u.phase !== 'stabled') }
}

/** The time on the railway's clock (seconds since midnight) in Britain now. */
export function ukNow() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date())
  const get = (t) => Number(p.find((x) => x.type === t)?.value || 0)
  return (get('hour') % 24) * 3600 + get('minute') * 60 + get('second')
}
