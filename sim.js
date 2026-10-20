// A real railway line, driven (Sam, 14 Oct: "a 3D train simulator with actual lines and stations and photos pulled from
// the internet"). Everything it draws is a line's file (../fetchLine.mjs): the track as OpenStreetMap has it, the ground
// as the elevation model has it, the stations where they are, and the photographs people took there, each with its
// credit. It is drawn the way Pino draws: black ground, a white key line, fluorescent colour.
//
// The train runs the line the way a stopping train does: it pulls away, runs up to the line's speed, brakes into each
// station, waits, and at the end of the line turns back. Five ways to look at it (from the cab, behind it, beside it,
// from above it, and the whole line), and time can run faster.

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const INK = 0xf4f2ee, GROUND = 0x0b0b0d, ACID = 0xa7cd07, PINK = 0xe14a89, CYAN = 0x2fd1ff, GOLD = 0xf0c44d
const R = 6371008.8
const rad = (d) => (d * Math.PI) / 180
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const lerp = (a, b, t) => a + (b - a) * t
const $ = (id) => document.getElementById(id)

// the line's own speed, and how a two-car stopping train pulls away and brakes
const LINE_SPEED = 26.8 // m/s, 60 mph
const ACCEL = 0.55, BRAKE = 0.7, DWELL = 40, TURN = 150
const CAR = 23, GAP = 1.2

const params = new URLSearchParams(location.search)
const index = await fetch('./lines/index.json').then((r) => r.json())
const pick = index.lines.find((l) => l.slug === params.get('line')) || index.lines[0]
const line = await fetch(`./lines/${pick.slug}.json`).then((r) => r.json())

// ── where things are ──────────────────────────────────────────────────────────────────────────────────────────────
// metres east (x) and south (z) of the middle of the line; up is up
const o = line.origin
const cosLat = Math.cos(rad(o.lat))
const toXZ = (lat, lon) => [rad(lon - o.lon) * R * cosLat, -rad(lat - o.lat) * R]
const P = line.path.map(([lat, lon, km]) => { const [x, z] = toXZ(lat, lon); return { x, z, s: km * 1000 } })
const LENGTH = P[P.length - 1].s
const step = line.profile.step
function profileAt(arr, s) { const f = clamp(s / step, 0, arr.length - 1), i = Math.floor(f), t = f - i; return lerp(arr[i], arr[Math.min(arr.length - 1, i + 1)], t) }
const BASE = Math.min(...line.profile.ground) - 20
const trackY = (s) => profileAt(line.profile.track, s) - BASE
function seg(s) { let lo = 0, hi = P.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].s <= s) lo = m; else hi = m } return lo }
function at(s) {
  s = clamp(s, 0, LENGTH)
  const i = seg(s), a = P[i], b = P[i + 1] || a, t = (s - a.s) / ((b.s - a.s) || 1)
  return new THREE.Vector3(lerp(a.x, b.x, t), trackY(s), lerp(a.z, b.z, t))
}
function heading(s) { s = clamp(s, 6, LENGTH - 6); const a = at(s - 6), b = at(s + 6); return new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize() }
// left of the way the line runs, as the line's file measures across it
const leftOf = (t) => new THREE.Vector3(t.z, 0, -t.x)
const structureAt = (s) => line.structures.find((x) => s >= x.fromKm * 1000 - 5 && s <= x.toKm * 1000 + 5) || null

// ── the scene ─────────────────────────────────────────────────────────────────────────────────────────────────────
const canvas = $('view')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true })
renderer.setPixelRatio(Math.min(2, devicePixelRatio))
const scene = new THREE.Scene()
scene.background = new THREE.Color(GROUND)
const fog = new THREE.Fog(GROUND, 600, 9000)
scene.fog = fog
const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 400000)
scene.add(new THREE.HemisphereLight(0x9fc2ff, 0x2a2018, 0.9))
const moon = new THREE.DirectionalLight(0xdfe8ff, 1.6)
moon.position.set(-0.4, 0.8, 0.3)
scene.add(moon)

