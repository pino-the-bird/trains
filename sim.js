// A real railway line, driven (Sam, 14 Oct: "a 3D train simulator with actual lines and stations and photos pulled from
// the internet"). Everything it draws is a line's file (../fetchLine.mjs): the track as OpenStreetMap has it, the ground
// as the elevation model has it, the stations where they are, and the photographs people took there, each with its
// credit. It is drawn the way Pino draws: black ground, a white key line, fluorescent colour.
//
// The train runs the line the way a stopping train does: it pulls away, runs up to the line's speed, brakes into each
// station, waits, and at the end of the line turns back. Five ways to look at it (from the cab, behind it, beside it,
// from above it, and the whole line), and time can run faster.
//
// What he has added to it since (world/Trains.js buildFeature, 22 Oct): the page beside this says which, in features.json,
// and each is here behind that flag: dynamic weather (rain that comes and goes, and the haze with it), a night-mode map
// (the whole line dark, the stations lit, the train a lamp), and cargo missions (a loco and three wagons, goods to
// collect at one station and deliver at another, counted).
//
// And the land (24 Oct, Sam: "wide real terrain, a day sky, water, woods, villages and signals"), three more things:
// the ground for miles either side, fetched as elevation tiles while the page runs and drawn with contour lines; the
// sky by the clock, a sun that rises and sets and the light with it; and the scenery from the map (a line's
// .scenery.json, from ../fetchScenery.mjs): rivers and lakes, the woods as trees, the villages as houses with their
// names over them, and the signals and level crossings on the track, working.

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
// what he has added to the simulator, as the page beside it says (nothing, until he has)
const features = await fetch('./features.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
const HAS = { weather: !!features.weather, night: !!features.night, cargo: !!features.cargo, terrain: !!features.terrain, sky: !!features.sky, scenery: !!features.scenery }
// the land beside this line from the map, if it has been fetched
const scenery = HAS.scenery ? await fetch(`./lines/${pick.slug}.scenery.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null

// ── where things are ──────────────────────────────────────────────────────────────────────────────────────────────
// metres east (x) and south (z) of the middle of the line; up is up
const o = line.origin
const cosLat = Math.cos(rad(o.lat))
const toXZ = (lat, lon) => [rad(lon - o.lon) * R * cosLat, -rad(lat - o.lat) * R]
const toLL = (x, z) => [o.lat - (z / R) * (180 / Math.PI), o.lon + (x / (R * cosLat)) * (180 / Math.PI)]
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
// the nearest point of the track to anywhere, by a grid of the track's samples (every 20 m): its chainage and how far
const CELL = 250
const trackCells = new Map()
for (let s = 0; s <= LENGTH; s += 20) { const c = at(s); const k = `${Math.floor(c.x / CELL)},${Math.floor(c.z / CELL)}`; if (!trackCells.has(k)) trackCells.set(k, []); trackCells.get(k).push({ x: c.x, z: c.z, s }) }
function nearTrack(x, z, reach = 1) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL)
  let best = null, bd = Infinity
  for (let i = -reach; i <= reach; i++) for (let j = -reach; j <= reach; j++) {
    const list = trackCells.get(`${cx + i},${cz + j}`)
    if (!list) continue
    for (const p of list) { const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z); if (d < bd) { bd = d; best = p } }
  }
  return best ? { s: best.s, off: Math.sqrt(bd) } : { s: 0, off: Infinity }
}

// ── the scene ─────────────────────────────────────────────────────────────────────────────────────────────────────
const canvas = $('view')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true })
renderer.setPixelRatio(Math.min(2, devicePixelRatio))
const scene = new THREE.Scene()
scene.background = new THREE.Color(GROUND)
const fog = new THREE.Fog(GROUND, 600, 9000)
scene.fog = fog
const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 400000)
const hemi = new THREE.HemisphereLight(0x9fc2ff, 0x2a2018, 0.9)
scene.add(hemi)
const moon = new THREE.DirectionalLight(0xdfe8ff, 1.6)
moon.position.set(-0.4, 0.8, 0.3)
scene.add(moon)
// the sun, by the clock (nothing until he added the sky: the night light above is all there is)
const sun = new THREE.DirectionalLight(0xfff1d6, 0)
scene.add(sun, sun.target)

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

// stars, and a moon, carried with the camera so they are never reached; and the sky itself, once he added it
const sky = new THREE.Group()
scene.add(sky)
let stars = null, dome = null
{
  const g = new THREE.BufferGeometry(), n = 2500, v = new Float32Array(n * 3), rng = mulberry(7)
  for (let k = 0; k < n; k++) { const th = rng() * Math.PI * 2, ph = Math.acos(rng() * 0.95), r = 40000; v.set([Math.sin(ph) * Math.cos(th) * r, Math.cos(ph) * r, Math.sin(ph) * Math.sin(th) * r], k * 3) }
  g.setAttribute('position', new THREE.BufferAttribute(v, 3))
  stars = new THREE.Points(g, new THREE.PointsMaterial({ color: INK, size: 1.6, sizeAttenuation: false, fog: false, transparent: true }))
  sky.add(stars)
  const m = new THREE.Mesh(new THREE.CircleGeometry(900, 48), new THREE.MeshBasicMaterial({ color: ACID, fog: false, transparent: true }))
  m.position.set(-16000, 14000, -26000); m.lookAt(0, 0, 0)
  sky.add(m)
  sky.userData.moon = m
}
// the sky: a dome round the camera, its colour from where the sun is (the same sums as skyColours below, which give
// the fog and the lights their colour on the CPU)
const SKY_FRAG = `
  uniform vec3 uSun; uniform float uRain; varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);
    float e = uSun.y;
    float day = smoothstep(0.02, 0.35, e);
    float dusk = 1.0 - smoothstep(0.12, 0.4, abs(e));
    vec3 zen = mix(vec3(0.02, 0.02, 0.045), vec3(0.17, 0.37, 0.72), day);
    zen = mix(zen, vec3(0.14, 0.11, 0.30), dusk * 0.7);
    vec3 hor = mix(vec3(0.07, 0.07, 0.10), vec3(0.72, 0.79, 0.87), day);
    hor = mix(hor, vec3(0.96, 0.55, 0.30), dusk * (0.55 + 0.45 * max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0)));
    vec3 c = mix(hor, zen, pow(h, 0.55));
    float sd = max(dot(d, normalize(uSun)), 0.0);
    c += vec3(1.0, 0.92, 0.75) * pow(sd, 600.0) * 1.4 * smoothstep(-0.04, 0.02, e);
    c += vec3(1.0, 0.7, 0.4) * pow(sd, 10.0) * 0.22 * dusk;
    c = mix(c, hor * 0.9, uRain * 0.65);
    gl_FragColor = vec4(c, 1.0);
  }`
const SKY_VERT = 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
const skyU = { uSun: { value: new THREE.Vector3(0, -1, 0) }, uRain: { value: 0 } }
if (HAS.sky) {
  dome = new THREE.Mesh(new THREE.SphereGeometry(60000, 48, 24), new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false }))
  dome.renderOrder = -10
  sky.add(dome)
}
// where the sun is for an hour of the clock: up from half past six to half past seven, east to south to west; and
// the colours of the sky at the horizon and overhead, for the fog and the lights
function sunAt(clock) {
  const h = (clock / 3600) % 24
  const u = (h - 6.5) / 13
  const el = Math.sin(u * Math.PI) * rad(56), th = u * Math.PI
  return new THREE.Vector3(Math.cos(el) * Math.cos(th), Math.sin(el), Math.cos(el) * Math.sin(th))
}
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
function skyColours(e) {
  const day = sm(0.02, 0.35, e), dusk = 1 - sm(0.12, 0.4, Math.abs(e))
  const zen = new THREE.Color(0.02, 0.02, 0.045).lerp(new THREE.Color(0.17, 0.37, 0.72), day).lerp(new THREE.Color(0.14, 0.11, 0.30), dusk * 0.7)
  const hor = new THREE.Color(0.07, 0.07, 0.10).lerp(new THREE.Color(0.72, 0.79, 0.87), day).lerp(new THREE.Color(0.96, 0.55, 0.30), dusk * 0.75)
  return { day, dusk, zen, hor }
}
let daylight = 0
function sunStep() {
  if (!HAS.sky) return
  const d = sunAt(run.clock)
  skyU.uSun.value.copy(d)
  skyU.uRain.value = weather.rain
  const { day, dusk, zen, hor } = skyColours(d.y)
  daylight = day
  sun.position.copy(d).multiplyScalar(5000).add(camera.position)
  sun.target.position.copy(camera.position)
  sun.intensity = Math.max(0, d.y) * 3.4 * (1 - weather.rain * 0.6)
  sun.color.set(0xfff1d6).lerp(new THREE.Color(1, 0.55, 0.3), dusk)
  moon.intensity = 1.6 * (1 - day)
  hemi.color.copy(zen).lerp(new THREE.Color(0x9fc2ff), 1 - day).multiplyScalar(lerp(1, 1.6, day))
  hemi.intensity = lerp(0.9, 1.7, day)
  stars.material.opacity = 1 - day
  sky.userData.moon.material.opacity = 1 - day
  if (!nightMap) fog.color.copy(hor).lerp(new THREE.Color(GROUND), (1 - day) * 0.5)
  if (!nightMap) scene.background.copy(fog.color)
}

// the wide ground's colours and its contour lines, used by the near ground too once the tiles are in
const contourMat = (vertexColors) => {
  const m = new THREE.MeshLambertMaterial({ vertexColors, side: THREE.DoubleSide })
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBase = { value: BASE }
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vH;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = position.y;')
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vH; uniform float uBase;').replace('#include <dithering_fragment>', `#include <dithering_fragment>
      float hh = vH + uBase;
      float w25 = fwidth(hh / 25.0) * 1.2, w100 = fwidth(hh / 100.0) * 1.2;
      float thin = 1.0 - smoothstep(0.0, w25 * 1.5, abs(fract(hh / 25.0 + 0.5) - 0.5));
      float thick = 1.0 - smoothstep(0.0, w100 * 1.5, abs(fract(hh / 100.0 + 0.5) - 0.5));
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.655, 0.804, 0.027), thin * 0.22 + thick * 0.3);`)
  }
  return m
}
function heightBand(h, slope) {
  // the colour of the ground by its height and how steep it is: dark in the valleys, warmer up the fells, grey where
  // it is steep, pale on the tops
  const c = new THREE.Color(0x2a3a27).lerp(new THREE.Color(0x5c5a34), clamp((h - 60) / 320, 0, 1)).lerp(new THREE.Color(0x7d7668), clamp((h - 450) / 350, 0, 1))
  return c.lerp(new THREE.Color(0x44444a), clamp(slope * 2.2 - 0.3, 0, 0.6))
}
// ── the ground: the elevation model's rows across the line, and the formation the track sits on ───────────────────
// (with the wide terrain in, this is the near ground only, the cutting and the bank; the tiles take over past it)
let terrain = null, terrainLines = null
{
  const rows = line.terrain.rows, OFF = line.terrain.offsets
  const COLS = HAS.terrain ? [-60, -14, -5, 5, 14, 60] : [-1500, -600, -200, -60, -14, -5, 5, 14, 60, 200, 600, 1500]
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
      // (the same colours as the wide ground, once it is there, so the join does not show)
      const cc = HAS.terrain ? heightBand(g, 0) : c1.clone().lerp(c2, k)
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
  terrain = new THREE.Mesh(g, HAS.terrain ? contourMat(true) : new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }))
  scene.add(terrain)
  // the drawn lines over it: every row across, and the long lines down it, faint
  const lines = []
  for (let i = 0; i < rows.length; i += 2) for (let j = 0; j < W - 1; j++) { const a = (i * W + j) * 3, b = a + 3; lines.push(pos[a], pos[a + 1] + 0.6, pos[a + 2], pos[b], pos[b + 1] + 0.6, pos[b + 2]) }
  for (let j = 0; j < W; j++) for (let i = 0; i < rows.length - 1; i++) { const a = (i * W + j) * 3, b = a + W * 3; lines.push(pos[a], pos[a + 1] + 0.6, pos[a + 2], pos[b], pos[b + 1] + 0.6, pos[b + 2]) }
  const lg = new THREE.BufferGeometry()
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3))
  terrainLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: ACID, transparent: true, opacity: 0.3 }))
  scene.add(terrainLines)
  // and far off, under everything, more black
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400000, 400000), new THREE.MeshBasicMaterial({ color: GROUND }))
  floor.rotation.x = -Math.PI / 2; floor.position.y = -40
  scene.add(floor)
}
// the ground under anywhere, by the near rows: the line's profile at the nearest point of the track
function groundNear(x, z) {
  const { s, off } = nearTrack(x, z, 2)
  if (!Number.isFinite(off)) return -40
  const i = clamp(Math.round(s / step), 0, line.terrain.rows.length - 1), row = line.terrain.rows[i], OFF = line.terrain.offsets
  // (the rows run across the line both ways; the same side is taken for either, which is near enough for a camera)
  for (let j = OFF.indexOf(0) + 1; j < OFF.length; j++) if (off <= OFF[j]) return lerp(row[j - 1], row[j], (off - OFF[j - 1]) / (OFF[j] - OFF[j - 1])) - BASE
  return row[OFF.length - 1] - BASE
}

// ── the wide ground: elevation tiles, fetched as the page runs, drawn with contour lines ──────────────────────────
// (Mapzen's terrarium tiles on AWS, open to any page: a height in every pixel, 38 m of ground to a pixel at this
// zoom. the tiles the track runs through are drawn finer than the ones beside them; every tile is pulled to the
// formation where it meets the near ground, so the cutting and the bank stay)
const TILES = { z: 12, reach: 5000, list: [], data: new Map(), ready: null, built: 0 }
const tileUrl = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`
const tileXY = (lat, lon, z) => { const n = 2 ** z; return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2) * n] }
const tileLL = (x, y, z) => { const n = 2 ** z; return [(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI, (x / n) * 360 - 180] }
if (HAS.terrain) {
  // which tiles: the ones under the corridor, the track's own first
  const lats = line.path.map((p) => p[0]), lons = line.path.map((p) => p[1])
  const dLat = TILES.reach / 111320, dLon = TILES.reach / (111320 * cosLat)
  const [x0, y1] = tileXY(Math.max(...lats) + dLat, Math.min(...lons) - dLon, TILES.z), [x1, y0] = tileXY(Math.min(...lats) - dLat, Math.max(...lons) + dLon, TILES.z)
  const onTrack = new Set(line.path.map((p) => { const [tx, ty] = tileXY(p[0], p[1], TILES.z); return `${Math.floor(tx)},${Math.floor(ty)}` }))
  const start = tileXY(line.stations[0]?.lat ?? lats[0], line.stations[0]?.lon ?? lons[0], TILES.z)
  for (let x = Math.floor(x0); x <= Math.floor(x1); x++) for (let y = Math.floor(y1); y <= Math.floor(y0); y++) {
    // (a tile with no track in it and none in its neighbours is beyond the corridor's corners: skipped)
    let near = false
    for (let i = -1; i <= 1 && !near; i++) for (let j = -1; j <= 1 && !near; j++) if (onTrack.has(`${x + i},${y + j}`)) near = true
    if (!near) continue
    TILES.list.push({ x, y, fine: onTrack.has(`${x},${y}`), d: Math.hypot(x + 0.5 - start[0], y + 0.5 - start[1]) })
  }
  TILES.list.sort((a, b) => a.d - b.d)
  const decodeTile = async (t) => {
    const r = await fetch(tileUrl(TILES.z, t.x, t.y), { mode: 'cors' })
    if (!r.ok) throw new Error(String(r.status))
    const bmp = await createImageBitmap(await r.blob())
    const cv = document.createElement('canvas'); cv.width = cv.height = 256
    const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0)
    const px = g.getImageData(0, 0, 256, 256).data
    const h = new Float32Array(256 * 256)
    for (let k = 0; k < 256 * 256; k++) h[k] = px[k * 4] * 256 + px[k * 4 + 1] + px[k * 4 + 2] / 256 - 32768
    return h
  }
  const buildTile = (t, h) => {
    const stride = t.fine ? 2 : 4, N = 256 / stride + 1
    const xs = new Float32Array(N), zs = new Float32Array(N)
    for (let k = 0; k < N; k++) { const px = Math.min(255, k * stride); const [lat, lon] = tileLL(t.x + px / 256, t.y + px / 256, TILES.z); const [xx, zz] = toXZ(lat, lon); xs[k] = xx; zs[k] = zz }
    const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3)
    const hAt = (i, j) => h[Math.min(255, j * stride) * 256 + Math.min(255, i * stride)]
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = xs[i], z = zs[j]
      let g = hAt(i, j)
      // into the formation where it meets the near ground
      const { s, off } = nearTrack(x, z, 1)
      if (off < 240) {
        const st0 = structureAt(s), st = st0?.kind === 'tunnel' && (s - st0.fromKm * 1000 < 200 || st0.toKm * 1000 - s < 200) ? null : st0
        const ty = trackY(s) + BASE
        const near = st ? 0 : off <= 5 ? 1 : off <= 14 ? 0.85 : off <= 60 ? 0.35 : 0
        const formation = lerp(g, ty - 0.7, near)
        g = off < 60 ? formation - 1.5 : lerp(formation, g, (off - 60) / 180)
      }
      const k = j * N + i
      pos[k * 3] = x; pos[k * 3 + 1] = g - BASE; pos[k * 3 + 2] = z
      const slope = Math.abs(hAt(Math.min(N - 1, i + 1), j) - hAt(Math.max(0, i - 1), j)) / (2 * stride * 38)
      const c = heightBand(g, slope)
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b
    }
    const idx = []
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = j * N + i, b = a + 1, c = a + N, d = c + 1; idx.push(a, c, b, b, c, d) }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, contourMat(true))
    scene.add(mesh)
    t.mesh = mesh
    TILES.built++
  }
  // a few at a time, nearest first; one built a frame so the train keeps moving
  const queue = [...TILES.list], pending = []
  TILES.ready = new Promise((resolve) => {
    let live = 0, done = 0
    const next = () => {
      while (live < 4 && queue.length) {
        const t = queue.shift(); live++
        decodeTile(t).then((h) => { TILES.data.set(`${t.x},${t.y}`, h); pending.push([t, h]) }, () => { t.failed = true }).finally(() => { live--; done++; if (done === TILES.list.length) resolve(); else next() })
      }
    }
    next()
    if (!TILES.list.length) resolve()
  })
  TILES.pending = pending
  TILES.buildTile = buildTile
}
// the height of the ground from the tiles, between their pixels; the near rows where there is no tile yet
function groundH(x, z) {
  if (HAS.terrain && TILES.data.size) {
    const [lat, lon] = toLL(x, z)
    const [tx, ty] = tileXY(lat, lon, TILES.z)
    const h = TILES.data.get(`${Math.floor(tx)},${Math.floor(ty)}`)
    if (h) {
      const px = clamp((tx - Math.floor(tx)) * 256 - 0.5, 0, 255), py = clamp((ty - Math.floor(ty)) * 256 - 0.5, 0, 255)
      const i = Math.floor(px), j = Math.floor(py), u = px - i, v = py - j, i1 = Math.min(255, i + 1), j1 = Math.min(255, j + 1)
      return lerp(lerp(h[j * 256 + i], h[j * 256 + i1], u), lerp(h[j1 * 256 + i], h[j1 * 256 + i1], u), v) - BASE
    }
  }
  return groundNear(x, z)
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
const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.16, 0.26), new THREE.MeshLambertMaterial({ color: HAS.sky ? 0x4a443c : 0x6e675c }), SLEEPERS)
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
function textCanvas(lines, { w = 1024, h = 256, bg = '#0b0b0d', fg = '#f4f2ee', accent = '#a7cd07', size = 92, box = true } = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h
  const g = cv.getContext('2d')
  if (box) {
    g.fillStyle = bg; g.fillRect(0, 0, w, h)
    g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(6, 6, w - 12, h - 12)
    g.fillStyle = accent; g.fillRect(24, h - 40, w - 48, 12)
  }
  g.fillStyle = fg; g.textBaseline = 'middle'
  lines.forEach((l, k) => { g.font = `${k ? Math.round(size * 0.42) : size}px ui-monospace, Menlo, monospace`; if (!box) { g.textAlign = 'center'; g.fillText(l, w / 2, k ? h * 0.78 : h * 0.4, w - 40) } else g.fillText(l, 36, k ? h * 0.72 : h * 0.38, w - 72) })
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
const platformLamps = []
line.stations.forEach((st, k) => {
  const s = st.km * 1000, side = k % 2 ? -5.2 : 5.2
  const platform = outlined(new THREE.BoxGeometry(5.2, st.disused ? 0.5 : 1, st.disused ? 70 : 110), st.disused ? 0x232220 : 0x3a3833)
  placeAlong(platform, s, side, st.disused ? 0.15 : 0.5)
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), new THREE.MeshBasicMaterial({ map: textCanvas([st.name, st.disused ? 'closed' : `${(s / 1609.34).toFixed(1)} miles from ${line.from}`], { accent: st.disused ? '#8d8a84' : '#a7cd07' }), side: THREE.DoubleSide }))
  const signPost = new THREE.Group(); sign.position.y = 4.4; signPost.add(sign)
  placeAlong(signPost, s + 18, side + Math.sign(side) * 1.8, 0)
  signPost.rotateY(Math.PI / 2)
  // platform lamps, lit after dark once the sky is his
  if (HAS.sky && !st.disused) for (const d of [-40, -14, 14, 40]) {
    const lamp = new THREE.Group()
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 5, 0.16), new THREE.MeshLambertMaterial({ color: 0x55524c })); post.position.y = 2.5; lamp.add(post)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), new THREE.MeshBasicMaterial({ color: GOLD })); head.position.y = 5.1; lamp.add(head)
    placeAlong(lamp, s + d, side + Math.sign(side) * 2.2, 1)
    platformLamps.push(head)
  }
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

