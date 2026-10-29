// Real railway lines, driven (Sam, 14 Oct: "a 3D train simulator with actual lines and stations and photos pulled from
// the internet"). Everything it draws is a line's file (../fetchLine.mjs): the track as OpenStreetMap has it, the ground
// as the elevation model has it, the stations where they are, and the photographs people took there, each with its
// credit. It is drawn the way Pino draws: black ground, a white key line, fluorescent colour.
//
// A train runs a line the way a stopping train does: it pulls away, runs up to the line's speed, brakes into each
// station, waits, and at the end of the line its other end leads back. Five ways to look at it (from the cab, behind
// it, beside it, from above it, and the whole line), and time can run faster.
//
// What he has added since (world/Trains.js buildFeature), each behind its flag in features.json beside the page: the
// weather, a night map, cargo, the real hills, a sky and a sun, the land from the map, the ground seen from space, the
// sound, driving it yourself (22 to 24 Oct). And every line running at once (29 Oct, Sam: "a working uk train
// simulator"): every line he has in one Britain, a day's timetable on each, trains on all of them on the clock of the
// place, a map of the whole railway with every train on it, and any train to ride or drive. Without it, one line and
// his own train going back and forth, as it was.
//
// The parts: geo.js (where things are), draw.js (how they are drawn), line.js (a line), ground.js (the ground),
// kinds.js and stock.js (the trains), railway.js (the timetables and the running of them), map.js (the railway map).

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { toXZ, clamp, lerp, rad, mulberry } from './geo.js'
import { INK, GROUND, ACID, PINK, CYAN, GOLD, Near } from './draw.js'
import { Line, lineMaterials, HALF } from './line.js'
import { Ground, Tracks } from './ground.js'
import { Train3D, glassMat, KINDS, lengthOf } from './stock.js'
import { SimLine, Railway, ukNow, hhmm, ACCEL, BRAKE } from './railway.js'
import { Look } from './look.js'
import { Cab } from './cab.js'
import { Title, lastRun } from './title.js'
import { Signals, Duty, Boards } from './driving.js'
import { Land } from './land.js'
import { Life } from './life.js'
import { RailSound, LineSynth } from './sound.js'
import { Seat } from './seat.js'

const $ = (id) => document.getElementById(id)
const params = new URLSearchParams(location.search)
const index = await fetch('./lines/index.json').then((r) => r.json())
// what he has added to the simulator, as the page beside it says (nothing, until he has)
const features = await fetch('./features.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
const HAS = { weather: !!features.weather, night: !!features.night, cargo: !!features.cargo, terrain: !!features.terrain, sky: !!features.sky, scenery: !!features.scenery, satellite: !!features.satellite && !!features.terrain, sound: !!features.sound, drive: !!features.drive, network: !!features.network, look: !!features.look, cab: !!features.cab, title: !!features.title, phone: !!features.phone, signals: !!features.signals, timetable: !!features.timetable, photo: !!features.photo, land: !!features.land, future: !!features.future, life: !!features.life, ghost: !!features.ghost, sounds: !!features.sounds, synth: !!features.synth, seat: !!features.seat, seasons: !!features.seasons }
// the whole railway: every line's stops, tracks and timetable hints (written by the town beside the page)
// (the title screen reads it too, for its map and its cards, whether or not every line is running)
const netData = HAS.network || HAS.title ? await fetch('./network.json').then((r) => (r.ok ? r.json() : null)).catch(() => null) : null
const network = HAS.network ? netData : null
const NET = !!network?.lines?.length
// the title screen, once he has added it: first, unless a link names a line and goes straight in
const titled = HAS.title && !!netData?.lines?.length && !params.get('line') && !params.get('go')
const metaOf = (slug) => network?.lines?.find((l) => l.slug === slug) || index.lines.find((l) => l.slug === slug) || {}

// (a line whose file does not come says so, and the first that does is run instead: until 29 Oct nine of the lines in
// the list had no file on the page and hung on "laying the track")
const loadJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null)
// (with the title screen, the line he ran last is the one it opens on, running behind it)
let pick = index.lines.find((l) => l.slug === params.get('line')) || (titled && index.lines.find((l) => l.slug === lastRun(netData.lines))) || index.lines[0]
let firstData = await loadJson(`./lines/${pick.slug}.json`), swapped = ''
if (!firstData) {
  const asked = pick
  for (const l of index.lines) { if (l === asked) continue; firstData = await loadJson(`./lines/${l.slug}.json`); if (firstData) { pick = l; break } }
  if (firstData) swapped = `The ${asked.name} is not here yet, so this is the ${pick.name}.`
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
// (in the scene, so what it carries is drawn: the cab, once he has added it)
scene.add(camera)
// the look of the town, once he has added it: drawn small, dithered, the corners snapping (look.js)
const look = HAS.look ? new Look(renderer) : null
if (look && params.get('look') === '0') look.on = false
// a driver's cab round the view from the cab, once he has added it (cab.js)
const cabView = HAS.cab ? new Cab(camera) : null
// a seat by the window, once he has added it (seat.js)
const seatView = HAS.seat ? new Seat(camera) : null
const hemi = new THREE.HemisphereLight(0x9fc2ff, 0x2a2018, 0.9)
scene.add(hemi)
const moon = new THREE.DirectionalLight(0xdfe8ff, 1.6)
scene.add(moon, moon.target)
// the sun, by the clock (nothing until he added the sky: the night light above is all there is)
const sun = new THREE.DirectionalLight(0xfff1d6, 0)
scene.add(sun, sun.target)

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
// where the sun is for an hour of the clock: up from half past six to half past seven, east to south to west
function sunAt(clock) {
  const h = (clock / 3600) % 24
  const u = (h - 6.5) / 13
  const el = Math.sin(u * Math.PI) * rad(56), th = u * Math.PI
  return new THREE.Vector3(Math.cos(el) * Math.cos(th), Math.sin(el), Math.cos(el) * Math.sin(th))
}
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
function skyColours(e) {
  const day = smooth(0.02, 0.35, e), dusk = 1 - smooth(0.12, 0.4, Math.abs(e))
  const zen = new THREE.Color(0.02, 0.02, 0.045).lerp(new THREE.Color(0.17, 0.37, 0.72), day).lerp(new THREE.Color(0.14, 0.11, 0.30), dusk * 0.7)
  const hor = new THREE.Color(0.07, 0.07, 0.10).lerp(new THREE.Color(0.72, 0.79, 0.87), day).lerp(new THREE.Color(0.96, 0.55, 0.30), dusk * 0.75)
  return { day, dusk, zen, hor }
}
let daylight = 0
function sunStep() {
  moon.position.set(-0.4, 0.8, 0.3).multiplyScalar(5000).add(camera.position); moon.target.position.copy(camera.position)
  if (!HAS.sky) return
  const d = sunAt(rail.clock)
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

// ── the lines ─────────────────────────────────────────────────────────────────────────────────────────────────────
const near = new Near(scene)
const tracks = new Tracks()
const ground = new Ground(scene, tracks, HAS)
const ctx = { ground, boards: new Set(), signals: [], crossings: [], ownSignals: HAS.signals, ...lineMaterials(HAS) }
// the seasons, once he has added them: by the month in Britain, snow on the tops down to a height that follows it, the
// woods turning in October and November, low cloud lying in the valleys on a wet day or early in the morning
const month = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', month: 'numeric' }).format(new Date())) - 1
const SNOWLINE = [350, 380, 600, 900, 99999, 99999, 99999, 99999, 99999, 99999, 650, 400]
if (HAS.seasons) { ground.uniforms.uSnow.value = SNOWLINE[month]; ctx.autumn = month === 9 || month === 10 }
const clouds = HAS.seasons ? (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256
  const g = cv.getContext('2d'), rng = mulberry(11)
  for (let k = 0; k < 90; k++) { const x = rng() * 256, y = rng() * 256, r = 18 + rng() * 46, grd = g.createRadialGradient(x, y, 0, x, y, r); grd.addColorStop(0, 'rgba(235,238,242,0.55)'); grd.addColorStop(1, 'rgba(235,238,242,0)'); g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2) }
  const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(10, 10)
  const m = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }))
  m.rotation.x = -Math.PI / 2
  scene.add(m)
  return m
})() : null
// signals you drive by and a timetable to keep, once he has added them (driving.js)
const sigs = HAS.signals ? new Signals(near, ctx) : null
const depBoards = HAS.timetable ? new Boards(near) : null
// the land beside the track, once he has added it (land.js)
const land = HAS.land ? new Land(near, ctx) : null
// life along the line, once he has added it (life.js)
const life = HAS.life ? new Life(near, ctx) : null
const full = new Map()       // slug -> Line, the lines whose whole file is in
let railUp = false           // (the railway is made after the first line is in)
const loading = new Map()
function loadLine(slug, data = null) {
  if (full.has(slug)) return Promise.resolve(full.get(slug))
  if (loading.has(slug)) return loading.get(slug)
  const p = (async () => {
    data = data || await loadJson(`./lines/${slug}.json`)
    if (!data) return null
    const scenery = HAS.scenery ? await loadJson(`./lines/${slug}.scenery.json`) : null
    const meta = metaOf(slug)
    const line = new Line(data, { tracks: meta.tracks, lanes: meta.lanes, speed: meta.speed, kind: meta.kind }, scenery)
    full.set(slug, line)
    tracks.add(line)
    line.addTo(near, ctx)
    sigs?.add(line)
    land?.add(line)
    life?.add(line); life?.crossings(line)
    if (railUp) depBoards?.add(line, simOf(slug))
    // (the ground already in near it is built again, to sit under its strip)
    ground.rebuildNear(...line.centre(line.length / 2), line.length / 2)
    buildOverview(line)
    return line
  })().finally(() => loading.delete(slug))
  loading.set(slug, p)
  return p
}
// the whole line, from above: drawn as a line with its stations and the trains on it
const overview = new THREE.Group()
overview.visible = false
scene.add(overview)
function buildOverview(line) {
  const pts = []
  for (let s = 0; s <= line.length; s += 100) pts.push(line.pos(s, 0, 25))
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: INK, depthTest: false, fog: false }))
  l.renderOrder = 5
  overview.add(l)
  const st = new THREE.Points(new THREE.BufferGeometry().setFromPoints(line.stops.map((x) => line.pos(x.s, 0, 30))), new THREE.PointsMaterial({ color: ACID, size: 9, sizeAttenuation: false, depthTest: false, fog: false }))
  st.renderOrder = 6
  st.userData.stations = true
  overview.add(st)
}
const first = await loadLine(firstData.slug, firstData)