// stars, and a moon, carried with the camera so they are never reached
const sky = new THREE.Group()
scene.add(sky)
{
  const g = new THREE.BufferGeometry(), n = 2500, v = new Float32Array(n * 3), rng = mulberry(7)
  for (let k = 0; k < n; k++) { const th = rng() * Math.PI * 2, ph = Math.acos(rng() * 0.95), r = 40000; v.set([Math.sin(ph) * Math.cos(th) * r, Math.cos(ph) * r, Math.sin(ph) * Math.sin(th) * r], k * 3) }
  g.setAttribute('position', new THREE.BufferAttribute(v, 3))
  const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: INK, size: 1.6, sizeAttenuation: false, fog: false }))
  sky.add(stars)
  const m = new THREE.Mesh(new THREE.CircleGeometry(900, 48), new THREE.MeshBasicMaterial({ color: ACID, fog: false }))
  m.position.set(-16000, 14000, -26000); m.lookAt(0, 0, 0)
  sky.add(m)
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

// ── the ground: the elevation model's rows across the line, and the formation the track sits on ───────────────────
let terrain = null
{
  const rows = line.terrain.rows, OFF = line.terrain.offsets
  const COLS = [-1500, -600, -200, -60, -14, -5, 5, 14, 60, 200, 600, 1500]
  const dem = (row, off) => { for (let j = 1; j < OFF.length; j++) if (off <= OFF[j]) { const t = (off - OFF[j - 1]) / (OFF[j] - OFF[j - 1]); return lerp(row[j - 1], row[j], t) } return row[row.length - 1] }
  const pos = [], col = []
  const lo = Math.min(...rows.flat()), hi = Math.max(...rows.flat())
  const c1 = new THREE.Color(0x23252e), c2 = new THREE.Color(0x4a4733)
  for (let i = 0; i < rows.length; i++) {
    const s = Math.min(LENGTH, i * step), c = at(s), n = leftOf(heading(s)), ty = trackY(s) + BASE
    // (the ground is a row every 250 m, so a hill over a tunnel is only kept where the tunnel is deep inside it: nearer
    // its mouth the row is the cutting that leads to it, or the slope would cover the track short of the portal)
    const st0 = structureAt(s), st = st0?.kind === 'tunnel' && (s - st0.fromKm * 1000 < 200 || st0.toKm * 1000 - s < 200) ? null : st0
    for (const off of COLS) {
      const g = dem(rows[i], off)
      const a = Math.abs(off)
      // the bank or the cutting: the ground pulled to the track near it, unless it is on a bridge or in a tunnel
      const near = st ? 0 : a <= 5 ? 1 : a <= 14 ? 0.85 : a <= 60 ? 0.35 : 0
      const h = lerp(g, ty - 0.7, near) - BASE
      pos.push(c.x + n.x * off, h, c.z + n.z * off)
      const k = clamp((g - lo) / ((hi - lo) || 1), 0, 1)
      const cc = c1.clone().lerp(c2, k)
      col.push(cc.r, cc.g, cc.b)
    }
  }
  const W = COLS.length, idx = []
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < W - 1; j++) { const a = i * W + j, b = a + 1, c = a + W, d = c + 1; idx.push(a, c, b, b, c, d) }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }))
  scene.add(terrain)
  // the drawn lines over it: every row across, and the long lines down it, faint
  const lines = []
  for (let i = 0; i < rows.length; i += 2) for (let j = 0; j < W - 1; j++) { const a = (i * W + j) * 3, b = a + 3; lines.push(pos[a], pos[a + 1] + 0.6, pos[a + 2], pos[b], pos[b + 1] + 0.6, pos[b + 2]) }
  for (let j = 0; j < W; j++) for (let i = 0; i < rows.length - 1; i++) { const a = (i * W + j) * 3, b = a + W * 3; lines.push(pos[a], pos[a + 1] + 0.6, pos[a + 2], pos[b], pos[b + 1] + 0.6, pos[b + 2]) }
  const lg = new THREE.BufferGeometry()
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3))
  scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: ACID, transparent: true, opacity: 0.3 })))
  // and far off, under everything, more black
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400000, 400000), new THREE.MeshBasicMaterial({ color: GROUND }))
  floor.rotation.x = -Math.PI / 2; floor.position.y = -40
  scene.add(floor)
}