// ── the land beside the line, from the map ────────────────────────────────────────────────────────────────────────
// (built once the tiles are in, so everything stands on the real ground; the signals and the crossings are on the
// track and go up at once)
const signals = [], crossings = []
const houseMat = new THREE.MeshLambertMaterial({ color: 0x3f3b36, emissive: new THREE.Color(GOLD), emissiveIntensity: 0 })
let placeLabels = []
if (scenery) {
  for (const sg of scenery.signals || []) {
    if (sg.s < 40 || sg.s > LENGTH - 40) continue
    const g = new THREE.Group()
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4.6, 0.18), new THREE.MeshLambertMaterial({ color: 0x8d8a84 })); post.position.y = 2.3; g.add(post)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, 0.3), new THREE.MeshLambertMaterial({ color: 0x15151a })); head.position.y = 4.4; g.add(head)
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0x25d04d })); lamp.position.set(0, 4.55, 0); g.add(lamp)
    placeAlong(g, sg.s, 3.3, 0)
    signals.push({ s: sg.s, lamp })
  }
  for (const cr of scenery.crossings || []) {
    if (cr.s < 40 || cr.s > LENGTH - 40) continue
    const g = new THREE.Group()
    const road = new THREE.Mesh(new THREE.PlaneGeometry(36, 5.5), new THREE.MeshLambertMaterial({ color: 0x2a2a2c })); road.rotation.x = -Math.PI / 2; road.position.y = 0.42; g.add(road)
    const arms = [], lamps = []
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3, 0.25), new THREE.MeshLambertMaterial({ color: 0x8d8a84 })); post.position.set(side * 4.6, 1.5, -side * 3.4); g.add(post)
      for (const dy of [2.2, 2.75]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0x3a1212 })); l.position.set(side * 4.6 + 0.3, dy, -side * 3.4); g.add(l); lamps.push(l) }
      const pivot = new THREE.Group(); pivot.position.set(side * 4.6, 1.1, -side * 3.4)
      const arm = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: INK })); arm.position.x = -side * 2.1; pivot.add(arm)
      pivot.rotation.z = side * Math.PI / 2
      g.add(pivot); arms.push({ pivot, side })
    }
    placeAlong(g, cr.s, 0, 0)
    crossings.push({ s: cr.s, arms, lamps, down: 0 })
  }
}
let sceneryBuilt = false
function buildScenery() {
  if (sceneryBuilt || !scenery) return
  sceneryBuilt = true
  // the lakes, flat at the lowest of their shore
  for (const lake of scenery.lakes || []) {
    const pts = lake.pts
    if (pts.length < 3) continue
    let y = Infinity
    for (const [x, z] of pts) y = Math.min(y, groundH(x, z))
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)))
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ color: 0x0f2d3a, side: THREE.DoubleSide, transparent: true, opacity: 0.92 }))
    m.rotation.x = -Math.PI / 2; m.position.y = y + 0.4
    scene.add(m)
    const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, y + 0.6, z))), new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.45 }))
    scene.add(edge)
  }
  // the rivers, ribbons on the ground
  {
    const pos = [], idx = []
    let v = 0
    for (const rv of scenery.rivers || []) {
      const pts = rv.pts, w = rv.w / 2
      for (let i = 0; i < pts.length; i++) {
        const [x, z] = pts[i], [px, pz] = pts[Math.max(0, i - 1)], [nx, nz] = pts[Math.min(pts.length - 1, i + 1)]
        let dx = nx - px, dz = nz - pz; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L
        const y = groundH(x, z) + 0.45
        pos.push(x + dz * w, y, z - dx * w, x - dz * w, y, z + dx * w)
        if (i) { const a = v - 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) }
        v += 2
      }
    }
    if (pos.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals()
      scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x1a4a5a, side: THREE.DoubleSide })))
    }
  }
  // the woods, a tree each
  {
    const t = scenery.trees || [], n = t.length / 2
    if (n) {
      const geo = new THREE.ConeGeometry(2.6, 8, 5)
      geo.translate(0, 4, 0)
      const trees = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), n)
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c1 = new THREE.Color(0x1c3a1b), c2 = new THREE.Color(0x3d5a22), col = new THREE.Color()
      const rng = mulberry(31)
      for (let k = 0; k < n; k++) {
        const x = t[k * 2], z = t[k * 2 + 1], sc = 0.7 + rng() * 0.8
        q.setFromAxisAngle(up, rng() * Math.PI * 2)
        m.compose(new THREE.Vector3(x, groundH(x, z) - 0.2, z), q, new THREE.Vector3(sc, sc * (0.8 + rng() * 0.6), sc))
        trees.setMatrixAt(k, m)
        trees.setColorAt(k, col.copy(c1).lerp(c2, rng()))
      }
      trees.instanceMatrix.needsUpdate = true
      scene.add(trees)
    }
  }
  // the houses, their windows lit after dark
  {
    const b = scenery.buildings || []
    if (b.length) {
      const geo = new THREE.BoxGeometry(1, 1, 1)
      geo.translate(0, 0.5, 0)
      const houses = new THREE.InstancedMesh(geo, houseMat, b.length)
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0)
      b.forEach(([x, z, w, d, a, h, kind], k) => {
        q.setFromAxisAngle(up, -a)
        m.compose(new THREE.Vector3(x, groundH(x, z) - 0.5, z), q, new THREE.Vector3(w, (kind === 'church' ? h * 1.6 : h) + 0.5, d))
        houses.setMatrixAt(k, m)
      })
      houses.instanceMatrix.needsUpdate = true
      scene.add(houses)
    }
  }
  // the names of the places, over them, as on a map
  for (const p of scenery.places || []) {
    const big = p.kind === 'city' || p.kind === 'town'
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: textCanvas([p.name, p.kind], { w: 1024, h: 256, size: big ? 120 : 96, box: false, fg: big ? '#f4f2ee' : '#c9c6bf' }), transparent: true, depthTest: false, fog: false }))
    const w = big ? 200 : 110
    sp.scale.set(w, w / 4, 1)
    sp.position.set(p.x, groundH(p.x, p.z) + (big ? 90 : 48), p.z)
    scene.add(sp)
    placeLabels.push(sp)
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
let cars = [car(), car()]
// the lamps, lit at whichever end is leading (at the end of the line the train does not turn: the other end leads)
const lamps = new THREE.Group()
for (const x of [-0.8, 0.8]) { const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.18, 16), new THREE.MeshBasicMaterial({ color: 0xffffee })); lamp.position.set(x, 1.15, CAR / 2 + 0.03); lamps.add(lamp) }
const beam = new THREE.SpotLight(0xfff2cc, 60, 260, 0.38, 0.6, 1.2)
beam.position.set(0, 1.6, CAR / 2)
beam.target.position.set(0, 0, CAR / 2 + 60)
lamps.add(beam, beam.target)
let TRAIN = 2 * CAR + GAP
// on the whole line, where the train is and where the stations are, as marks a fixed size whatever the distance
const mapMarks = new THREE.Group()
{
  const pts = (list, color, size) => { const g = new THREE.BufferGeometry().setFromPoints(list); return new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false })) }
  mapMarks.userData.stations = pts(stops.map((st) => at(st.s).add(new THREE.Vector3(0, 30, 0))), ACID, 9)
  mapMarks.add(mapMarks.userData.stations)
  mapMarks.userData.train = pts([new THREE.Vector3()], CYAN, 16)
  mapMarks.add(mapMarks.userData.train)
  mapMarks.visible = false
  scene.add(mapMarks)
}