// ── the railway ───────────────────────────────────────────────────────────────────────────────────────────────────
// (every line from the network's file in the one Britain, or the one line on its own)
function simLineOf(meta, line = null) {
  const length = line ? line.length : meta.lengthKm * 1000
  const stops = line ? line.stops.map((s) => ({ s: s.s, name: s.name })) : meta.stops.map((s) => ({ s: s.km * 1000, name: s.name }))
  return new SimLine({ slug: meta.slug, name: meta.name, from: meta.from, to: meta.to, length, stops, tracks: meta.tracks || [], speed: meta.speed || 26.8, every: meta.every || 60, freight: meta.freight || 0, steam: meta.steam || [], kind: meta.kind || 'dmu', future: HAS.future, ghost: HAS.ghost })
}
const simLines = NET ? network.lines.map((m) => simLineOf(m, m.slug === first.slug ? first : null)) : [simLineOf({ ...metaOf(first.slug), slug: first.slug, name: first.name, from: first.data.from, to: first.data.to }, first)]
const rail = new Railway(simLines, { network: NET })
const startClock = params.get('hour') ? Number(params.get('hour')) * 3600 : NET ? ukNow() : 6 * 3600 + 40 * 60
rail.start(startClock)
function simOf(slug) { return simLines.find((l) => l.slug === slug) }
railUp = true
for (const l of full.values()) depBoards?.add(l, simOf(l.slug))
// the train you are with: on the line asked for, one on the move if there is one
function firstOn(slug) {
  const l = simOf(slug)
  const out = l.units.filter((u) => u.phase !== 'stabled')
  return out.find((u) => u.phase === 'run') || out[0] || l.units[0]
}
let follow = firstOn(first.slug)
// a link to a moment (photo mode): the train nearest that far along the line, or his own one put there
if (params.get('at')) {
  const at = Number(params.get('at')) * 1000, l = simOf(first.slug)
  if (NET) { const out = l.units.filter((u) => u.phase !== 'stabled'); if (out.length) follow = out.reduce((a, b) => (Math.abs(b.s - at) < Math.abs(a.s - at) ? b : a)) }
  else { follow.s = clamp(at, follow.len + 2, l.length - 2); follow.phase = 'run'; follow.next = Math.max(0, l.stops.findIndex((x) => x.s > follow.s)) }
}
const lineOf = (u) => full.get(u.line.slug)

// the trains you can see: a train in the world for each unit near the camera, on a line that is in
const shown = new Map()     // unit -> Train3D
function setKind(u, kind) { u.kind = kind; u.len = lengthOf(kind); const t = shown.get(u); if (t) { scene.remove(t.group); t.dispose(); shown.delete(u) } }
const kindAsked = KINDS[params.get('train')] ? params.get('train') : null
if (!NET && kindAsked) setKind(follow, kindAsked)
const smoke = { pts: null, k: 0 }
{
  const n = 160, v = new Float32Array(n * 3).fill(1e9)
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(v, 3))
  smoke.pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xb9b6ae, size: 1.6, sizeAttenuation: true, transparent: true, opacity: 0.28, depthWrite: false }))
  smoke.pts.frustumCulled = false; smoke.pts.visible = false
  scene.add(smoke.pts)
}
const beam = new THREE.SpotLight(0xfff2cc, 60, 260, 0.38, 0.6, 1.2)
scene.add(beam, beam.target)
const _p = new THREE.Vector3()
function placeTrains() {
  const fx = camera.position.x, fz = camera.position.z
  for (const u of rail.units) {
    const line = lineOf(u)
    // (put away for the night, it is in the sidings and not drawn, unless it is the one you are with)
    const want = line && (u.phase !== 'stabled' || u === follow) && (u === follow || (line.pos(u.s, 0, 0, _p), Math.hypot(_p.x - fx, _p.z - fz) < 7000))
    let t = shown.get(u)
    if (!want) { if (t) { scene.remove(t.group); t.dispose(); shown.delete(u) } continue }
    if (!t) { t = new Train3D(u.kind, u.dest); shown.set(u, t); scene.add(t.group) }
    t.place(line, u.s, u.dir, u.side, u.travelled)
    // (from a seat in it, the carriage round you is the seat's own drawing)
    t.group.visible = !(cam === 'seat' && u === follow)
  }
  // the headlamp's beam ahead of the train you are with
  const t = shown.get(follow), line = lineOf(follow)
  if (t && line) {
    line.pos(follow.s, follow.side, 1.6, beam.position)
    line.pos(clamp(follow.s + follow.dir * 60, 0, line.length), follow.side, 0, beam.target.position)
    beam.intensity = 60 * (1 - daylight * 0.9)
  }
  // the smoke, from the chimney of the steam engine you are with, drifting back and up while it works
  smoke.pts.visible = !!t?.steamer
  if (t?.steamer) {
    const a = smoke.pts.geometry.attributes.position.array
    t.steamer.updateMatrixWorld()
    const chimney = t.chimney.clone().applyMatrix4(t.steamer.matrixWorld)
    smoke.k = (smoke.k + 1) % (a.length / 3)
    const puff = follow.v > 0.2 || drive.notch > 0
    a[smoke.k * 3] = puff ? chimney.x : 1e9; a[smoke.k * 3 + 1] = chimney.y; a[smoke.k * 3 + 2] = chimney.z
    const [tx, tz] = line.tangent(follow.s)
    for (let i = 0; i < a.length; i += 3) { if (a[i] > 1e8) continue; a[i] += -follow.dir * tx * 0.5 + (Math.random() - 0.5) * 0.7; a[i + 1] += 0.1 + Math.random() * 0.08; a[i + 2] += -follow.dir * tz * 0.5 + (Math.random() - 0.5) * 0.7; if (a[i + 1] > chimney.y + 14) a[i] = 1e9 }
    smoke.pts.geometry.attributes.position.needsUpdate = true
  }
}
const unitMarks = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: CYAN, size: 12, sizeAttenuation: false, depthTest: false, fog: false }))
unitMarks.renderOrder = 7
overview.add(unitMarks)
const youMark = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]), new THREE.PointsMaterial({ color: PINK, size: 18, sizeAttenuation: false, depthTest: false, fog: false }))
youMark.renderOrder = 8
overview.add(youMark)
function markUnits() {
  const pts = []
  for (const u of rail.units) { const l = lineOf(u); if (l && u.phase !== 'stabled' && u !== follow) pts.push(l.pos(u.s, 0, 40)) }
  unitMarks.geometry.dispose(); unitMarks.geometry = new THREE.BufferGeometry().setFromPoints(pts.length ? pts : [new THREE.Vector3(0, -1e6, 0)])
  const l = lineOf(follow); if (l) { youMark.geometry.attributes.position.setXYZ(0, ...l.pos(follow.s, 0, 45).toArray()); youMark.geometry.attributes.position.needsUpdate = true }
}