// ── the track ─────────────────────────────────────────────────────────────────────────────────────────────────────
const samples = []
for (let s = 0; s <= LENGTH; s += 20) samples.push(s)
if (samples[samples.length - 1] < LENGTH) samples.push(LENGTH)
function ribbon(off0, off1, lift, mat) {
  const pos = [], idx = []
  samples.forEach((s, k) => {
    const c = at(s), n = leftOf(heading(s))
    pos.push(c.x + n.x * off0, c.y + lift, c.z + n.z * off0, c.x + n.x * off1, c.y + lift, c.z + n.z * off1)
    if (k) { const a = (k - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  const m = new THREE.Mesh(g, mat)
  scene.add(m)
  return m
}
ribbon(-2.6, 2.6, 0.02, new THREE.MeshLambertMaterial({ color: 0x3a3833, side: THREE.DoubleSide }))
for (const r of [-0.72, 0.72]) ribbon(r - 0.035, r + 0.035, 0.22, new THREE.MeshBasicMaterial({ color: 0xcfcac0, side: THREE.DoubleSide }))
// the sleepers, only near the train: put down again as it goes
const SLEEPERS = 1400, SPACING = 2.2
const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.16, 0.26), new THREE.MeshLambertMaterial({ color: 0x6e675c }), SLEEPERS)
// (moved every few hundred metres, so never culled by where they first were)
sleepers.frustumCulled = false
scene.add(sleepers)
let sleepersAt = -1e9
function laySleepers(s) {
  if (Math.abs(s - sleepersAt) < 200) return
  sleepersAt = s
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0)
  const s0 = Math.floor((s - (SLEEPERS / 2) * SPACING) / SPACING) * SPACING
  for (let k = 0; k < SLEEPERS; k++) {
    const ss = clamp(s0 + k * SPACING, 0, LENGTH), c = at(ss), t = heading(ss)
    q.setFromAxisAngle(up, Math.atan2(t.x, t.z))
    m.compose(new THREE.Vector3(c.x, c.y + 0.08, c.z), q, new THREE.Vector3(1, 1, 1))
    sleepers.setMatrixAt(k, m)
  }
  sleepers.instanceMatrix.needsUpdate = true
}

// ── what is drawn with the key line ───────────────────────────────────────────────────────────────────────────────
const inkLine = new THREE.LineBasicMaterial({ color: INK })
function outlined(geo, color, { opacity = 1 } = {}) {
  const g = new THREE.Group()
  g.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity })))
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), inkLine))
  return g
}
function placeAlong(obj, s, side = 0, lift = 0) {
  const c = at(s), t = heading(s), n = leftOf(t)
  obj.position.set(c.x + n.x * side, c.y + lift, c.z + n.z * side)
  obj.rotation.y = Math.atan2(t.x, t.z)
  scene.add(obj)
  return obj
}
function textCanvas(lines, { w = 1024, h = 256, bg = '#0b0b0d', fg = '#f4f2ee', accent = '#a7cd07', size = 92 } = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h
  const g = cv.getContext('2d')
  g.fillStyle = bg; g.fillRect(0, 0, w, h)
  g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(6, 6, w - 12, h - 12)
  g.fillStyle = accent; g.fillRect(24, h - 40, w - 48, 12)
  g.fillStyle = fg; g.textBaseline = 'middle'
  lines.forEach((l, k) => { g.font = `${k ? Math.round(size * 0.42) : size}px ui-monospace, Menlo, monospace`; g.fillText(l, 36, k ? h * 0.72 : h * 0.38, w - 72) })
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
  return t
}