// ── what he has added ──────────────────────────────────────────
// dynamic weather: rain that comes and goes on its own clock, and the haze that comes with it. nothing in it is
// real weather; it is the line's own, seeded by the line, so a run is not the same run twice
const weather = { rain: 0, want: 0, until: 0, rng: mulberry(line.path.length * 7 + 3) }
const rain = new THREE.Group()
let rainPts = null
if (HAS.weather) {
  const n = 2600, v = new Float32Array(n * 3), r = weather.rng
  for (let k = 0; k < n; k++) v.set([(r() - 0.5) * 140, r() * 70, (r() - 0.5) * 140], k * 3)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(v, 3))
  rainPts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xaebfd1, size: 1.1, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }))
  rain.add(rainPts)
  scene.add(rain)
}
const WEATHER_WORDS = (k) => (k < 0.15 ? 'clear, the far hills there' : k < 0.6 ? 'drizzle on the glass' : 'rain, the far hills gone')
function weatherStep(dt) {
  if (!HAS.weather) return
  if (run.clock > weather.until) {
    const x = weather.rng()
    weather.want = x < 0.5 ? 0 : x < 0.78 ? 0.4 : 1
    weather.until = run.clock + 600 + weather.rng() * 1500
  }
  weather.rain += (weather.want - weather.rain) * Math.min(1, dt * 0.25)
  const k = weather.rain
  // (with the wide ground in, the clear day sees a long way)
  fog.near = lerp(HAS.terrain ? 1200 : 600, 160, k); fog.far = lerp(HAS.terrain ? 16000 : 9000, 1600, k)
  if (!rainPts) return
  rainPts.material.opacity = k * 0.85
  rain.position.copy(camera.position)
  const a = rainPts.geometry.attributes.position.array
  const fall = dt * 38
  for (let i = 1; i < a.length; i += 3) { a[i] -= fall; if (a[i] < 0) a[i] += 70 }
  rainPts.geometry.attributes.position.needsUpdate = true
}
if (HAS.terrain) { fog.near = 1200; fog.far = 16000 }