// ── what he has added ─────────────────────────────────────────────────────────────────────────────────────────────
// dynamic weather: rain that comes and goes on its own clock, and the haze that comes with it. nothing in it is real
// weather; it is the line's own, seeded by the line, so a run is not the same run twice
const weather = { rain: 0, want: 0, until: 0, rng: mulberry(first.data.path.length * 7 + 3) }
const rain = new THREE.Group()
let rainPts = null
if (HAS.weather) {
  const n = 2600, v = new Float32Array(n * 3), r = weather.rng
  for (let k = 0; k < n; k++) v.set([(r() - 0.5) * 140, r() * 70, (r() - 0.5) * 140], k * 3)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(v, 3))
  rainPts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xaebfd1, size: 1.1, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }))
  rainPts.frustumCulled = false
  rain.add(rainPts)
  scene.add(rain)
}
const WEATHER_WORDS = (k) => (k < 0.15 ? 'clear, the far hills there' : k < 0.6 ? 'drizzle on the glass' : 'rain, the far hills gone')
function weatherStep(dt) {
  if (!HAS.weather) return
  if (rail.clock > weather.until) {
    const x = weather.rng()
    weather.want = x < 0.5 ? 0 : x < 0.78 ? 0.4 : 1
    weather.until = rail.clock + 600 + weather.rng() * 1500
  }
  weather.rain += (weather.want - weather.rain) * Math.min(1, dt * 0.25)
  const k = weather.rain
  // the low cloud: lying a little above the line in the wet and in the early morning, drifting
  if (clouds) {
    const h = (rail.clock / 3600) % 24, want = Math.max(k > 0.3 ? k : 0, h > 5 && h < 9.5 ? 0.6 : 0)
    clouds.material.opacity += (want * 0.85 - clouds.material.opacity) * Math.min(1, dt * 0.1)
    const line = lineOf(follow)
    clouds.position.set(camera.position.x, (line ? line.trackY(follow.s) : 0) + 140, camera.position.z)
    clouds.material.map.offset.x += dt * 0.0006; clouds.visible = clouds.material.opacity > 0.01
  }
  // (snow falling instead of rain, in winter, up where the snow lies)
  const snowing = HAS.seasons && SNOWLINE[month] < 99999 && (lineOf(follow)?.trackY(follow.s) || 0) > SNOWLINE[month] - 150
  fog.near = lerp(HAS.terrain ? 1200 : 600, 160, k); fog.far = lerp(HAS.terrain ? 16000 : 9000, 1600, k)
  if (!rainPts) return
  rainPts.material.opacity = k * 0.85
  rainPts.material.color.set(snowing ? 0xffffff : 0xaebfd1); rainPts.material.size = snowing ? 2 : 1.1
  rain.position.copy(camera.position)
  const a = rainPts.geometry.attributes.position.array
  const fall = dt * (snowing ? 4 : 38)
  for (let i = 1; i < a.length; i += 3) { a[i] -= fall; if (a[i] < 0) a[i] += 70 }
  rainPts.geometry.attributes.position.needsUpdate = true
}
if (HAS.terrain) { fog.near = 1200; fog.far = 16000 }

// a night-mode map: the whole line dark, the stations lit, the trains lamps on it
let nightMap = false
function paintNight() {
  for (const o of overview.children) if (o.userData.stations) { o.material.color.set(nightMap ? GOLD : ACID); o.material.size = nightMap ? 15 : 9 }
  unitMarks.material.color.set(nightMap ? 0xfff2cc : CYAN)
  scene.background.set(nightMap ? 0x050507 : GROUND)
  if (dome) dome.visible = !nightMap
}

// cargo missions: goods to collect at one station and deliver at another, counted, on the train you are with
const GOODS = ['limestone', 'timber', 'fertiliser', 'parcels', 'milk', 'coal', 'gypsum', 'cement']
const cargo = { on: false, from: null, to: null, goods: null, loaded: false, done: 0, rng: mulberry(first.data.path.length * 11 + 5) }
function newMission() {
  const stops = follow.line.stops, n = stops.length
  // (two stations ahead of it, far enough apart to be a trip)
  const ahead = stops.map((_, i) => i).filter((i) => (stops[i].s - follow.s) * follow.dir > 200)
  const pool = ahead.length >= 2 ? ahead : stops.map((_, i) => i)
  const a = pool[Math.floor(cargo.rng() * Math.max(1, pool.length - 1))]
  const later = pool.filter((i) => (i - a) * follow.dir >= 2)
  const b = later.length ? later[Math.floor(cargo.rng() * later.length)] : pool[pool.length - 1]
  cargo.from = a; cargo.to = b === a ? (a + 1) % n : b; cargo.goods = GOODS[Math.floor(cargo.rng() * GOODS.length)]; cargo.loaded = false
}
function onArrive(u, i) {
  if (u !== follow) return
  if (snd.on) snd.rail?.beeps()
  if (HAS.sound) say(`This is ${u.line.stops[i]?.name}.`)
  if (!cargo.on) return
  if (!cargo.loaded && i === cargo.from) cargo.loaded = true
  else if (cargo.loaded && i === cargo.to) { cargo.done++; newMission() }
}
function onDepart(u) {
  if (u !== follow || !HAS.sound) return
  if (snd.on) snd.rail?.beeps()
  const nx = u.line.stops[u.next]
  if (nx) say(`This train is for ${u.dest}. The next station is ${nx.name}.`)
}
rail.onArrive = onArrive
rail.onDepart = onDepart
function cargoWords() {
  if (!cargo.on) return ''
  const where = follow.line.stops[cargo.loaded ? cargo.to : cargo.from]?.name || ''
  return `cargo: ${cargo.loaded ? `${cargo.goods} on, for ${where}` : `${cargo.goods} to collect at ${where}`}${cargo.done ? `, ${cargo.done} delivered` : ''}`
}

// the signals and the crossings, working: a signal behind a train shows red while it is in the block, the one before a
// stop shows a caution; a crossing's barriers come down and its lamps flash as a train comes
function signalsStep(dt) {
  if (!ctx.signals.length && !ctx.crossings.length) return
  const byLine = new Map()
  for (const u of rail.units) if (u.phase !== 'stabled') { if (!byLine.has(u.line.slug)) byLine.set(u.line.slug, []); byLine.get(u.line.slug).push(u) }
  for (const sg of ctx.signals) {
    if (!sg.lamp || sg.lamp.userData.gone) continue
    let c = 0x25d04d
    for (const u of byLine.get(sg.line.slug) || []) {
      const ahead = (sg.s - u.s) * u.dir
      if (ahead < 0 && ahead > -1500) { c = 0xff2a2a; break }
      const nx = u.line.stops[u.next]
      if (nx && ahead > 0 && ahead < 1800 && (nx.s - sg.s) * u.dir > 0 && (nx.s - sg.s) * u.dir < 1800) c = 0xffc23a
    }
    sg.lamp.material.color.set(c)
  }
  for (const cr of ctx.crossings) {
    if (!cr.arms.length || cr.arms[0].pivot.userData.gone) continue
    const near = (byLine.get(cr.line.slug) || []).some((u) => Math.abs(cr.s - u.s) < 900 || (u.v > 0 && (cr.s - u.s) * u.dir > 0 && (cr.s - u.s) * u.dir < 900))
    cr.down += ((near ? 1 : 0) - cr.down) * Math.min(1, dt * 0.9)
    for (const { pivot, side } of cr.arms) pivot.rotation.z = side * (Math.PI / 2) * (1 - cr.down)
    if (cr.traffic && !cr.traffic.userData.gone) cr.traffic.visible = cr.down > 0.3
    const flash = near && Math.floor(rail.clock * 1.6) % 2 === 0
    cr.lamps.forEach((l, k) => l.material.color.set(near ? ((k % 2 === 0) === flash ? 0xff2a2a : 0x3a1212) : 0x3a1212))
  }
}