// bridges: the deck's parapets and a pier every so often down to the ground under it, arched; tunnels: a portal at each
// end and dark inside
for (const st of line.structures) {
  const a = st.fromKm * 1000, b = st.toKm * 1000
  if (st.kind === 'bridge') {
    for (const side of [-2.9, 2.9]) {
      const pts = []
      for (let s = a; s <= b; s += 5) { const c = at(s), n = leftOf(heading(s)); pts.push(new THREE.Vector3(c.x + n.x * side, c.y + 1.1, c.z + n.z * side)) }
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), inkLine))
    }
    const span = b - a > 200 ? 13.7 : 18
    for (let s = a; s <= b + 0.1; s += span) {
      const c = at(s), gy = profileAt(line.profile.ground, s) - BASE
      const hgt = c.y - gy + 2
      if (hgt < 3) continue
      const pier = outlined(new THREE.BoxGeometry(5.6, hgt, 2.2), 0x4a4741)
      placeAlong(pier, s, 0, -hgt / 2 - 0.4)
      // the arch to the next pier
      const pts = []
      const rise = Math.min(span * 0.45, hgt * 0.4)
      for (let k = 0; k <= 16; k++) { const u = k / 16, ss = s + u * span, cc = at(ss); pts.push(new THREE.Vector3(cc.x, cc.y - 1.6 - rise + Math.sin(u * Math.PI) * rise, cc.z)) }
      if (s + span <= b + 0.1) scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), inkLine))
    }
  } else if (st.kind === 'tunnel') {
    const tube = []
    for (let s = a; s <= b; s += 10) tube.push(at(s).add(new THREE.Vector3(0, 2.5, 0)))
    if (tube.length > 1) scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tube), Math.max(8, tube.length * 2), 4.2, 12, false), new THREE.MeshBasicMaterial({ color: 0x050506, side: THREE.BackSide })))
    for (const s of [a, b]) {
      const shape = new THREE.Shape()
      shape.moveTo(-7, -1); shape.lineTo(7, -1); shape.lineTo(7, 9); shape.lineTo(-7, 9); shape.lineTo(-7, -1)
      const hole = new THREE.Path(); hole.moveTo(-4.2, -1); hole.lineTo(-4.2, 3); hole.absarc(0, 3, 4.2, Math.PI, 0, true); hole.lineTo(4.2, -1)
      shape.holes.push(hole)
      placeAlong(outlined(new THREE.ShapeGeometry(shape), 0x2b2a27), s, 0, 0)
    }
    // its name over each mouth, read by whoever is coming in
    if (st.name) for (const [s, turn] of [[a, Math.PI], [b, 0]]) placeAlong(new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), new THREE.MeshBasicMaterial({ map: textCanvas([st.name], { size: 80 }) })), s, 0, 11).rotateY(turn)
  }
}