// a night-mode map: the whole line dark, the stations lit, the train a lamp on it
let nightMap = false
function paintNight() {
  const st = mapMarks.userData.stations
  st.material.color.set(nightMap ? GOLD : ACID); st.material.size = nightMap ? 15 : 9
  mapMarks.userData.train.material.color.set(nightMap ? 0xfff2cc : CYAN); mapMarks.userData.train.material.size = nightMap ? 22 : 16
  if (terrainLines) terrainLines.material.opacity = nightMap ? 0.08 : 0.3
  scene.background.set(nightMap ? 0x050507 : GROUND)
  if (dome) dome.visible = !nightMap
}

// cargo missions: a loco and three wagons, goods to collect at one station and deliver at another, counted
const GOODS = ['limestone', 'timber', 'fertiliser', 'parcels', 'milk', 'coal', 'gypsum', 'cement']
const cargo = { on: false, from: null, to: null, goods: null, loaded: false, done: 0, rng: mulberry(line.path.length * 11 + 5) }
function wagon() {
  const g = new THREE.Group()
  const body = outlined(new THREE.BoxGeometry(2.6, 2.2, CAR - 2), GOLD)
  body.position.y = 1.9
  g.add(body)
  for (const z of [-CAR / 2 + 4, CAR / 2 - 4]) { const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.7, 3), new THREE.MeshLambertMaterial({ color: 0x1b1b1f })); bogie.position.set(0, 0.45, z); g.add(bogie) }
  scene.add(g)
  return g
}
function consist(freight) {
  for (const c of cars) { if (c.children.includes(lamps)) c.remove(lamps); scene.remove(c) }
  cars = freight ? [car(), wagon(), wagon(), wagon()] : [car(), car()]
  TRAIN = cars.length * CAR + (cars.length - 1) * GAP
}
function newMission() {
  const n = stops.length
  let a = Math.floor(cargo.rng() * n), b = Math.floor(cargo.rng() * n)
  if (n > 2) { let guard = 0; while (Math.abs(a - b) < 2 && guard++ < 20) b = Math.floor(cargo.rng() * n) }
  else b = (a + 1) % n
  cargo.from = a; cargo.to = b; cargo.goods = GOODS[Math.floor(cargo.rng() * GOODS.length)]; cargo.loaded = false
}
function onArrive(i) {
  if (!cargo.on) return
  if (!cargo.loaded && i === cargo.from) cargo.loaded = true
  else if (cargo.loaded && i === cargo.to) { cargo.done++; newMission() }
}
function cargoWords() {
  if (!cargo.on) return ''
  const where = stops[cargo.loaded ? cargo.to : cargo.from]?.name || ''
  return `cargo: ${cargo.loaded ? `${cargo.goods} on, for ${where}` : `${cargo.goods} to collect at ${where}`}${cargo.done ? `, ${cargo.done} delivered` : ''}`
}

