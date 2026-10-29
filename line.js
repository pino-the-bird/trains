// One real line, in the frame every line shares (geo.js): its track as OpenStreetMap has it, how high it runs, how many
// tracks it has where (fetchTracks.mjs), its stations, its viaducts and tunnels, the photographs along it, and the land
// beside it from the map. Built in pieces as the camera comes near and given back as it goes, so every line can be in
// the world at once.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { toXZ, fromLineFrame, clamp, lerp, sm, mulberry } from './geo.js'
import { INK, PINK, GOLD, ACID, inkLine, solid, flat, outlined, textCanvas } from './draw.js'

// half the distance between two tracks side by side (3.4 m centre to centre), how long the loop takes to open out, and
// how long the run in to a station shared with another line is
export const HALF = 1.7
const TAPER = 90
const LANE_RUN = 1600
const CHUNK = 2000

const loader = new THREE.TextureLoader()
loader.setCrossOrigin('anonymous')
const sleeperGeo = new THREE.BoxGeometry(2.6, 0.16, 0.26)
sleeperGeo.userData.shared = true

export class Line {
  /**
   * data: the line's own file. meta: what the network says of it ({ tracks: [[fromKm, toKm, n]], lanes: { start, end },
   * speed, kind }). scenery: the land beside it from the map, or null.
   */
  constructor(data, meta = {}, scenery = null) {
    this.data = data
    this.slug = data.slug
    this.name = data.name
    this.meta = meta
    this.scenery = scenery
    this.P = data.path.map(([lat, lon, km]) => { const [x, z] = toXZ(lat, lon); return { x, z, s: km * 1000 } })
    this.length = this.P[this.P.length - 1].s
    this.step = data.profile.step
    this.speed = meta.speed || 26.8
    // how many tracks, every ten metres: 0 one track, 1 two, eased in and out where a loop opens
    const runs = (meta.tracks || []).filter((r) => r[2] >= 2).map(([a, b]) => [a * 1000, b * 1000])
    const n = Math.ceil(this.length / 10) + 1
    this.two = new Float32Array(n)
    for (const [a, b] of runs) for (let i = Math.max(0, Math.floor((a - TAPER) / 10)); i <= Math.min(n - 1, Math.ceil((b + TAPER) / 10)); i++) {
      const s = i * 10
      this.two[i] = Math.max(this.two[i], Math.min(sm(a - TAPER, a, s), 1 - sm(b, b + TAPER, s)))
    }
    this.lanes = meta.lanes || { start: 0, end: 0 }
    // the stations a train stops at, the ends of the line among them
    this.stops = []
    for (const st of data.stations) if (!st.disused) this.stops.push({ s: clamp(st.km * 1000, 12, this.length - 12), name: st.name, loop: false })
    if (!this.stops.length || this.length - this.stops[this.stops.length - 1].s > 400) this.stops.push({ s: this.length - 30, name: data.to, loop: false })
    if (this.stops[0].s > 400) this.stops.unshift({ s: 30, name: data.from, loop: false })
    for (const st of this.stops) st.loop = this.twoAt(st.s) > 0.9
    this.built = false
    this.cells = new Map()
  }