// ── stations, and the photographs ─────────────────────────────────────────────────────────────────────────────────
const loader = new THREE.TextureLoader()
loader.setCrossOrigin('anonymous')
const boards = []
function photoBoard(ph, s, side, size = 9) {
  const g = new THREE.Group()
  const w = size, h = size * ((ph.height || 3) / (ph.width || 4))
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x222226, side: THREE.DoubleSide }))
  face.position.y = h / 2 + 3
  g.add(face)
  const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w + 0.4, h + 0.4)), inkLine)
  frame.position.copy(face.position)
  g.add(frame)
  for (const x of [-w * 0.35, w * 0.35]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.2, 0.25), new THREE.MeshLambertMaterial({ color: 0x55524c })); post.position.set(x, 1.6, 0); g.add(post) }
  const credit = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.09), new THREE.MeshBasicMaterial({ map: textCanvas([`${ph.author}`.slice(0, 40), ph.licence], { w: 1024, h: 92, size: 40, accent: '#e14a89' }), side: THREE.DoubleSide }))
  credit.position.y = 2.4
  g.add(credit)
  placeAlong(g, s, side, 0)
  // turned to face whoever is coming up the line
  g.rotateY(side > 0 ? -Math.PI / 2 + 0.5 : Math.PI / 2 - 0.5)
  boards.push({ s, ph, face, loaded: false })
}
const stops = []
line.stations.forEach((st, k) => {
  const s = st.km * 1000, side = k % 2 ? -5.2 : 5.2
  const platform = outlined(new THREE.BoxGeometry(5.2, st.disused ? 0.5 : 1, st.disused ? 70 : 110), st.disused ? 0x232220 : 0x3a3833)
  placeAlong(platform, s, side, st.disused ? 0.15 : 0.5)
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), new THREE.MeshBasicMaterial({ map: textCanvas([st.name, st.disused ? 'closed' : `${(s / 1609.34).toFixed(1)} miles from ${line.from}`], { accent: st.disused ? '#8d8a84' : '#a7cd07' }), side: THREE.DoubleSide }))
  const signPost = new THREE.Group(); sign.position.y = 4.4; signPost.add(sign)
  placeAlong(signPost, s + 18, side + Math.sign(side) * 1.8, 0)
  signPost.rotateY(Math.PI / 2)
  st.photos.forEach((ph, j) => photoBoard(ph, clamp(s - 30 + j * 26, 12, LENGTH - 12), side + Math.sign(side) * 9))
  if (!st.disused) stops.push({ s: clamp(s, 12, LENGTH - 12), name: st.name })
})
// the end of the line, where the track ends short of the terminus the line is named for
if (!stops.length || LENGTH - stops[stops.length - 1].s > 400) stops.push({ s: LENGTH - 30, name: line.to })
if (stops[0].s > 400) stops.unshift({ s: 30, name: line.from })
line.sights.forEach((ph, k) => photoBoard(ph, clamp(ph.km * 1000, 12, LENGTH - 12), (k % 2 ? -1 : 1) * 34, 12))
function loadNear(s) {
  for (const b of boards) {
    if (b.loaded || Math.abs(b.s - s) > 4000) continue
    b.loaded = true
    loader.load(b.ph.thumb, (t) => { t.colorSpace = THREE.SRGBColorSpace; b.face.material.map = t; b.face.material.color.set(0xffffff); b.face.material.needsUpdate = true }, undefined, () => { b.failed = true })
  }
}

// ── the train: two cars, its livery from his plates, the key line round it, lamps lit ─────────────────────────────
function car(lead) {
  const g = new THREE.Group()
  const body = outlined(new THREE.BoxGeometry(2.7, 3.1, CAR), CYAN)
  body.position.y = 2.25
  g.add(body)
  const glass = new THREE.Mesh(new THREE.BoxGeometry(2.74, 0.8, CAR - 3), new THREE.MeshBasicMaterial({ color: 0x07070a }))
  glass.position.y = 2.75
  g.add(glass)
  const band = new THREE.Mesh(new THREE.BoxGeometry(2.76, 0.28, CAR - 0.4), new THREE.MeshBasicMaterial({ color: PINK }))
  band.position.y = 1.55
  g.add(band)
  for (const z of [-CAR / 2 + 0.02, CAR / 2 - 0.02]) {
    const end = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshBasicMaterial({ color: GOLD, side: THREE.DoubleSide }))
    end.position.set(0, 1.6, z + Math.sign(z) * 0.01)
    g.add(end)
  }
  for (const z of [-CAR / 2 + 4, CAR / 2 - 4]) { const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.7, 3), new THREE.MeshLambertMaterial({ color: 0x1b1b1f })); bogie.position.set(0, 0.55, z); g.add(bogie) }
  scene.add(g)
  return g
}
const cars = [car(), car()]
// the lamps, lit at whichever end is leading (at the end of the line the train does not turn: the other end leads)
const lamps = new THREE.Group()
for (const x of [-0.8, 0.8]) { const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.18, 16), new THREE.MeshBasicMaterial({ color: 0xffffee })); lamp.position.set(x, 1.15, CAR / 2 + 0.03); lamps.add(lamp) }
const beam = new THREE.SpotLight(0xfff2cc, 60, 260, 0.38, 0.6, 1.2)
beam.position.set(0, 1.6, CAR / 2)
beam.target.position.set(0, 0, CAR / 2 + 60)
lamps.add(beam, beam.target)
const TRAIN = 2 * CAR + GAP
// on the whole line, where the train is and where the stations are, as marks a fixed size whatever the distance
const mapMarks = new THREE.Group()
{
  const pts = (list, color, size) => { const g = new THREE.BufferGeometry().setFromPoints(list); return new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false })) }
  mapMarks.add(pts(stops.map((st) => at(st.s).add(new THREE.Vector3(0, 30, 0))), ACID, 9))
  mapMarks.userData.train = pts([new THREE.Vector3()], CYAN, 16)
  mapMarks.add(mapMarks.userData.train)
  mapMarks.visible = false
  scene.add(mapMarks)
}