// the signals and the crossings, working: a signal behind the train shows red while it is in the block, the one
// before a stop shows a caution; a crossing's barriers come down and its lamps flash as the train comes
function signalsStep(dt) {
  if (!scenery) return
  const s = run.s, d = run.dir
  const nextStop = stops[run.next]
  for (const sg of signals) {
    const ahead = (sg.s - s) * d
    let c = 0x25d04d
    if (ahead < 0 && ahead > -1500) c = 0xff2a2a
    else if (nextStop && ahead > 0 && (nextStop.s - sg.s) * d > 0 && (nextStop.s - sg.s) * d < 1800) c = 0xffc23a
    sg.lamp.material.color.set(c)
  }
  for (const cr of crossings) {
    const near = Math.abs(cr.s - s) < 900 || (run.v > 0 && (cr.s - s) * d > 0 && (cr.s - s) * d < 900)
    cr.down += ((near ? 1 : 0) - cr.down) * Math.min(1, dt * 0.9)
    for (const { pivot, side } of cr.arms) pivot.rotation.z = side * (Math.PI / 2) * (1 - cr.down)
    const flash = near && Math.floor(run.clock * 1.6) % 2 === 0
    cr.lamps.forEach((l, k) => l.material.color.set(near ? ((k % 2 === 0) === flash ? 0xff2a2a : 0x3a1212) : 0x3a1212))
  }
}