  /** The ground across the line at s, off metres to its left, from the line's own rows (the elevation model's). */
  rowGround(s, off) {
    const rows = this.data.terrain?.rows, OFF = this.data.terrain?.offsets
    if (!rows?.length) return this.groundY(s)
    const row = rows[clamp(Math.round(s / this.step), 0, rows.length - 1)]
    if (off <= OFF[0]) return row[0]
    for (let j = 1; j < OFF.length; j++) if (off <= OFF[j]) return lerp(row[j - 1], row[j], (off - OFF[j - 1]) / (OFF[j] - OFF[j - 1]))
    return row[row.length - 1]
  }
  profileAt(arr, s) { const f = clamp(s / this.step, 0, arr.length - 1), i = Math.floor(f), t = f - i; return lerp(arr[i], arr[Math.min(arr.length - 1, i + 1)], t) }
  trackY(s) { return this.profileAt(this.data.profile.track, s) }
  groundY(s) { return this.profileAt(this.data.profile.ground, s) }
  seg(s) { const P = this.P; let lo = 0, hi = P.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].s <= s) lo = m; else hi = m } return lo }
  /** The middle of the track at s (no loops, no lanes): [x, z]. */
  centre(s) {
    s = clamp(s, 0, this.length)
    const i = this.seg(s), a = this.P[i], b = this.P[i + 1] || a, t = (s - a.s) / ((b.s - a.s) || 1)
    return [lerp(a.x, b.x, t), lerp(a.z, b.z, t)]
  }
  /** The way the line runs at s, as a unit [x, z] (towards its far end). */
  tangent(s) {
    s = clamp(s, 6, this.length - 6)
    const [ax, az] = this.centre(s - 6), [bx, bz] = this.centre(s + 6)
    const L = Math.hypot(bx - ax, bz - az) || 1
    return [(bx - ax) / L, (bz - az) / L]
  }
  /** 0 on one track, 1 where there are two. */
  twoAt(s) { const f = clamp(s / 10, 0, this.two.length - 1), i = Math.floor(f); return lerp(this.two[i], this.two[Math.min(this.two.length - 1, i + 1)], f - i) }
  /** Where the line runs over at a station it shares with another line, so their trains stand side by side. */
  laneAt(s) {
    let off = 0
    if (this.lanes.start) off += this.lanes.start * (1 - sm(0, LANE_RUN, s))
    if (this.lanes.end) off += this.lanes.end * sm(this.length - LANE_RUN, this.length, s)
    return off
  }
  /** How far left of the middle a track is at s: side +1 the left one going towards the far end, -1 the right. */
  lateral(s, side = 0) { return this.laneAt(s) + side * HALF * this.twoAt(s) }
  /** A point on the line: s along it, side the track, lift above the rail head. */
  pos(s, side = 0, lift = 0, out = new THREE.Vector3()) {
    const [x, z] = this.centre(s), [tx, tz] = this.tangent(s), off = this.lateral(s, side)
    // (left of the way it runs: [tz, -tx])
    return out.set(x + tz * off, this.trackY(s) + lift, z - tx * off)
  }
  /** Which way a train faces at s going dir (+1 towards the far end): the angle about up. */
  yaw(s, dir = 1) { const [tx, tz] = this.tangent(s); return Math.atan2(tx * dir, tz * dir) }
  structureAt(s) { return this.data.structures.find((x) => s >= x.fromKm * 1000 - 5 && s <= x.toKm * 1000 + 5) || null }
  inTunnel(s) { const st = this.structureAt(s); return st?.kind === 'tunnel' && s > st.fromKm * 1000 + 15 && s < st.toKm * 1000 - 15 }

  /** Every bit of the track, every 20 m, as [x, z, s], for finding the nearest track to anywhere. */
  samples(every = 20) { const out = []; for (let s = 0; s <= this.length; s += every) { const [x, z] = this.centre(s); out.push([x, z, s]) } return out }

  // ── building it ────────────────────────────────────────────────────────────────────────────────────────────────
  /** Hands every piece of the line to the Near list: the track in stretches, the stations, the structures, the land. */
  addTo(near, ctx) {
    for (let a = 0; a < this.length; a += CHUNK) {
      const b = Math.min(this.length, a + CHUNK), [x, z] = this.centre((a + b) / 2)
      near.add({ kind: 'track', x, z, r: CHUNK / 2, reach: 9000, build: () => this.buildTrack(a, b, ctx) })
      // (the ground beside it once the ground there is in, so its shape is the real one)
      near.add({ kind: 'strip', x, z, r: CHUNK / 2, reach: 9000, pts: [this.centre(a), this.centre(b), [x, z]], needsGround: true, build: () => ctx.ground.strip(this, a, b) })
    }
    this.data.stations.forEach((st, k) => { const [x, z] = this.centre(st.km * 1000); near.add({ kind: 'station', x, z, r: 120, reach: 4500, build: () => this.buildStation(st, k, ctx) }) })
    for (const st of this.data.structures) {
      const a = st.fromKm * 1000, b = st.toKm * 1000, [x, z] = this.centre((a + b) / 2)
      if (st.kind === 'bridge' && b - a < 12) continue
      near.add({ kind: st.kind, x, z, r: (b - a) / 2, reach: st.name ? 9000 : 5000, build: () => (st.kind === 'bridge' ? this.buildBridge(st, ctx) : this.buildTunnel(st)) })
    }
    this.data.sights.forEach((ph, k) => { const s = clamp(ph.km * 1000, 12, this.length - 12), [x, z] = this.centre(s); near.add({ kind: 'sight', x, z, reach: 3000, build: () => this.photoBoard(ph, s, (k % 2 ? -1 : 1) * 34, 12, ctx) }) })
    if (this.scenery) this.addScenery(near, ctx)
  }

  /** A strip along the line from a to b, lateral offsets off0..off1 (functions of s or numbers), lift above the rail. */
  ribbon(a, b, off0, off1, lift, mat, anchor, every = 10) {
    const pos = [], idx = []
    const f0 = typeof off0 === 'function' ? off0 : () => off0, f1 = typeof off1 === 'function' ? off1 : () => off1
    let k = 0
    for (let s = a; ; s = Math.min(b, s + every)) {
      const [x, z] = this.centre(s), [tx, tz] = this.tangent(s), y = this.trackY(s) + lift
      const o0 = f0(s), o1 = f1(s)
      pos.push(x + tz * o0 - anchor[0], y, z - tx * o0 - anchor[1], x + tz * o1 - anchor[0], y, z - tx * o1 - anchor[1])
      if (k) { const i = (k - 1) * 2; idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3) }
      k++
      if (s >= b) break
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return new THREE.Mesh(g, mat)
  }

  buildTrack(a, b, ctx) {
    const [ax, az] = this.centre((a + b) / 2), anchor = [Math.round(ax), Math.round(az)]
    const g = new THREE.Group()
    g.position.set(anchor[0], 0, anchor[1])
    const half = (s) => 2.6 + HALF * this.twoAt(s)
    // (in a tunnel the bed is still drawn; over a bridge it is the deck)
    g.add(this.ribbon(a, b, (s) => this.laneAt(s) - half(s), (s) => this.laneAt(s) + half(s), 0.02, ctx.mats.bed, anchor))
    for (const side of [1, -1]) {
      for (const r of [-0.72, 0.72]) g.add(this.ribbon(a, b, (s) => this.lateral(s, side) + r - 0.035, (s) => this.lateral(s, side) + r + 0.035, 0.22, ctx.mats.rail, anchor, 5))
    }
    // the sleepers, every metre, on each track (the second only where there is one)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1)
    const spots = []
    for (let s = a; s < b; s += 1.1) { spots.push([s, 1]); if (this.twoAt(s) > 0.05) spots.push([s, -1]) }
    const sl = new THREE.InstancedMesh(sleeperGeo, ctx.mats.sleeper, spots.length)
    spots.forEach(([s, side], k) => {
      this.pos(s, side, 0.08, p); p.x -= anchor[0]; p.z -= anchor[1]
      q.setFromAxisAngle(up, this.yaw(s))
      sl.setMatrixAt(k, m.compose(p, q, one))
    })
    sl.instanceMatrix.needsUpdate = true
    g.add(sl)
    return g
  }

  /** A thing placed on the line at s, side metres to its left, lift up, turned to run with it. Positioned in the world. */
  placeAlong(obj, s, side = 0, lift = 0) {
    const [x, z] = this.centre(s), [tx, tz] = this.tangent(s), off = this.laneAt(s) + side
    obj.position.set(x + tz * off, this.trackY(s) + lift, z - tx * off)
    obj.rotation.y = Math.atan2(tx, tz)
    return obj
  }

  photoBoard(ph, s, side, size = 9, ctx) {
    const g = new THREE.Group()
    const w = size, h = size * ((ph.height || 3) / (ph.width || 4))
    const mat = new THREE.MeshBasicMaterial({ color: 0x222226, side: THREE.DoubleSide })
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
    face.position.y = h / 2 + 3
    g.add(face)
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w + 0.4, h + 0.4)), inkLine)
    frame.position.copy(face.position)
    g.add(frame)
    for (const x of [-w * 0.35, w * 0.35]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.2, 0.25), solid(0x55524c)); post.position.set(x, 1.6, 0); g.add(post) }
    const credit = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.09), new THREE.MeshBasicMaterial({ map: textCanvas([`${ph.author}`.slice(0, 40), ph.licence], { w: 1024, h: 92, size: 40, accent: '#e14a89' }), side: THREE.DoubleSide }))
    credit.position.y = 2.4
    g.add(credit)
    this.placeAlong(g, s, side, 0)
    g.position.y = (ctx.ground.h(g.position.x, g.position.z) ?? g.position.y) - 0.2
    g.rotateY(side > 0 ? -Math.PI / 2 + 0.5 : Math.PI / 2 - 0.5)
    loader.load(ph.thumb, (t) => { t.colorSpace = THREE.SRGBColorSpace; if (!mat.map && face.parent) { mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true } else t.dispose() })
    ctx.boards.add({ s, ph, line: this, obj: g })
    return g
  }

  buildStation(st, k, ctx) {
    const s = clamp(st.km * 1000, 12, this.length - 12)
    const g = new THREE.Group()
    const two = this.twoAt(s) > 0.5
    // a platform each side where there are two tracks; on one track, a side by turns
    const sides = two ? [1, -1] : [k % 2 ? -1 : 1]
    for (const sd of sides) {
      const edge = (two ? HALF : 0) + 1.5 + 2.6
      const plat = outlined(new THREE.BoxGeometry(5.2, st.disused ? 0.5 : 1, st.disused ? 70 : 110), st.disused ? 0x232220 : 0x3a3833)
      g.add(this.placeAlong(plat, s, sd * edge, st.disused ? 0.15 : 0.5))
      const out = sd * (edge + 2.6)
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), new THREE.MeshBasicMaterial({ map: textCanvas([st.name, st.disused ? 'closed' : `${(s / 1609.34).toFixed(1)} miles from ${this.data.from}`], { accent: st.disused ? '#8d8a84' : '#a7cd07' }), side: THREE.DoubleSide }))
      const post = new THREE.Group(); sign.position.y = 4.4; post.add(sign)
      g.add(this.placeAlong(post, s + 18, out - sd * 0.8, 0)); post.rotateY(Math.PI / 2)
      if (st.disused) continue
      const canopy = new THREE.Group()
      const roof = outlined(new THREE.BoxGeometry(4.2, 0.18, 46), 0x2b2a27); roof.position.y = 3.6; canopy.add(roof)
      const valance = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.42, 46.1), flat(PINK)); valance.position.y = 3.3; canopy.add(valance)
      for (let z = -20; z <= 20; z += 8) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.5, 0.2), solid(0x55524c)); p.position.set(0, 1.75, z); canopy.add(p) }
      g.add(this.placeAlong(canopy, s - 8, sd * (edge + 0.4), 1))
      g.add(this.placeAlong(outlined(new THREE.BoxGeometry(2.4, 2.4, 4.6), 0x3a3833), s + 30, sd * (edge + 1.1), 2.2))
      for (const d of [-36, 36]) g.add(this.placeAlong(outlined(new THREE.BoxGeometry(0.5, 0.45, 2.2), 0x6e675c), s + d, sd * (edge + 1.4), 1.25))
      // the fence along the back of the platform (its points from the station's own middle, so the numbers stay small)
      const fence = [], [ox, oz] = this.centre(s), O = new THREE.Vector3(Math.round(ox), 0, Math.round(oz))
      const at = (d, y) => { const a = this.pos(s + d, 0), [tx, tz] = this.tangent(s + d); return new THREE.Vector3(a.x + tz * out, a.y + y, a.z - tx * out).sub(O) }
      for (let z = -55; z <= 55; z += 2.5) fence.push(at(z, 1), at(z, 2.1))
      for (let z = -55; z < 55; z += 2.5) for (const y of [1.4, 2]) fence.push(at(z, y), at(z + 2.5, y))
      const fl = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(fence), ctx.mats.fence)
      fl.position.copy(O)
      g.add(fl)
      for (const d of [-40, -14, 14, 40]) {
        const lamp = new THREE.Group()
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, 5, 0.16), solid(0x55524c)); p.position.y = 2.5; lamp.add(p)
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), ctx.mats.lamp); head.position.y = 5.1; lamp.add(head)
        g.add(this.placeAlong(lamp, s + d, sd * (edge + 2.2), 1))
      }
    }
    // its photographs on boards behind the platform
    const sd0 = sides[0]
    st.photos.forEach((ph, j) => g.add(this.photoBoard(ph, clamp(s - 30 + j * 26, 12, this.length - 12), sd0 * ((two ? HALF : 0) + 14), 9, ctx)))
    const [cx, cz] = this.centre(s)
    return anchored(g, cx, cz)
  }

  buildBridge(st, ctx) {
    const a = st.fromKm * 1000, b = st.toKm * 1000
    const [ax, az] = this.centre((a + b) / 2), anchor = [Math.round(ax), Math.round(az)]
    const g = new THREE.Group()
    g.position.set(anchor[0], 0, anchor[1])
    const w = 2.9 + HALF * this.twoAt((a + b) / 2)
    for (const side of [-w, w]) {
      const pts = []
      for (let s = a; s <= b; s += 5) { const [x, z] = this.centre(s), [tx, tz] = this.tangent(s), o = this.laneAt(s) + side; pts.push(new THREE.Vector3(x + tz * o - anchor[0], this.trackY(s) + 1.1, z - tx * o - anchor[1])) }
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), inkLine))
    }
    // each span a wall of stone with an arch through it, down to the ground (merged, one shape for the whole viaduct)
    const span = b - a > 200 ? 13.7 : 18
    const walls = []
    for (let s = a; s + span <= b + 0.1; s += span) {
      const mid = s + span / 2, [cx, cz] = this.centre(mid), cy = this.trackY(mid)
      const gx = cx - anchor[0], gz = cz - anchor[1]
      const gy = Math.min(ctx.ground.h(cx, cz) ?? this.groundY(mid), this.groundY(s), this.groundY(s + span))
      const hgt = cy - gy + 1.2
      if (hgt < 3) continue
      const shape = new THREE.Shape()
      shape.moveTo(-span / 2, 0); shape.lineTo(span / 2, 0); shape.lineTo(span / 2, hgt); shape.lineTo(-span / 2, hgt); shape.lineTo(-span / 2, 0)
      const r = Math.min(span * 0.4, hgt * 0.45), top = Math.max(0.5, hgt - 1.8 - r)
      const hole = new THREE.Path()
      hole.moveTo(-r, 0); hole.lineTo(-r, top); hole.absarc(0, top, r, Math.PI, 0, true); hole.lineTo(r, 0); hole.lineTo(-r, 0)
      shape.holes.push(hole)
      const geo = new THREE.ExtrudeGeometry(shape, { depth: w * 2 - 0.4, bevelEnabled: false, curveSegments: 6 })
      geo.translate(0, 0, -(w - 0.2))
      const [tx, tz] = this.tangent(mid)
      geo.rotateY(Math.atan2(tx, tz) + Math.PI / 2)
      const off = this.laneAt(mid)
      geo.translate(gx + tz * off, gy - 0.2, gz - tx * off)
      walls.push(geo)
    }
    if (walls.length) {
      const merged = mergeGeometries(walls.map((x) => (x.index ? x.toNonIndexed() : x)))
      g.add(new THREE.Mesh(merged, ctx.mats.stone))
      g.add(new THREE.LineSegments(new THREE.EdgesGeometry(merged, 25), inkLine))
      for (const x of walls) x.dispose()
    }
    return g
  }

  buildTunnel(st) {
    const a = st.fromKm * 1000, b = st.toKm * 1000
    const g = new THREE.Group()
    const [ax, az] = this.centre((a + b) / 2)
    g.position.set(Math.round(ax), 0, Math.round(az))
    const tube = []
    for (let s = a; s <= b; s += 10) { const p = this.pos(s, 0, 2.5); tube.push(p.sub(new THREE.Vector3(g.position.x, 0, g.position.z))) }
    if (tube.length > 1) g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tube), Math.max(8, tube.length * 2), 4.2 + HALF * this.twoAt((a + b) / 2), 12, false), new THREE.MeshBasicMaterial({ color: 0x050506, side: THREE.BackSide })))
    const wide = this.twoAt(a) > 0.5 ? 1.45 : 1
    for (const s of [a, b]) {
      const shape = new THREE.Shape()
      shape.moveTo(-7 * wide, -1); shape.lineTo(7 * wide, -1); shape.lineTo(7 * wide, 9); shape.lineTo(-7 * wide, 9); shape.lineTo(-7 * wide, -1)
      const hole = new THREE.Path(); const r = 4.2 * wide; hole.moveTo(-r, -1); hole.lineTo(-r, 3); hole.absarc(0, 3, r, Math.PI, 0, true); hole.lineTo(r, -1)
      shape.holes.push(hole)
      const portal = this.placeAlong(outlined(new THREE.ShapeGeometry(shape), 0x2b2a27), s, 0, 0)
      portal.position.sub(new THREE.Vector3(g.position.x, 0, g.position.z))
      g.add(portal)
    }
    if (st.name) for (const [s, turn] of [[a, Math.PI], [b, 0]]) {
      const name = String(st.name).replace(/^.*\s-\s/, '')
      const board = this.placeAlong(new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), new THREE.MeshBasicMaterial({ map: textCanvas([name], { size: 80 }) })), s, 0, 11)
      board.rotateY(turn)
      board.position.sub(new THREE.Vector3(g.position.x, 0, g.position.z))
      g.add(board)
    }
    return g
  }

  // ── the land beside it, from the map ───────────────────────────────────────────────────────────────────────────
  // (written in the line's own flat frame; turned into the shared one here, a 2 km square at a time as it is built)
  addScenery(near, ctx) {
    const sc = this.scenery, conv = fromLineFrame(this.data.origin), CELL = 2000
    const cells = new Map()
    const cell = (x, z) => { const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`; if (!cells.has(k)) cells.set(k, { trees: [], houses: [], rivers: [], places: [] }); return cells.get(k) }
    const t = sc.trees || []
    for (let k = 0; k < t.length; k += 2) { const [x, z] = conv(t[k], t[k + 1]); cell(x, z).trees.push(x, z) }
    for (const b of sc.buildings || []) { const [x, z] = conv(b[0], b[1]); cell(x, z).houses.push([x, z, ...b.slice(2)]) }
    for (const rv of sc.rivers || []) {
      const pts = rv.pts.map(([x, z]) => conv(x, z))
      // (a river in pieces of up to forty points, each piece in the square its first point is in)
      for (let i = 0; i < pts.length - 1; i += 39) { const piece = pts.slice(i, i + 40); cell(piece[0][0], piece[0][1]).rivers.push({ w: rv.w, pts: piece }) }
    }
    for (const p of sc.places || []) { const [x, z] = conv(p.x, p.z); cell(x, z).places.push({ ...p, x, z }) }
    for (const [key, c] of cells) {
      const [i, j] = key.split(',').map(Number)
      const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL
      near.add({ kind: 'land', x, z, r: CELL * 0.7, reach: 5000, needsGround: true, build: () => this.buildCell(c, [x, z], ctx) })
    }
    for (const lake of sc.lakes || []) {
      const pts = lake.pts.map(([x, z]) => conv(x, z))
      if (pts.length < 3) continue
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length
      const r = Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[1] - cz)))
      near.add({ kind: 'lake', x: cx, z: cz, r, reach: 9000, needsGround: true, build: () => this.buildLake(pts, [cx, cz], ctx) })
    }
    for (const sg of sc.signals || []) {
      if (sg.s < 40 || sg.s > this.length - 40) continue
      const [x, z] = this.centre(sg.s)
      const signal = { s: sg.s, line: this, lamp: null }
      ctx.signals.push(signal)
      near.add({ kind: 'signal', x, z, reach: 3000, build: () => {
        const g = new THREE.Group()
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4.6, 0.18), solid(0x8d8a84)); post.position.y = 2.3; g.add(post)
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, 0.3), solid(0x15151a)); head.position.y = 4.4; g.add(head)
        signal.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0x25d04d })); signal.lamp.position.set(0, 4.55, 0); g.add(signal.lamp)
        return this.placeAlong(g, sg.s, HALF * this.twoAt(sg.s) + 3.3, 0)
      } })
    }
    for (const cr of sc.crossings || []) {
      if (cr.s < 40 || cr.s > this.length - 40) continue
      const [x, z] = this.centre(cr.s)
      const crossing = { s: cr.s, line: this, arms: [], lamps: [], down: 0 }
      ctx.crossings.push(crossing)
      near.add({ kind: 'crossing', x, z, reach: 3000, build: () => {
        const g = new THREE.Group()
        const road = new THREE.Mesh(new THREE.PlaneGeometry(36, 5.5), solid(0x2a2a2c)); road.rotation.x = -Math.PI / 2; road.position.y = 0.42; g.add(road)
        crossing.arms = []; crossing.lamps = []
        for (const side of [-1, 1]) {
          const w = 4.6 + HALF * this.twoAt(cr.s)
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3, 0.25), solid(0x8d8a84)); post.position.set(side * w, 1.5, -side * 3.4); g.add(post)
          for (const dy of [2.2, 2.75]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0x3a1212 })); l.position.set(side * w + 0.3, dy, -side * 3.4); g.add(l); crossing.lamps.push(l) }
          const pivot = new THREE.Group(); pivot.position.set(side * w, 1.1, -side * 3.4)
          const arm = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.12, 0.12), flat(INK)); arm.position.x = -side * 2.1; pivot.add(arm)
          pivot.rotation.z = side * Math.PI / 2
          g.add(pivot); crossing.arms.push({ pivot, side })
        }
        return this.placeAlong(g, cr.s, 0, 0)
      } })
    }
  }

  buildCell(c, anchor, ctx) {
    const g = new THREE.Group()
    g.position.set(anchor[0], 0, anchor[1])
    const H = (x, z) => ctx.ground.h(x, z) ?? 0
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color()
    // the woods, a tree each
    const n = c.trees.length / 2
    if (n) {
      const crowns = new THREE.InstancedMesh(ctx.geos.crown, ctx.mats.crown, n)
      const trunks = new THREE.InstancedMesh(ctx.geos.trunk, ctx.mats.trunk, n)
      const rng = mulberry(Math.floor(anchor[0] * 7 + anchor[1]))
      const c1 = new THREE.Color(0x173418), c2 = new THREE.Color(0x4a6a24)
      for (let k = 0; k < n; k++) {
        const x = c.trees[k * 2], z = c.trees[k * 2 + 1], sc = 0.7 + rng() * 0.8, broad = rng() < 0.4
        q.setFromAxisAngle(up, rng() * Math.PI * 2)
        const p = new THREE.Vector3(x - anchor[0], H(x, z) - 0.2, z - anchor[1])
        crowns.setMatrixAt(k, m.compose(p, q, new THREE.Vector3(sc * (broad ? 1.5 : 1), sc * (broad ? 0.75 : 0.8 + rng() * 0.6), sc * (broad ? 1.5 : 1))))
        trunks.setMatrixAt(k, m.compose(p, q, new THREE.Vector3(sc, sc, sc)))
        crowns.setColorAt(k, col.copy(c1).lerp(c2, broad ? 0.6 + rng() * 0.4 : rng() * 0.45))
      }
      g.add(crowns, trunks)
    }
    // the houses, their windows lit after dark; a church with a tower and a spire
    if (c.houses.length) {
      const houses = new THREE.InstancedMesh(ctx.geos.house, ctx.mats.house, c.houses.length)
      const churches = c.houses.filter((x) => x[6] === 'church')
      const spires = churches.length ? new THREE.InstancedMesh(ctx.geos.spire, solid(0x3f3b36), churches.length) : null
      let ci = 0
      c.houses.forEach(([x, z, w, d, a, h, kind], k) => {
        q.setFromAxisAngle(up, -a)
        const y = H(x, z) - 0.5, hh = (kind === 'church' ? h * 1.5 : h) + 0.5
        const p = new THREE.Vector3(x - anchor[0], y, z - anchor[1])
        houses.setMatrixAt(k, m.compose(p, q, new THREE.Vector3(w, hh, d)))
        if (kind === 'church' && spires) {
          const tw = Math.min(w, d, 8)
          spires.setMatrixAt(ci++, m.compose(new THREE.Vector3(p.x + Math.cos(a) * (w / 2 - tw / 2), y, p.z + Math.sin(a) * (w / 2 - tw / 2)), q, new THREE.Vector3(tw, hh * 1.5, tw)))
        }
      })
      g.add(houses)
      if (spires) g.add(spires)
    }
    // the rivers, ribbons on the ground
    if (c.rivers.length) {
      const pos = [], idx = []
      let v = 0
      for (const rv of c.rivers) {
        const pts = rv.pts, w = rv.w / 2
        for (let i = 0; i < pts.length; i++) {
          const [x, z] = pts[i], [px, pz] = pts[Math.max(0, i - 1)], [nx, nz] = pts[Math.min(pts.length - 1, i + 1)]
          let dx = nx - px, dz = nz - pz; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L
          const y = H(x, z) + 0.45
          pos.push(x + dz * w - anchor[0], y, z - dx * w - anchor[1], x - dz * w - anchor[0], y, z + dx * w - anchor[1])
          if (i) { const a = v - 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) }
          v += 2
        }
      }
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); rg.setIndex(idx); rg.computeVertexNormals()
      g.add(new THREE.Mesh(rg, ctx.mats.river))
    }
    // the names of the places over them, as on a map
    for (const p of c.places) {
      const big = p.kind === 'city' || p.kind === 'town'
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: textCanvas([p.name, p.kind], { w: 1024, h: 256, size: big ? 120 : 96, box: false, fg: big ? '#f4f2ee' : '#c9c6bf' }), transparent: true, depthTest: false, fog: false }))
      const w = big ? 200 : 110
      sp.scale.set(w, w / 4, 1)
      sp.position.set(p.x - anchor[0], H(p.x, p.z) + (big ? 90 : 48), p.z - anchor[1])
      sp.userData.placeLabel = true
      g.add(sp)
    }
    return g
  }

  buildLake(pts, anchor, ctx) {
    let y = Infinity
    for (const [x, z] of pts) y = Math.min(y, ctx.ground.h(x, z) ?? Infinity)
    if (!Number.isFinite(y)) y = 0
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x - anchor[0], -(z - anchor[1]))))
    const g = new THREE.Group()
    g.position.set(anchor[0], y + 0.4, anchor[1])
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), ctx.mats.lake)
    m.rotation.x = -Math.PI / 2
    g.add(m)
    g.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x - anchor[0], 0.2, z - anchor[1]))), ctx.mats.shore))
    return g
  }
}

/** The things every line draws with, made once. */
export function lineMaterials(HAS) {
  const prof = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0.5, 0.72), new THREE.Vector2(0, 1), new THREE.Vector2(-0.5, 0.72)])
  const house = new THREE.ExtrudeGeometry(prof, { depth: 1, bevelEnabled: false }); house.translate(0, 0, -0.5)
  const out = {
    mats: {
      bed: new THREE.MeshLambertMaterial({ color: 0x3a3833, side: THREE.DoubleSide }),
      rail: new THREE.MeshBasicMaterial({ color: 0xcfcac0, side: THREE.DoubleSide }),
      sleeper: new THREE.MeshLambertMaterial({ color: HAS.sky ? 0x4a443c : 0x6e675c }),
      stone: new THREE.MeshLambertMaterial({ color: 0x4a4741 }),
      fence: new THREE.LineBasicMaterial({ color: 0x8d8a84 }),
      lamp: new THREE.MeshBasicMaterial({ color: GOLD }),
      crown: new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
      trunk: new THREE.MeshLambertMaterial({ color: 0x3b2f24 }),
      house: new THREE.MeshLambertMaterial({ color: 0x3f3b36, emissive: new THREE.Color(GOLD), emissiveIntensity: 0 }),
      river: new THREE.MeshLambertMaterial({ color: 0x1a4a5a, side: THREE.DoubleSide }),
      lake: new THREE.MeshLambertMaterial({ color: 0x0f2d3a, side: THREE.DoubleSide, transparent: true, opacity: 0.92 }),
      shore: new THREE.LineBasicMaterial({ color: 0x2fd1ff, transparent: true, opacity: 0.45 }),
    },
    geos: {
      crown: mergeGeometries([new THREE.ConeGeometry(2.6, 6, 6).translate(0, 4.4, 0), new THREE.ConeGeometry(1.9, 4.2, 6).translate(0, 7.2, 0)]),
      trunk: new THREE.CylinderGeometry(0.22, 0.34, 2.2, 5).translate(0, 1.1, 0),
      house,
      spire: mergeGeometries([new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.ConeGeometry(0.55, 1.2, 4).translate(0, 1.6, 0)]),
    },
  }
  // (kept when a piece is given back: every piece draws with them)
  for (const m of Object.values(out.mats)) m.userData.shared = true
  for (const g of Object.values(out.geos)) g.userData.shared = true
  return out
}

/** A group whose children were placed in the world, moved to a point of its own so its numbers stay small. */
function anchored(g, x, z) {
  g.position.set(Math.round(x), 0, Math.round(z))
  for (const c of g.children) { c.position.x -= g.position.x; c.position.z -= g.position.z }
  return g
}