// ── running it ────────────────────────────────────────────────────────────────────────────────────────────────────
const run = { s: stops[0].s + TRAIN, v: 0, dir: 1, next: 1, wait: DWELL, rate: Number(params.get('rate')) || 4, clock: 6 * 3600 + 40 * 60 }
function stepTrain(dt) {
  run.clock += dt
  if (run.wait > 0) { run.wait -= dt; run.v = 0; return }
  const target = stops[run.next]
  const left = (target.s - run.s) * run.dir
  const want = Math.min(LINE_SPEED, Math.sqrt(Math.max(0, 2 * BRAKE * (left - 1))))
  run.v = want > run.v ? Math.min(want, run.v + ACCEL * dt) : Math.max(want, run.v - BRAKE * 1.6 * dt)
  run.s += run.dir * run.v * dt
  if (left <= 1.2 || (run.v < 0.05 && left < 6)) {
    run.s = target.s; run.v = 0
    const end = run.next === stops.length - 1 || run.next === 0
    // the driver walks to the other end: the train stays where it is and its other end leads
    if (end) { run.s -= run.dir * TRAIN; run.dir *= -1; run.wait = TURN; cars.reverse() }
    else run.wait = DWELL
    run.next += run.dir
  }
}
function placeTrain() {
  // the lead car is the end facing the way it is going, and carries the lamps
  if (lamps.parent !== cars[0]) cars[0].add(lamps)
  cars.forEach((c, k) => {
    const mid = run.s - run.dir * (CAR / 2 + k * (CAR + GAP))
    const front = at(mid + run.dir * 8), back = at(mid - run.dir * 8)
    c.position.copy(front).add(back).multiplyScalar(0.5)
    c.lookAt(front)
  })
}