// ── the sound: made here, nothing fetched ─────────────────────────────────────────────────────────────────────────
// (an engine under the floor: a low saw through a filter whose pitch follows the speed, and a roar of noise with it; the
// joints in the rail, one every eighteen metres, a tap each; the horn two notes; the voice the browser's)
const snd = { on: false, ctx: null, eng: null, engGain: null, roar: null, roarGain: null, noise: null, joint: 0, said: null }
function soundStart() {
  if (snd.ctx) { snd.ctx.resume(); return }
  const C = new (window.AudioContext || window.webkitAudioContext)()
  snd.ctx = C
  const master = C.createGain(); master.gain.value = 0.6; master.connect(C.destination); snd.master = master
  const eng = C.createOscillator(); eng.type = 'sawtooth'; eng.frequency.value = 38
  const lp = C.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 2
  const eg = C.createGain(); eg.gain.value = 0
  eng.connect(lp); lp.connect(eg); eg.connect(master); eng.start()
  snd.eng = eng; snd.engGain = eg; snd.engFilter = lp
  const buf = C.createBuffer(1, C.sampleRate * 2, C.sampleRate), d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  snd.noise = buf
  const roar = C.createBufferSource(); roar.buffer = buf; roar.loop = true
  const bp = C.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 180; bp.Q.value = 0.7
  const rg = C.createGain(); rg.gain.value = 0
  roar.connect(bp); bp.connect(rg); rg.connect(master); roar.start()
  snd.roar = roar; snd.roarGain = rg
  // the sound, all of it, once he has added it (sound.js)
  if (HAS.sounds) snd.rail = new RailSound(C, master)
}
function tap(gainTo = 0.5) {
  const C = snd.ctx; if (!C || !snd.on) return
  const src = C.createBufferSource(); src.buffer = snd.noise
  const f = C.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 600; f.Q.value = 1.2
  const g = C.createGain(); g.gain.setValueAtTime(gainTo, C.currentTime); g.gain.exponentialRampToValueAtTime(0.001, C.currentTime + 0.07)
  src.connect(f); f.connect(g); g.connect(snd.master); src.start(); src.stop(C.currentTime + 0.08)
}
let hornUntil = 0
function horn(len = 0.9) {
  const C = snd.ctx; if (!C || !snd.on) return
  if (C.currentTime < hornUntil) return
  hornUntil = C.currentTime + len + 0.2
  for (const [f, v] of [[392, 0.35], [466, 0.3], [784, 0.08]]) {
    const o = C.createOscillator(); o.type = 'square'; o.frequency.value = f
    const lp = C.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400
    const g = C.createGain(); g.gain.setValueAtTime(0.0001, C.currentTime); g.gain.exponentialRampToValueAtTime(v, C.currentTime + 0.05); g.gain.setValueAtTime(v, C.currentTime + len - 0.1); g.gain.exponentialRampToValueAtTime(0.0001, C.currentTime + len)
    o.connect(lp); lp.connect(g); g.connect(snd.master); o.start(); o.stop(C.currentTime + len + 0.05)
  }
}
// a bell: the guard's, or the warning system's all clear
function bell() {
  const C = snd.ctx; if (!C || !snd.on) return
  const o = C.createOscillator(); o.type = 'sine'; o.frequency.value = 1320
  const g = C.createGain(); g.gain.setValueAtTime(0.25, C.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, C.currentTime + 0.6)
  o.connect(g); g.connect(snd.master); o.start(); o.stop(C.currentTime + 0.65)
}
function say(text) {
  if (!snd.on || !('speechSynthesis' in window) || snd.said === text) return
  snd.said = text
  const u = new SpeechSynthesisUtterance(text)
  const voices = speechSynthesis.getVoices(), v = voices.find((x) => /en-GB/i.test(x.lang) && /female|Kate|Serena|Stephanie|Martha/i.test(x.name)) || voices.find((x) => /en-GB/i.test(x.lang)) || voices.find((x) => /^en/i.test(x.lang))
  if (v) u.voice = v
  u.rate = 0.95; u.pitch = 1; u.volume = 0.9
  speechSynthesis.cancel(); speechSynthesis.speak(u)
}
function soundStep(dt) {
  if (!HAS.sound || !snd.on || !snd.ctx) return
  const v = follow.v, C = snd.ctx, t = C.currentTime
  const pull = drive.on ? Math.max(0, drive.notch) : follow.phase === 'run' && v < follow.line.speed - 0.5 ? 1 : 0.25
  if (snd.rail) {
    const line = lineOf(follow)
    const st = line?.structureAt(follow.s), curve = line ? (() => { const [ax, az] = line.tangent(follow.s - 20), [bx, bz] = line.tangent(follow.s + 20); return (ax * bz - az * bx) / 40 })() : 0
    const braking = drive.on ? Math.max(0, -drive.notch) : follow.phase === 'run' && v > 0.3 && follow.v < snd.lastV ? 0.6 : 0
    snd.lastV = v
    snd.rail.step({ v, pull: follow.kind === 'ghost' ? 0 : pull, braking, curve, tunnel: !!line?.inTunnel(follow.s), bridge: st?.kind === 'bridge', rain: weather.rain, steam: follow.kind === 'steam' || follow.kind === 'rack', dt })
    snd.engGain.gain.setTargetAtTime(0, t, 0.2); snd.roarGain.gain.setTargetAtTime(0, t, 0.2)
    for (const cr of ctx.crossings) { if (cr.line.slug !== follow.line.slug) continue; const ahead = (cr.s - follow.s) * follow.dir; if (ahead > 380 && ahead < 420 && v > 2) horn() }
    const nx = follow.line.stops[follow.next]
    if (nx && follow.phase === 'run') { const left = (nx.s - follow.s) * follow.dir; if (left > 380 && left < 420) say(`We are now approaching ${nx.name}.`) }
    return
  }
  snd.eng.frequency.setTargetAtTime(38 + v * 1.6 + pull * 22, t, 0.3)
  snd.engFilter.frequency.setTargetAtTime(380 + pull * 500 + v * 6, t, 0.3)
  snd.engGain.gain.setTargetAtTime(0.05 + pull * 0.12, t, 0.4)
  snd.roarGain.gain.setTargetAtTime(Math.min(0.35, v / 90), t, 0.5)
  snd.joint += v * dt
  if (snd.joint > 18) { snd.joint -= 18; tap(Math.min(0.6, 0.15 + v / 50)); setTimeout(() => tap(Math.min(0.5, 0.12 + v / 60)), 90) }
  for (const cr of ctx.crossings) { if (cr.line.slug !== follow.line.slug) continue; const ahead = (cr.s - follow.s) * follow.dir; if (ahead > 380 && ahead < 420 && v > 2) horn() }
  // the next station, said as it comes up
  const nx = follow.line.stops[follow.next]
  if (nx && follow.phase === 'run') { const left = (nx.s - follow.s) * follow.dir; if (left > 380 && left < 420) say(`We are now approaching ${nx.name}.`) }
}