// ── running it ────────────────────────────────────────────────────────────────────────────────────────────────────
const run = { s: stops[0].s + TRAIN, v: 0, dir: 1, next: 1, wait: DWELL, rate: Number(params.get('rate')) || 4, clock: 6 * 3600 + 40 * 60 }
if (params.get('hour')) run.clock = Number(params.get('hour')) * 3600
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
    onArrive(run.next)
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
  let y
  if (HAS.terrain && TILES.data.size) y = Math.max(groundH(x, z), nearTrack(x, z, 1).off < 240 ? groundNear(x, z) : -1e9)
  else {
    ray.set(new THREE.Vector3(x, 5000, z), down)
    const hit = terrain ? ray.intersectObject(terrain, false)[0] : null
    y = hit ? hit.point.y : -40
  }
  groundMemo = { x, z, y }
  return y
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
if (HAS.night || HAS.cargo) {
  if (HAS.night) { const b = document.createElement('button'); b.textContent = 'night map'; b.dataset.feat = 'night'; b.onclick = () => { nightMap = !nightMap; paintNight(); if (nightMap) { cam = 'map'; sideAt = null } paintButtons() }; $('feats').append(b) }
  if (HAS.cargo) { const b = document.createElement('button'); b.textContent = 'cargo'; b.dataset.feat = 'cargo'; b.onclick = () => { cargo.on = !cargo.on; consist(cargo.on); if (cargo.on) newMission(); paintButtons() }; $('feats').append(b) }
  $('feats').hidden = false
}
// the hour, once the sky is his: the clock jumps and the run goes on
const HOURS = [['dawn', 6.6], ['morning', 9.5], ['noon', 12.5], ['evening', 17.5], ['dusk', 19.2], ['night', 23.3]]
if (HAS.sky && $('times')) {
  for (const [label, h] of HOURS) { const b = document.createElement('button'); b.textContent = label; b.dataset.hour = h; b.onclick = () => { run.clock = Math.floor(run.clock / 86400) * 86400 + h * 3600; paintButtons() }; $('times').append(b) }
  $('times').hidden = false
}
function paintButtons() {
  for (const b of $('cams').children) b.classList.toggle('on', b.dataset.cam === cam)
  for (const b of $('feats').children) b.classList.toggle('on', b.dataset.feat === 'night' ? nightMap : cargo.on)
  for (const b of $('rates').children) b.classList.toggle('on', Number(b.dataset.rate) === run.rate)
  if ($('times')) { const h = (run.clock / 3600) % 24; for (const b of $('times').children) b.classList.toggle('on', Math.abs(Number(b.dataset.hour) - h) < 1.2) }
}
paintButtons()
addEventListener('keydown', (e) => { const k = Number(e.key); if (k >= 1 && k <= CAMS.length) { cam = CAMS[k - 1][0]; sideAt = null; paintButtons() } })
$('creditsBtn').onclick = () => { const c = $('credits'); c.style.display = c.style.display === 'block' ? 'none' : 'block' }
{
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
  const photos = [...line.stations.flatMap((st) => st.photos), ...line.sights]
  const credits = [...line.credits, ...(HAS.terrain ? [{ what: 'the ground for miles either side', who: 'Mapzen terrarium tiles (SRTM, EU-DEM and others), via AWS Open Data', licence: 'as each source says', url: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md' }] : []), ...(scenery?.credit ? [scenery.credit] : [])]
  $('credits').innerHTML = `<button onclick="this.parentNode.style.display='none'">close</button><h3>Where all of it comes from</h3><ul>${credits.map((c) => `<li>${esc(c.what)}: ${esc(c.who)} (${esc(c.licence)}) <a href="${esc(c.url)}" target="_blank" rel="noopener">source</a></li>`).join('')}</ul><h3>Photographs</h3><ul>${photos.map((p) => `<li>"${esc(p.title)}" by ${esc(p.author)}, ${esc(p.licence)} <a href="${esc(p.page)}" target="_blank" rel="noopener">source</a></li>`).join('')}</ul>`
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
  const ground = HAS.terrain && TILES.list.length && TILES.built < TILES.list.length ? `the ground coming in, ${TILES.built} of ${TILES.list.length} tiles` : ''
  $('extra').textContent = [HAS.weather ? WEATHER_WORDS(weather.rain) : '', cargoWords(), ground].filter(Boolean).join(' · ')
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
// the scenery stands on the tiles once they are all in (or at once, on the near ground, if there are none)
if (scenery) { if (HAS.terrain && TILES.ready) TILES.ready.then(() => buildScenery()); else buildScenery() }
let last = performance.now()
let panelT = 0
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000); last = now
  // time runs faster in small steps, so the brakes still meet the platform
  const n = Math.ceil(run.rate)
  for (let k = 0; k < n; k++) stepTrain((dt * run.rate) / n)
  placeTrain()
  weatherStep(dt * Math.min(run.rate, 4))
  sunStep()
  signalsStep(dt * Math.min(run.rate, 4))
  // a tile a frame, as they come in
  if (TILES.pending?.length) { const [t, h] = TILES.pending.shift(); buildTileSafe(t, h) }
  // the lamps and the windows, by the light
  if (HAS.sky) {
    const dark = 1 - daylight
    houseMat.emissiveIntensity = 0.16 * dark
    for (const l of platformLamps) l.material.color.set(GOLD).multiplyScalar(0.35 + 0.65 * dark)
  }
  laySleepers(run.s)
  loadNear(run.s)
  aim(dt)
  if (cam === 'map') controls.update()
  sky.position.copy(camera.position)
  if ((panelT += dt) > 0.15) { panelT = 0; panels() }
  renderer.render(scene, camera)
})
function buildTileSafe(t, h) { try { TILES.buildTile(t, h) } catch (err) { console.warn('tile', t.x, t.y, err.message) } }
window.__sim = { run, line, stops, camera, scene, boards, groundAt, groundH, at, setCam: (c) => { cam = c; paintButtons() }, HAS, weather, cargo, night: () => nightMap, TILES, scenery, signals, crossings, sunAt }