// ── looking at it ─────────────────────────────────────────────────────────────────────────────────────────────────
const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0)
let groundMemo = { x: 1e9, z: 1e9, y: 0 }
function groundAt(x, z) {
  if (Math.hypot(x - groundMemo.x, z - groundMemo.z) < 8) return groundMemo.y
  ray.set(new THREE.Vector3(x, 5000, z), down)
  const hit = terrain ? ray.intersectObject(terrain, false)[0] : null
  groundMemo = { x, z, y: hit ? hit.point.y : -40 }
  return groundMemo.y
}
const CAMS = [['cab', 'cab'], ['chase', 'behind'], ['side', 'beside'], ['drone', 'above'], ['map', 'the line']]
let cam = params.get('cam') || 'chase'
const controls = new OrbitControls(camera, canvas)
controls.enabled = false
const want = { pos: new THREE.Vector3(), look: new THREE.Vector3() }
let mapSet = false, sideAt = null, droneA = 0
function aim(dt) {
  const s = run.s, d = run.dir, t = heading(s).multiplyScalar(d), n = leftOf(heading(s))
  const p = at(s)
  controls.enabled = cam === 'map'
  // the whole line is seen without the night's haze, and the haze comes back down at the train
  scene.fog = cam === 'map' ? null : fog
  mapMarks.visible = cam === 'map'
  if (cam === 'map') mapMarks.userData.train.position.copy(p).add(new THREE.Vector3(0, 40, 0))
  if (cam === 'map') {
    if (!mapSet) {
      const box = new THREE.Box3(); for (const q of P) box.expandByPoint(new THREE.Vector3(q.x, 0, q.z))
      const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3())
      camera.position.set(c.x + size.x * 0.15, Math.max(size.x, size.z) * 1.15, c.z + size.z * 0.6)
      controls.target.copy(c); controls.update(); mapSet = true
    }
    return
  }
  mapSet = false
  if (cam === 'cab') { want.pos.copy(p).addScaledVector(t, 0.5).add(new THREE.Vector3(0, 3.1, 0)); want.look.copy(at(s + d * 80)).add(new THREE.Vector3(0, 2.6, 0)) }
  else if (cam === 'chase') { want.pos.copy(p).addScaledVector(t, -70).add(new THREE.Vector3(0, 16, 0)).addScaledVector(n, 6); want.look.copy(p).addScaledVector(t, 25).add(new THREE.Vector3(0, 2, 0)) }
  else if (cam === 'side') {
    // a spot beside the line ahead of the train, and the train watched going past it, then the next spot
    if (!sideAt || (sideAt.s - s) * d < -120) { const ss = clamp(s + d * 260, 0, LENGTH), q = at(ss), nn = leftOf(heading(ss)); sideAt = { s: ss, pos: q.clone().addScaledVector(nn, 28).add(new THREE.Vector3(0, 4.5, 0)) } }
    want.pos.copy(sideAt.pos); want.look.copy(p).add(new THREE.Vector3(0, 2.5, 0))
  } else { droneA += dt * 0.08; want.pos.copy(p).add(new THREE.Vector3(Math.cos(droneA) * 160, 110, Math.sin(droneA) * 160)); want.look.copy(p) }
  // a camera outside the train is never in a hill: held above the ground under it
  if (cam !== 'cab') want.pos.y = Math.max(want.pos.y, groundAt(want.pos.x, want.pos.z) + (cam === 'drone' ? 70 : 6))
  const k = cam === 'cab' ? 1 : 1 - Math.pow(0.02, dt)
  // (a long way off, as on the first frame or after the whole line, it goes straight there)
  camera.position.lerp(want.pos, cam === 'side' || camera.position.distanceTo(want.pos) > 400 ? 1 : k)
  camera.lookAt(want.look)
}