// ── driving it yourself ───────────────────────────────────────────────────────────────────────────────────────────
// (the throttle a notch at a time, the brake the same, the speed the line's; each stop scored by how far from the mark
// the doors line up, and the doors are yours; at the end of the line the other cab leads. with every line running, you
// drive the train you are with, among the others)
const drive = { on: false, notch: 0, stops: 0, score: 0, last: null, doors: false }
// the signals and the timetable, for whoever drives, once he has added them (driving.js)
const duty = sigs || HAS.timetable ? new Duty({ signals: sigs, timetable: HAS.timetable, sound: { horn: (l) => horn(l), bell, say } }) : null
function driveWords() {
  if (!drive.on) return ''
  const nx = follow.line.stops[follow.next]
  const ahead = nx ? Math.abs(nx.s - follow.s) : 0
  const bits = [`driving: ${drive.notch > 0 ? `power ${Math.round(drive.notch * 100)}%` : drive.notch < 0 ? `brake ${Math.round(-drive.notch * 100)}%` : 'coasting'}`]
  if (drive.last) bits.push(drive.last)
  if (nx && ahead < 600 && follow.v > 0.1) bits.push(`${nx.name} in ${Math.round(ahead)} m`)
  if (drive.doors) bits.push('doors open, space to close and go')
  if (follow.v > follow.line.speed + 0.5) bits.push('over the line speed')
  if (drive.stops) bits.push(`${drive.stops} stops, ${drive.score} points`)
  const d = duty?.words(follow, rail.clock)
  if (d) bits.push(d)
  return bits.join(' · ')
}
function driveStep(dt) {
  if (!drive.on) return
  const u = follow, L = u.line
  if (drive.doors) { u.v = 0; if (duty) duty.ringIfDue(u, rail.stopIndexAt(u), rail.clock); return }
  // (the warning system or the protection can put the brakes on, whatever the handle says)
  if (duty?.step(u, drive, rail.clock, dt)) drive.notch = -1
  const a = drive.notch > 0 ? ACCEL * drive.notch : drive.notch < 0 ? -BRAKE * 1.8 * -drive.notch : -0.02
  u.v = clamp(u.v + a * dt, 0, L.speed * 1.15)
  const before = u.s
  u.s = clamp(u.s + u.dir * u.v * dt, u.len + 2, L.length - 2)
  u.travelled += Math.abs(u.s - before)
  if (u.s === u.len + 2 || u.s === L.length - 2) u.v = 0
  if (u.v > 0) u.side += clamp(u.dir - u.side, -u.v * dt / 150, u.v * dt / 150)
  // the next stop is whichever is ahead now
  let i = u.next
  while (L.stops[i] && (L.stops[i].s - u.s) * u.dir < -60) i += u.dir
  if (i >= 0 && i < L.stops.length) u.next = i
}
function driveDoors() {
  if (!drive.on) return
  const u = follow, L = u.line
  if (drive.doors) {
    drive.doors = false; drive.last = null
    // the end of its trip: how it went, then the other end leads, on to its next
    const tr = u.current
    if (tr && Math.abs(u.s - L.stopPoint(tr.to, u.dir, u.len)) < 60) { if (duty) showCard(duty.card(u)); rail.turnBack(u, rail.clock); u.phase = 'run'; duty?.reset() }
    else duty?.canGo(u, rail.stopIndexAt(u), rail.clock)
    return
  }
  if (u.v > 0.3) { drive.last = 'stop first'; return }
  let best = -1, bd = Infinity
  L.stops.forEach((st, k) => { const d = Math.abs(L.stopPoint(k, u.dir, u.len) - u.s); if (d < bd) { bd = d; best = k } })
  if (best < 0 || bd > 60) { drive.last = 'no platform here'; return }
  const off = Math.round((u.s - L.stopPoint(best, u.dir, u.len)) * u.dir)
  const pts = bd < 2 ? 10 : bd < 5 ? 7 : bd < 12 ? 4 : 1
  drive.stops++; drive.score += pts
  drive.last = `${L.stops[best].name}: ${off === 0 ? 'on the mark' : `${Math.abs(off)} m ${off > 0 ? 'past' : 'short of'} the mark`}, ${pts} points`
  drive.doors = true
  duty?.arrived(u, best, pts, rail.clock)
  onArrive(u, best)
  u.next = clamp(best + u.dir, 0, L.stops.length - 1)
}
// the card at the end of a run, to keep: how it went, the score, and a link to the same run
function showCard({ score, lines, title }) {
  const el = $('card'), tr = follow.current
  const u = new URL(location.href); u.searchParams.set('line', follow.line.slug); if (tr) u.searchParams.set('hour', (Math.floor(tr.dep / 60) / 60).toFixed(3)); u.searchParams.set('go', '1')
  const text = `I drove ${title} in Pino's train simulator: ${score} out of 100.`
  el.innerHTML = `<h2>${score}<span>/100</span></h2>${lines.map((l) => `<p>${l.replace(/[<>&]/g, '')}</p>`).join('')}<div class="row"><button class="share">share</button><button class="close">drive on</button></div>`
  el.querySelector('.close').onclick = () => { el.hidden = true }
  el.querySelector('.share').onclick = async () => {
    try { if (navigator.share) await navigator.share({ title: "Pino's train simulator", text, url: u.toString() }); else { await navigator.clipboard.writeText(`${text} ${u}`); el.querySelector('.share').textContent = 'copied' } } catch { /* not shared */ }
  }
  el.hidden = false
}
function driveOn(on) {
  drive.on = on; drive.notch = 0; drive.doors = false
  duty?.reset()
  drive.last = on ? 'arrows or W and S for power and brake, space for the doors' : null
  follow.you = on
  if (on) { follow.phase = 'run'; setRate(1); cam = 'cab'; sideAt = null }
}
addEventListener('keydown', (e) => {
  if (e.repeat || e.target?.tagName === 'SELECT') return
  if (HAS.sound && (e.key === 'h' || e.key === 'H')) horn(1.2)
  if (!drive.on) return
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { drive.notch = clamp(Math.round(drive.notch * 4 + 1) / 4, -1, 1); e.preventDefault() }
  if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { drive.notch = clamp(Math.round(drive.notch * 4 - 1) / 4, -1, 1); e.preventDefault() }
  if (e.key === ' ') { driveDoors(); e.preventDefault() }
  if ((e.key === 'a' || e.key === 'A') && duty) duty.acknowledge()
})

// ── looking at it ─────────────────────────────────────────────────────────────────────────────────────────────────
const CAMS = [['cab', 'cab'], ...(HAS.seat ? [['seat', 'a seat']] : []), ['chase', 'behind'], ['side', 'beside'], ['drone', 'above'], ['map', 'the line']]
let cam = CAMS.some(([k]) => k === params.get('cam')) ? params.get('cam') : titled ? 'drone' : 'chase'
const controls = new OrbitControls(camera, canvas)
controls.enabled = false
const want = { pos: new THREE.Vector3(), look: new THREE.Vector3() }
let mapSet = null, sideAt = null, droneA = 0
function groundAt(x, z) { return ground.h(x, z) ?? -1e9 }
function aim(dt) {
  const line = lineOf(follow)
  if (!line) return
  const s = follow.s, d = follow.dir
  const [tx0, tz0] = line.tangent(s), tx = tx0 * d, tz = tz0 * d
  const p = line.pos(s, follow.side, 0)
  if (cam === 'photo') { scene.fog = fog; overview.visible = false; return }
  controls.enabled = cam === 'map'
  // the whole line is seen without the haze, the drawing of it over the dark
  scene.fog = cam === 'map' ? null : fog
  overview.visible = cam === 'map'
  if (cam === 'map') {
    if (mapSet !== line.slug) {
      const box = new THREE.Box3(); for (let q = 0; q <= line.length; q += 500) box.expandByPoint(line.pos(q))
      const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3())
      camera.position.set(c.x + size.x * 0.15, c.y + Math.max(size.x, size.z) * 1.15, c.z + size.z * 0.6)
      controls.target.copy(c); controls.update(); mapSet = line.slug
    }
    return
  }
  mapSet = null
  // a seat by the window: in the second carriage, on the side away from the other track, looking out and a little ahead
  if (cam === 'seat') {
    const mid = clamp(s - d * (follow.len * 0.45), 0, line.length), q = line.pos(mid, follow.side, 2.25), [ux, uz] = line.tangent(mid)
    const out = follow.dir > 0 ? 1 : -1, nx = uz * out, nz = -ux * out
    camera.position.set(q.x + nx * 0.9, q.y + Math.sin(follow.travelled / 9) * 0.01, q.z + nz * 0.9)
    camera.lookAt(q.x + nx * 40 + ux * d * 18, q.y - 2, q.z + nz * 40 + uz * d * 18)
    seatView?.update(); cabView?.hide()
    return
  }
  seatView?.hide()
  if (cam === 'cab') { const back = cabView ? -0.9 : 0.5; want.pos.set(p.x + tx * back, p.y + (cabView ? 2.95 : 3.1), p.z + tz * back); want.look.copy(line.pos(clamp(s + d * 80, 0, line.length), follow.side, 2.6)) }
  // (behind the whole train, however long it is: 70 m was behind two cars and over the middle of an express)
  else if (cam === 'chase') { const back = follow.len + 25; want.pos.set(p.x - tx * back + tz0 * 6, p.y + 16, p.z - tz * back - tx0 * 6); want.look.set(p.x + tx * 25, p.y + 2, p.z + tz * 25) }
  else if (cam === 'side') {
    // a spot beside the line ahead of the train, and the train watched going past it, then the next spot
    if (!sideAt || sideAt.slug !== line.slug || (sideAt.s - s) * d < -120) { const ss = clamp(s + d * 260, 0, line.length), q = line.pos(ss, 0, 4.5), [ntx, ntz] = line.tangent(ss), off = 28 + HALF; sideAt = { slug: line.slug, s: ss, pos: q.add(new THREE.Vector3(ntz * off, 0, -ntx * off)) } }
    want.pos.copy(sideAt.pos); want.look.set(p.x, p.y + 2.5, p.z)
  } else { droneA += dt * 0.08; want.pos.set(p.x + Math.cos(droneA) * 160, p.y + 110, p.z + Math.sin(droneA) * 160); want.look.copy(p) }
  // a camera outside the train is never in a hill: held above the ground under it
  if (cam !== 'cab') want.pos.y = Math.max(want.pos.y, groundAt(want.pos.x, want.pos.z) + (cam === 'drone' ? 70 : 6))
  const k = cam === 'cab' ? 1 : 1 - Math.pow(0.02, dt)
  camera.position.lerp(want.pos, cam === 'side' || camera.position.distanceTo(want.pos) > 400 ? 1 : k)
  camera.lookAt(want.look)
  if (cabView) cabStep(line, dt)
}
// the cab, from the cab: its dials, its handle, its glass, and the lean and the jolt carried by the camera
let lastV = 0, cabJoint = 0
function cabStep(line, dt) {
  if (cam !== 'cab') { cabView.hide(); return }
  const u = follow, s = u.s, d = u.dir
  const [ax, az] = line.tangent(clamp(s - 20 * d, 0, line.length)), [bx, bz] = line.tangent(clamp(s + 20 * d, 0, line.length))
  const curve = (ax * bz - az * bx) / 40
  const acc = dt > 0 ? (u.v - lastV) / (dt * rate) : 0
  lastV = u.v
  cabJoint += u.v * dt * rate
  const joint = cabJoint > 18
  if (joint) cabJoint -= 18
  const nx = u.line.stops[u.next]
  const caution = sigs ? !!duty?.aws || Signals.isCaution(sigs.ahead(u)?.signal?.aspect) : !!nx && u.phase === 'run' && Math.abs(nx.s - s) < 1800
  cabView.update({ v: u.v, notch: drive.on ? drive.notch : u.phase !== 'run' ? -0.25 : acc > 0.05 ? 0.75 : acc < -0.05 ? -0.6 : 0, clock: rail.clock, rain: weather.rain, caution, curve, joint, dt })
  camera.rotateZ(cabView.roll)
  camera.position.y += cabView.bob
}