// ── the panels ────────────────────────────────────────────────────────────────────────────────────────────────────
$('name').textContent = `${line.from} to ${line.to}`
$('about').textContent = line.summary?.text ? line.summary.text.split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.') : ''
for (const [k, label] of CAMS) { const b = document.createElement('button'); b.textContent = label; b.dataset.cam = k; b.onclick = () => { cam = k; sideAt = null; paintButtons() }; $('cams').append(b) }
for (const r of [1, 4, 16, 64]) { const b = document.createElement('button'); b.textContent = `${r}x`; b.dataset.rate = r; b.onclick = () => { run.rate = r; paintButtons() }; $('rates').append(b) }
function paintButtons() {
  for (const b of $('cams').children) b.classList.toggle('on', b.dataset.cam === cam)
  for (const b of $('rates').children) b.classList.toggle('on', Number(b.dataset.rate) === run.rate)
}
paintButtons()
addEventListener('keydown', (e) => { const k = Number(e.key); if (k >= 1 && k <= CAMS.length) { cam = CAMS[k - 1][0]; sideAt = null; paintButtons() } })
$('creditsBtn').onclick = () => { const c = $('credits'); c.style.display = c.style.display === 'block' ? 'none' : 'block' }
{
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
  const photos = [...line.stations.flatMap((st) => st.photos), ...line.sights]
  $('credits').innerHTML = `<button onclick="this.parentNode.style.display='none'">close</button><h3>Where all of it comes from</h3><ul>${line.credits.map((c) => `<li>${esc(c.what)}: ${esc(c.who)} (${esc(c.licence)}) <a href="${esc(c.url)}" target="_blank" rel="noopener">source</a></li>`).join('')}</ul><h3>Photographs</h3><ul>${photos.map((p) => `<li>"${esc(p.title)}" by ${esc(p.author)}, ${esc(p.licence)} <a href="${esc(p.page)}" target="_blank" rel="noopener">source</a></li>`).join('')}</ul>`
}
// the strip: the whole line, its stations, and where the train is
const svg = $('stripSvg')
function drawStrip() {
  const W = svg.clientWidth || 800, H = svg.clientHeight || 46, x = (s) => 14 + (s / LENGTH) * (W - 28)
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
  svg.innerHTML = `<line x1="14" y1="${H / 2}" x2="${W - 14}" y2="${H / 2}" stroke="#f4f2ee" stroke-width="2"/>` +
    line.structures.filter((st) => st.kind === 'bridge' && st.toKm - st.fromKm > 0.15).map((st) => `<line x1="${x(st.fromKm * 1000)}" y1="${H / 2}" x2="${x(st.toKm * 1000)}" y2="${H / 2}" stroke="#e14a89" stroke-width="5"/>`).join('') +
    stops.map((st) => `<circle cx="${x(st.s)}" cy="${H / 2}" r="4" fill="#0b0b0d" stroke="#a7cd07" stroke-width="2"/>`).join('') +
    `<g id="trainDot"><rect x="-7" y="${H / 2 - 9}" width="14" height="18" fill="#2fd1ff" stroke="#f4f2ee" stroke-width="1.5"/></g>`
}
drawStrip()
addEventListener('resize', () => { resize(); drawStrip() })
let shown = null
function panels() {
  const W = svg.clientWidth || 800
  const dot = $('trainDot'); if (dot) dot.setAttribute('transform', `translate(${14 + (run.s / LENGTH) * (W - 28)},0)`)
  const nx = stops[run.next] || stops[stops.length - 1]
  const miles = Math.abs(nx.s - run.s) / 1609.34
  $('next').textContent = run.wait > 0 ? `at ${stops[clamp(run.next - run.dir, 0, stops.length - 1)].name}` : `next: ${nx.name}, ${miles < 0.1 ? 'arriving' : `${miles.toFixed(1)} mi`}`
  $('speed').textContent = Math.round(run.v * 2.23694)
  $('height').textContent = Math.round((trackY(run.s) + BASE) * 3.28084)
  const h = Math.floor(run.clock / 3600) % 24, m = Math.floor(run.clock / 60) % 60
  $('clock').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  $('dir').textContent = run.dir > 0 ? `towards ${line.to}` : `towards ${line.from}`
  // the photo of wherever it is now, as it comes up
  let best = null, bd = 1600
  for (const b of boards) { const d = Math.abs(b.s - run.s); if (d < bd && !b.failed) { bd = d; best = b } }
  if (best !== shown) {
    shown = best
    $('photo').style.display = best ? 'block' : 'none'
    if (best) {
      $('photoImg').src = best.ph.thumb
      $('photoCap').textContent = best.ph.title
      $('photoCredit').innerHTML = ''
      const a = document.createElement('a'); a.href = best.ph.page; a.target = '_blank'; a.rel = 'noopener'; a.textContent = `${best.ph.author}, ${best.ph.licence}`
      $('photoCredit').append('photo: ', a)
    }
  }
}

function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix() }
resize()
$('loading').remove()
for (const id of ['where', 'controls', 'strip']) $(id).hidden = false
let last = performance.now()
let panelT = 0
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000); last = now
  // time runs faster in small steps, so the brakes still meet the platform
  const n = Math.ceil(run.rate)
  for (let k = 0; k < n; k++) stepTrain((dt * run.rate) / n)
  placeTrain()
  laySleepers(run.s)
  loadNear(run.s)
  aim(dt)
  if (cam === 'map') controls.update()
  sky.position.copy(camera.position)
  if ((panelT += dt) > 0.15) { panelT = 0; panels() }
  renderer.render(scene, camera)
})
window.__sim = { run, line, stops, camera, scene, boards, groundAt, at, setCam: (c) => { cam = c; paintButtons() } }