// ── the lines near the camera, brought in as it goes ──────────────────────────────────────────────────────────────
// (a line whose track comes within 20 km of the camera has its whole file fetched and goes into the world)
const netPaths = NET ? network.lines.map((l) => ({ slug: l.slug, pts: (l.path || []).map(([lat, lon]) => toXZ(lat, lon)) })) : []
let lineCheck = 0
function bringLinesIn(dt) {
  if (!NET || (lineCheck -= dt) > 0) return
  lineCheck = 2
  const x = camera.position.x, z = camera.position.z
  for (const p of netPaths) {
    if (full.has(p.slug) || loading.has(p.slug)) continue
    if (p.pts.some(([px, pz]) => Math.hypot(px - x, pz - z) < 20000)) loadLine(p.slug)
  }
}

// ── the panels ────────────────────────────────────────────────────────────────────────────────────────────────────
const lineSel = document.createElement('select')
for (const l of index.lines) { const o = document.createElement('option'); o.value = l.slug; o.textContent = `${l.name}, ${l.from} to ${l.to}`; lineSel.append(o) }
lineSel.value = first.slug
lineSel.onchange = async () => {
  if (!NET) { const u = new URL(location.href); u.searchParams.set('line', lineSel.value); location.href = u.toString(); return }
  // with every line running, the first train on the move there
  const line = await loadLine(lineSel.value)
  if (!line) { lineSel.value = follow.line.slug; return }
  followUnit(firstOn(lineSel.value))
}
// with every line running, the trains on this line; on its own, the kind of train you run it with
const trainSel = document.createElement('select')
function fillTrains() {
  trainSel.innerHTML = ''
  if (NET) {
    for (const u of follow.line.units.filter((x) => x.phase !== 'stabled' || x === follow)) { const o = document.createElement('option'); o.value = String(u.id); o.textContent = `${u.headcode} ${u.title}`; trainSel.append(o) }
    trainSel.value = String(follow.id)
  } else {
    // (the four from 24 Oct, the futuristic one once he has added it, and a line's own tram or rack engine)
    const kinds = ['dmu', 'express', 'freight', 'steam', ...(HAS.future ? ['future'] : []), ...(['tram', 'rack'].includes(follow.line.kind) ? [follow.line.kind] : [])]
    for (const k of kinds) { const o = document.createElement('option'); o.value = k; o.textContent = KINDS[k].label; trainSel.append(o) }
    trainSel.value = follow.kind
  }
}
trainSel.onchange = () => {
  if (NET) { const u = follow.line.units.find((x) => String(x.id) === trainSel.value); if (u) followUnit(u); return }
  setKind(follow, trainSel.value)
  if (trainSel.value !== 'freight' && cargo.on) cargo.on = false
  const u = new URL(location.href); u.searchParams.set('train', trainSel.value); history.replaceState(null, '', u.toString())
  paintButtons()
}
function followUnit(u) {
  if (drive.on) driveOn(false)
  follow = u
  sideAt = null; mapSet = null
  lineSel.value = u.line.slug
  $('name').textContent = `${u.line.from} to ${u.line.to}`
  $('about').textContent = aboutOf(full.get(u.line.slug))
  fillTrains(); drawStrip(); paintCredits()
  if (cargo.on) newMission()
  const url = new URL(location.href); url.searchParams.set('line', u.line.slug); history.replaceState(null, '', url.toString())
}
$('picks').append(lineSel, trainSel)
$('picks').hidden = false
const aboutOf = (line) => line?.data?.summary?.text ? line.data.summary.text.split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.') : ''
$('name').textContent = `${first.data.from} to ${first.data.to}`
$('about').textContent = aboutOf(first)
if (swapped) $('about').textContent = `${swapped} ${$('about').textContent}`
for (const [k, label] of CAMS) { const b = document.createElement('button'); b.textContent = label; b.dataset.cam = k; b.onclick = () => { cam = k; sideAt = null; paintButtons() }; $('cams').append(b) }
const RATES = [1, 4, 16, 64]
let rate = Number(params.get('rate')) || (NET ? 1 : 4)
function setRate(r) { rate = r; paintButtons() }
for (const r of RATES) { const b = document.createElement('button'); b.textContent = `${r}x`; b.dataset.rate = r; b.onclick = () => setRate(r); $('rates').append(b) }
if (HAS.night) { const b = document.createElement('button'); b.textContent = 'night map'; b.dataset.feat = 'night'; b.onclick = () => { nightMap = !nightMap; paintNight(); if (nightMap) { cam = 'map'; sideAt = null } paintButtons() }; $('feats').append(b) }
if (HAS.cargo) { const b = document.createElement('button'); b.textContent = 'cargo'; b.dataset.feat = 'cargo'; b.onclick = () => { cargo.on = !cargo.on; if (cargo.on) { if (!NET) setKind(follow, 'freight'); newMission() } else if (!NET && follow.kind === 'freight') setKind(follow, 'dmu'); paintButtons() }; $('feats').append(b) }
if (HAS.sound) { const b = document.createElement('button'); b.textContent = 'sound'; b.dataset.feat = 'sound'; b.onclick = () => { snd.on = !snd.on; if (snd.on) soundStart(); else { snd.ctx?.suspend(); speechSynthesis?.cancel() } paintButtons() }; $('feats').append(b) }
if (HAS.drive) {
  const b = document.createElement('button'); b.textContent = 'drive it'; b.dataset.feat = 'drive'
  b.onclick = () => { driveOn(!drive.on); paintButtons() }
  $('feats').append(b)
  // and on a phone, the same three on the screen
  for (const [label, fn] of [['power', () => { drive.notch = clamp(Math.round(drive.notch * 4 + 1) / 4, -1, 1) }], ['brake', () => { drive.notch = clamp(Math.round(drive.notch * 4 - 1) / 4, -1, 1) }], ['doors', driveDoors], ...(duty?.signals ? [['seen it', () => duty.acknowledge()]] : [])]) { const k = document.createElement('button'); k.textContent = label; k.onclick = fn; $('pad').append(k) }
}
if (HAS.satellite) {
  ground.setPhoto(params.get('space') !== '0')
  const b = document.createElement('button'); b.textContent = 'from space'; b.dataset.feat = 'satellite'; b.onclick = () => { ground.setPhoto(!ground.photoOn); paintButtons() }; $('feats').append(b)
}
if (look) {
  // (the photograph of the land in big pixels too, as the old games had their ground)
  const pixels = () => { if (ground.atlas) { ground.atlas.tex.magFilter = look.on ? THREE.NearestFilter : THREE.LinearFilter; ground.atlas.tex.needsUpdate = true } }
  pixels()
  const b = document.createElement('button'); b.textContent = 'old console'; b.dataset.feat = 'look'; b.onclick = () => { look.on = !look.on; pixels(); paintButtons() }; $('feats').append(b)
}
// photo mode, once he has added it: the railway stood still, the camera walked round the train, the picture kept with a
// line along its foot saying where and when, and a link that opens the simulator there
const photo = { on: false, rate: 1 }
if (HAS.photo) {
  const b = document.createElement('button'); b.textContent = 'photo'; b.dataset.feat = 'photo'
  b.onclick = () => photoMode(!photo.on)
  $('feats').append(b)
  $('photobar').querySelector('.take').onclick = takePicture
  $('photobar').querySelector('.link').onclick = async () => { try { await navigator.clipboard.writeText(momentLink()); $('photobar').querySelector('.link').textContent = 'link copied' } catch { prompt('the link to here', momentLink()) } }
  $('photobar').querySelector('.back').onclick = () => photoMode(false)
}
function photoMode(on) {
  photo.on = on
  document.body.classList.toggle('photo', on)
  $('photobar').hidden = !on
  if (on) {
    photo.rate = rate; rate = 0
    photo.cam = cam; cam = 'photo'
    controls.enabled = true
    const line = lineOf(follow), p = line?.pos(follow.s, follow.side, 2)
    if (p) {
      controls.target.copy(p)
      // (from wherever the camera was, or behind and beside the train if that was a long way off)
      if (camera.position.distanceTo(p) > 300) { const [tx, tz] = line.tangent(follow.s); camera.position.set(p.x - tx * follow.dir * 40 + tz * 18, p.y + 9, p.z - tz * follow.dir * 40 - tx * 18) }
    }
    controls.update()
  } else { rate = photo.rate || 1; cam = photo.cam === 'photo' ? 'chase' : photo.cam || 'chase'; controls.enabled = false; $('photobar').querySelector('.link').textContent = 'copy a link to here' }
  paintButtons()
}
function momentLink() {
  const u = new URL(location.href)
  for (const k of [...u.searchParams.keys()]) u.searchParams.delete(k)
  u.searchParams.set('line', follow.line.slug); u.searchParams.set('at', (follow.s / 1000).toFixed(2)); u.searchParams.set('hour', ((rail.clock % 86400) / 3600).toFixed(3)); u.searchParams.set('cam', photo.cam && photo.cam !== 'photo' ? photo.cam : 'chase'); u.searchParams.set('go', '1')
  if (!NET) u.searchParams.set('train', follow.kind)
  return u.toString()
}
function takePicture() {
  // (drawn now and read back at once, before the canvas is cleared for the next frame)
  if (look) look.render(scene, camera); else renderer.render(scene, camera)
  const src = renderer.domElement, W = src.width, H = src.height, foot = Math.round(H * 0.07)
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H + foot
  const g = cv.getContext('2d')
  g.imageSmoothingEnabled = false
  g.drawImage(src, 0, 0)
  g.fillStyle = '#0b0b0d'; g.fillRect(0, H, W, foot)
  g.fillStyle = '#a7cd07'; g.fillRect(0, H, W, Math.max(2, foot * 0.06))
  const L = follow.line, nearSt = L.stops.reduce((a, b) => (Math.abs(b.s - follow.s) < Math.abs(a.s - follow.s) ? b : a))
  g.font = `bold ${Math.round(foot * 0.36)}px ui-monospace, Menlo, monospace`; g.textBaseline = 'middle'; g.fillStyle = '#f4f2ee'
  g.fillText(`${L.name}, near ${nearSt.name}, ${hhmm(rail.clock)}`, foot * 0.4, H + foot * 0.55)
  g.textAlign = 'right'; g.fillStyle = '#e14a89'; g.fillText("pino's train simulator", W - foot * 0.4, H + foot * 0.55)
  cv.toBlob((blob) => { if (!blob) return; const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `pino-train-${L.slug}-${hhmm(rail.clock).replace(':', '')}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000) }, 'image/png')
}
// the train plays the synth, once he has added it (sound.js LineSynth): a button to play the line, and one to record it
let synth = null
if (HAS.synth) {
  const play = document.createElement('button'); play.textContent = 'play the line'; play.dataset.feat = 'synth'
  const rec = document.createElement('button'); rec.textContent = 'record'; rec.dataset.feat = 'record'; rec.hidden = true
  play.onclick = () => {
    soundStart()
    if (!synth) synth = new LineSynth(snd.ctx, snd.master)
    if (synth.on) { synth.stop(); rec.hidden = true; if (synth.rec) synth.record(() => {}) } else { synth.start(); rec.hidden = false }
    paintButtons()
  }
  rec.onclick = () => {
    if (!synth) return
    const started = synth.record((blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `pino-${follow.line.slug}-loop.webm`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); rec.textContent = 'record' })
    if (started) rec.textContent = 'stop and save'
  }
  $('feats').append(play, rec)
}
let mapView = null
if (NET) {
  const b = document.createElement('button'); b.textContent = 'the railway'; b.dataset.feat = 'railway'
  b.onclick = async () => {
    if (!mapView) { const { NetMap } = await import('./map.js'); mapView = new NetMap($('netmap'), { network, rail, onPick: async (u) => { await loadLine(u.line.slug); followUnit(u); mapView.hide(); paintButtons() }, onClose: () => paintButtons() }) }
    mapView.toggle(follow); paintButtons()
  }
  $('feats').append(b)
}
$('feats').hidden = !$('feats').children.length
// the hour, once the sky is his: the clock jumps, and with every line running the trains are where they would be by then
const HOURS = [['dawn', 6.6], ['morning', 9.5], ['noon', 12.5], ['evening', 17.5], ['dusk', 19.2], ['night', 23.3]]
if (HAS.sky) {
  for (const [label, h] of HOURS) {
    const b = document.createElement('button'); b.textContent = label; b.dataset.hour = h
    b.onclick = () => {
      if (NET) { const keep = { slug: follow.line.slug, id: follow.id }; rail.start(h * 3600); followUnit(simOf(keep.slug).units.find((u) => u.id === keep.id && u.phase !== 'stabled') || firstOn(keep.slug)) }
      else rail.clock = Math.floor(rail.clock / 86400) * 86400 + h * 3600
      paintButtons()
    }
    $('times').append(b)
  }
  $('times').hidden = false
}
function paintButtons() {
  for (const b of $('cams').children) b.classList.toggle('on', b.dataset.cam === cam)
  for (const b of $('feats').children) b.classList.toggle('on', b.dataset.feat === 'night' ? nightMap : b.dataset.feat === 'satellite' ? ground.photoOn : b.dataset.feat === 'sound' ? snd.on : b.dataset.feat === 'drive' ? drive.on : b.dataset.feat === 'railway' ? !!mapView?.open : b.dataset.feat === 'look' ? !!look?.on : b.dataset.feat === 'photo' ? photo.on : b.dataset.feat === 'synth' ? !!synth?.on : b.dataset.feat === 'record' ? !!synth?.rec : cargo.on)
  $('pad').hidden = !drive.on
  for (const b of $('rates').children) b.classList.toggle('on', Number(b.dataset.rate) === rate)
  const h = (rail.clock / 3600) % 24
  for (const b of $('times').children) b.classList.toggle('on', Math.abs(Number(b.dataset.hour) - h) < 1.2)
}
$('creditsBtn').onclick = () => { const c = $('credits'); c.style.display = c.style.display === 'block' ? 'none' : 'block' }
function paintCredits() {
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
  const lines = [...full.values()]
  const photos = lines.flatMap((l) => [...l.data.stations.flatMap((st) => st.photos), ...l.data.sights])
  const seen = new Set()
  const credits = [...lines.flatMap((l) => l.data.credits), ...(HAS.terrain ? [{ what: 'the ground for miles either side', who: 'Mapzen terrarium tiles (SRTM, EU-DEM and others), via AWS Open Data', licence: 'as each source says', url: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md' }] : []), ...(HAS.satellite ? [{ what: 'the ground seen from space', who: 'Sentinel-2 cloudless by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020)', licence: 'CC BY-NC-SA 4.0', url: 'https://s2maps.eu' }] : []), ...lines.map((l) => l.scenery?.credit).filter(Boolean), ...(NET && network.credits ? network.credits : [])].filter((c) => { const k = `${c.what}|${c.who}`; if (seen.has(k)) return false; seen.add(k); return true })
  $('credits').innerHTML = `<button onclick="this.parentNode.style.display='none'">close</button><h3>Where all of it comes from</h3><ul>${credits.map((c) => `<li>${esc(c.what)}: ${esc(c.who)} (${esc(c.licence)}) <a href="${esc(c.url)}" target="_blank" rel="noopener">source</a></li>`).join('')}</ul><h3>Photographs</h3><ul>${photos.map((p) => `<li>"${esc(p.title)}" by ${esc(p.author)}, ${esc(p.licence)} <a href="${esc(p.page)}" target="_blank" rel="noopener">source</a></li>`).join('')}</ul>`
}
// the strip: the whole line, its stations, and where the trains are on it
const svg = $('stripSvg')
function drawStrip() {
  const L = follow.line
  const W = svg.clientWidth || 800, H = svg.clientHeight || 46, x = (s) => 14 + (s / L.length) * (W - 28)
  const line = full.get(L.slug)
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
  svg.innerHTML = `<line x1="14" y1="${H / 2}" x2="${W - 14}" y2="${H / 2}" stroke="#f4f2ee" stroke-width="2"/>` +
    (line ? line.data.structures.filter((st) => st.kind === 'bridge' && st.toKm - st.fromKm > 0.15).map((st) => `<line x1="${x(st.fromKm * 1000)}" y1="${H / 2}" x2="${x(st.toKm * 1000)}" y2="${H / 2}" stroke="#e14a89" stroke-width="5"/>`).join('') : '') +
    L.stops.map((st) => `<circle cx="${x(st.s)}" cy="${H / 2}" r="${st.loop ? 5 : 4}" fill="#0b0b0d" stroke="#a7cd07" stroke-width="2"/>`).join('') +
    `<g id="others"></g><g id="trainDot"><rect x="-7" y="${H / 2 - 9}" width="14" height="18" fill="#2fd1ff" stroke="#f4f2ee" stroke-width="1.5"/></g>`
}
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); look?.resize(w, h) }
addEventListener('resize', () => { resize(); drawStrip() })
let shownPhoto = null, listT = 0
function panels(dt) {
  const L = follow.line
  const W = svg.clientWidth || 800, H = svg.clientHeight || 46, sx = (s) => 14 + (s / L.length) * (W - 28)
  const dot = $('trainDot'); if (dot) dot.setAttribute('transform', `translate(${sx(follow.s)},0)`)
  const others = $('others')
  if (others) others.innerHTML = L.units.filter((u) => u !== follow && u.phase !== 'stabled').map((u) => `<rect x="${sx(u.s) - 4}" y="${H / 2 + (u.dir > 0 ? -12 : 4)}" width="8" height="8" fill="${u.kind === 'freight' ? '#f0c44d' : u.kind === 'steam' ? '#e14a89' : '#8d8a84'}"/>`).join('')
  const nx = L.stops[follow.next] || L.stops[L.stops.length - 1]
  const miles = Math.abs(nx.s - follow.s) / 1609.34
  const at = rail.stopIndexAt(follow)
  $('next').textContent = follow.phase === 'stabled' ? `put away at ${L.stops[at]?.name || L.to} for the night` : follow.phase !== 'run' ? `at ${L.stops[at]?.name || ''}` : `next: ${nx.name}, ${miles < 0.1 ? 'arriving' : `${miles.toFixed(1)} mi`}`
  $('speed').textContent = Math.round(follow.v * 2.23694)
  const line = full.get(L.slug)
  $('height').textContent = line ? Math.round(line.trackY(follow.s) * 3.28084) : '--'
  $('clock').textContent = hhmm(rail.clock)
  $('dir').textContent = `towards ${follow.dir > 0 ? L.to : L.from}`
  const gc = ground.counts, pc = ground.photoCounts
  const groundWords = HAS.terrain && gc.built < gc.of ? `the ground coming in, ${gc.built} of ${gc.of} tiles` : HAS.satellite && ground.photoOn && pc && pc.got < pc.of * 0.7 ? `the photograph coming in, ${pc.got} of ${pc.of} tiles` : ''
  const service = NET ? `${follow.headcode} ${follow.title}${follow.late > 90 ? `, ${Math.round(follow.late / 60)} min late` : follow.phase === 'run' ? ', on time' : ''}` : ''
  $('extra').textContent = [service, HAS.weather ? WEATHER_WORDS(weather.rain) : '', cargoWords(), driveWords(), groundWords].filter(Boolean).join(' · ')
  // the photo of wherever it is now, as it comes up
  let best = null, bd = 1600
  for (const b of ctx.boards) { if (b.obj.userData.gone) { ctx.boards.delete(b); continue } if (b.line.slug !== L.slug) continue; const d = Math.abs(b.s - follow.s); if (d < bd) { bd = d; best = b } }
  // (on a phone the photograph shows only while the train stands at a station)
  document.body.classList.toggle('at-station', follow.phase !== 'run')
  if (best !== shownPhoto) {
    shownPhoto = best
    $('photo').style.display = best ? 'block' : 'none'
    $('photo').classList.toggle('has', !!best)
    if (best) {
      $('photoImg').src = best.ph.thumb
      $('photoCap').textContent = best.ph.title
      $('photoCredit').innerHTML = ''
      const a = document.createElement('a'); a.href = best.ph.page; a.target = '_blank'; a.rel = 'noopener'; a.textContent = `${best.ph.author}, ${best.ph.licence}`
      $('photoCredit').append('photo: ', a)
    }
  }
  if (NET && (listT += dt) > 20) { listT = 0; if (document.activeElement !== trainSel) fillTrains() }
}

fillTrains()
paintButtons()
paintCredits()
drawStrip()
addEventListener('keydown', (e) => { if (e.target?.tagName === 'SELECT') return; const k = Number(e.key); if (k >= 1 && k <= CAMS.length) { cam = CAMS[k - 1][0]; sideAt = null; paintButtons() } })
resize()
$('loading').remove()
const panelsOn = () => { for (const id of ['where', 'controls', 'strip']) $(id).hidden = false; drawStrip() }
// the layout for phones, once he has added it (index.html, body.phone): the controls in a sheet from a button, the bar
// at the top tapped for more
if (HAS.phone) {
  document.body.classList.add('phone')
  $('menuBtn').onclick = () => document.body.classList.toggle('sheet')
  $('where').onclick = () => $('where').classList.toggle('more')
  // (a choice made in the sheet closes it, so the train is in view again)
  $('controls').addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON' && innerWidth <= 760) setTimeout(() => document.body.classList.remove('sheet'), 150) })
}
if (titled) {
  const title = new Title($('title'), { lines: netData.lines, pick: first.slug, hours: HOURS, now: NET, onDepart: async ({ slug, hour }) => {
    if (!NET && (slug !== first.slug)) { const u = new URL(location.href); u.searchParams.set('line', slug); u.searchParams.set('go', '1'); if (hour !== 'now') u.searchParams.set('hour', hour); location.href = u.toString(); return }
    if (NET) {
      if (hour !== 'now') rail.start(hour * 3600)
      await loadLine(slug)
      followUnit(firstOn(slug))
    } else if (hour !== 'now') rail.clock = Math.floor(rail.clock / 86400) * 86400 + hour * 3600
    cam = 'chase'; sideAt = null
    panelsOn(); paintButtons()
  } })
  title.show()
} else panelsOn()
let last = performance.now()
let panelT = 0, markT = 0, sigT = 0
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000); last = now
  // time runs faster in small steps (railway.js), so the brakes still meet the platform
  rail.step(dt * rate)
  driveStep(dt * rate)
  placeTrains()
  weatherStep(dt * Math.min(rate, 4))
  soundStep(dt * rate)
  if (synth?.on) { const line = lineOf(follow), st = line?.structureAt(follow.s), at = rail.stopIndexAt(follow); synth.update({ v: follow.v, height: line ? line.trackY(follow.s) : 0, station: (follow.phase === 'run' ? follow.line.stops[follow.next] : follow.line.stops[at])?.name, caution: sigs ? Signals.isCaution(sigs.ahead(follow)?.signal?.aspect) : false, bridge: st?.kind === 'bridge', tunnel: !!line?.inTunnel(follow.s), dt: dt * rate }) }
  sunStep()
  signalsStep(dt * Math.min(rate, 4))
  if ((sigT += dt) > 0.4) { sigT = 0; sigs?.step(rail.units); depBoards?.step(rail.clock) }
  if (HAS.sky) {
    const dark = 1 - daylight
    ctx.mats.house.emissiveIntensity = 0.16 * dark
    glassMat.emissiveIntensity = 0.5 * dark
    ctx.mats.lamp.color.set(GOLD).multiplyScalar(0.35 + 0.65 * dark)
  }
  aim(dt)
  if (cam === 'map') { controls.update(); if ((markT += dt) > 0.25) { markT = 0; markUnits() } }
  if (cam === 'photo') controls.update()
  // what is near the camera is built and what is far given back; the ground round it brought in
  const focus = cam === 'map' ? (lineOf(follow)?.pos(follow.s) || camera.position) : camera.position
  ground.update(focus.x, focus.z)
  near.update(focus.x, focus.z, { perFrame: 2, ready: (it) => !it.needsGround || (it.pts || [[it.x, it.z]]).every(([x, z]) => ground.ready(x, z)) })
  bringLinesIn(dt)
  for (const t of ground.tiles.values()) if (t.mesh) t.mesh.visible = cam !== 'map'
  sky.position.copy(camera.position)
  if ((panelT += dt) > 0.15) { panels(panelT); panelT = 0; mapView?.draw(follow) }
  if (look) { look.sweep(scene, dt); look.render(scene, camera) } else renderer.render(scene, camera)
})
window.__sim = { look, cabView, rail, get follow() { return follow }, followUnit, line: first.data, lines: full, camera, scene, ground, near, tracks, setCam: (c) => { cam = c; paintButtons() }, HAS, NET, weather, cargo, night: () => nightMap, snd, drive, driveDoors, setKind, KINDS, sunAt, ctx }
