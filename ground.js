// The ground, round wherever the camera is, for every line at once (29 Oct). Heights come from Mapzen's terrarium tiles
// on AWS (a height in every pixel, open to any page); the land is drawn from them in two parts. The wide ground is the
// tiles themselves, a few kilometres every way. Beside the track it is a strip of its own that follows the line every
// twenty metres, so the cutting, the bank and the formation the track sits on are the right shape: the tiles are forty
// metres between points and could not carve a cutting, so near the track they sit just under the strip. Both are
// coloured from one picture of the land seen from space (Sentinel-2 cloudless by EOX), kept round the camera and
// moved with it, so the photograph runs right up to the ballast with no seam (until 29 Oct the strip beside the track
// was a plain dark band that hid it).

import * as THREE from 'three'
import { toXZ, toLL, tileXY, tileLL, clamp, lerp } from './geo.js'

const Z = 12                 // the height tiles
const SZ = 13                // the photograph's tiles
const ATLAS_TILES = 8        // the photograph round the camera, 8 by 8 of its tiles (about 22 km a side)
const REACH = 11000          // how far the wide ground goes
const KEEP = 16000
const STRIP = [-160, -90, -45, -22, -11, -6, -4.2, 4.2, 6, 11, 22, 45, 90, 160]
// (and before he added the real hills, the strip is all the ground there is, as wide as the line's own rows)
const STRIP_WIDE = [-1500, -600, -300, -160, -90, -45, -22, -11, -6, -4.2, 4.2, 6, 11, 22, 45, 90, 160, 300, 600, 1500]

const heightUrl = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`
const photoUrl = (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/${z}/${y}/${x}.jpg`
const imgLoad = (url) => new Promise((resolve, reject) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => resolve(im); im.onerror = () => reject(new Error('no tile')); im.src = url })

/** The colour of the ground by how high it is and how steep: dark in the valleys, warmer up the fells, grey where steep. */
export function heightBand(h, slope, out = new THREE.Color()) {
  out.set(0x2a3a27).lerp(_c1, clamp((h - 60) / 320, 0, 1)).lerp(_c2, clamp((h - 450) / 350, 0, 1))
  return out.lerp(_c3, clamp(slope * 2.2 - 0.3, 0, 0.6))
}
const _c1 = new THREE.Color(0x5c5a34), _c2 = new THREE.Color(0x7d7668), _c3 = new THREE.Color(0x44444a)

export class Ground {
  /** tracks: the Tracks index (where the nearest track is); HAS: what he has added. */
  constructor(scene, tracks, HAS) {
    this.scene = scene
    this.tracks = tracks
    this.HAS = HAS
    this.tiles = new Map()   // z12 "x,y" -> { x, y, h (Float32Array), mesh, state }
    this.live = 0
    this.photos = new Map()  // z13 "x,y" -> Image | 'failed' | 'loading'
    this.photoLive = 0
    this.wanted = 0
    this.focus = [0, 0]
    // the picture round the camera, and the rectangle of the world (in the photograph's tile pixels) it covers
    this.atlas = null
    if (HAS.satellite) {
      const cv = document.createElement('canvas'); cv.width = cv.height = ATLAS_TILES * 256
      const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height)
      const tex = new THREE.CanvasTexture(cv)
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter
      this.atlas = { cv, g, tex, x0: 0, y0: 0, dirty: false, at: null }
    }
    // (uSnow: the height snow lies down to, out of reach until he adds the seasons)
    this.uniforms = { uAtlas: { value: this.atlas?.tex || null }, uRect: { value: new THREE.Vector3(0, 0, 1) }, uPhoto: { value: HAS.satellite ? 1 : 0 }, uSnow: { value: 99999 } }
    this.mat = this.groundMat()
    this.photoOn = HAS.satellite
  }

  /** The ground's material: the colour of the height, the contour lines, and the photograph where it is in. */
  groundMat() {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
    const U = this.uniforms
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U)
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 merc;\nvarying vec2 vMerc;\nvarying float vH;\nvarying vec2 vW;\nvarying float vUp;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMerc = merc; vH = position.y; vW = (modelMatrix * vec4(position, 1.0)).xz; vUp = normalize(mat3(modelMatrix) * objectNormal).y;')
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec2 vMerc; varying float vH; varying vec2 vW; varying float vUp;
          uniform sampler2D uAtlas; uniform vec3 uRect; uniform float uPhoto; uniform float uSnow;
          float gh(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
          float gn(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f); return mix(mix(gh(i), gh(i + vec2(1.0, 0.0)), u.x), mix(gh(i + vec2(0.0, 1.0)), gh(i + vec2(1.0, 1.0)), u.x), u.y); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec2 auv = (vMerc - uRect.xy) / uRect.z;
          float inside = step(0.0, auv.x) * step(auv.x, 1.0) * step(0.0, auv.y) * step(auv.y, 1.0);
          vec3 ph = texture2D(uAtlas, vec2(auv.x, 1.0 - auv.y)).rgb * 1.35;
          float edge = smoothstep(0.0, 0.06, min(min(auv.x, 1.0 - auv.x), min(auv.y, 1.0 - auv.y)));
          diffuseColor.rgb = mix(diffuseColor.rgb, ph, uPhoto * inside * edge * step(0.01, dot(ph, vec3(1.0))));
          // (a grain in the grass close to: the photograph is ten metres to a pixel, smooth as felt underfoot without it)
          vec2 q = mod(vW, 2048.0);
          float grain = 0.6 * gn(q * 0.45) + 0.4 * gn(q * 1.7);
          float near = 1.0 - smoothstep(0.4, 2.5, length(fwidth(vW)));
          diffuseColor.rgb *= mix(1.0, 0.8 + 0.4 * grain, near);
          // snow on the tops, ragged at its edge, thinner where it is steep
          float snow = smoothstep(uSnow - 40.0, uSnow + 60.0, vH + (gn(q * 0.02) - 0.5) * 90.0) * (0.55 + 0.45 * vUp);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), clamp(snow, 0.0, 0.92));`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          float w25 = fwidth(vH / 25.0) * 1.2, w100 = fwidth(vH / 100.0) * 1.2;
          float thin = 1.0 - smoothstep(0.0, w25 * 1.5, abs(fract(vH / 25.0 + 0.5) - 0.5));
          float thick = 1.0 - smoothstep(0.0, w100 * 1.5, abs(fract(vH / 100.0 + 0.5) - 0.5));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.655, 0.804, 0.027), (thin * 0.22 + thick * 0.3) * (1.0 - 0.6 * uPhoto));`)
    }
    m.userData.shared = true
    return m
  }

  setPhoto(on) { this.photoOn = !!on && !!this.atlas; this.uniforms.uPhoto.value = this.photoOn ? 1 : 0 }

  // ── heights ────────────────────────────────────────────────────────────────────────────────────────────────────
  /** How high the ground is at a point of the frame, from the tiles; null where no tile is in yet. */
  tileH(x, z) {
    const [lat, lon] = toLL(x, z)
    const [tx, ty] = tileXY(lat, lon, Z)
    const t = this.tiles.get(`${Math.floor(tx)},${Math.floor(ty)}`)
    if (!t?.h) return null
    const px = clamp((tx - Math.floor(tx)) * 256 - 0.5, 0, 255), py = clamp((ty - Math.floor(ty)) * 256 - 0.5, 0, 255)
    const i = Math.floor(px), j = Math.floor(py), u = px - i, v = py - j, i1 = Math.min(255, i + 1), j1 = Math.min(255, j + 1)
    const h = t.h
    // (never below the sea: the sea bed is under water)
    return Math.max(0, lerp(lerp(h[j * 256 + i], h[j * 256 + i1], u), lerp(h[j1 * 256 + i], h[j1 * 256 + i1], u), v))
  }
  /** The ground where things stand: the formation by the track, the tiles away from it, the line's own rows if no tile. */
  h(x, z) {
    const near = this.tracks.near(x, z, this.HAS.terrain ? 180 : 1600)
    const natural = this.tileH(x, z) ?? (near ? near.line.rowGround(near.s, near.left) : null)
    if (natural == null) return null
    return near ? this.shaped(near, natural) : natural
  }
  /** Natural ground shaped to the track: the bed at it, the bank or the cutting sloping away (not on a bridge or in a tunnel). */
  shaped(near, natural) {
    const { line, s, off } = near
    const st = line.structureAt(s)
    if (st && (st.kind === 'bridge' || line.inTunnel(s))) return natural
    const bed = line.trackY(s) - 0.35
    const w = 4.2 + 1.7 * line.twoAt(s)
    if (off <= w) return bed
    // (a bank or a cutting at one in two, then the land as it is)
    const slope = Math.abs(natural - bed) * 2
    const t = clamp((off - w) / Math.max(4, slope), 0, 1)
    return lerp(bed, natural, t * t * (3 - 2 * t))
  }
  /** Whether the ground under a point is in, so what stands there can be built. */
  ready(x, z) {
    if (!this.HAS.terrain) return true
    const [lat, lon] = toLL(x, z)
    const [tx, ty] = tileXY(lat, lon, Z)
    return !!this.tiles.get(`${Math.floor(tx)},${Math.floor(ty)}`)?.h
  }

  // ── round the camera ───────────────────────────────────────────────────────────────────────────────────────────
  /** Bring in the tiles round a point (the camera, or what it follows), a few at a time, and let the far ones go. */
  update(x, z) {
    this.focus = [x, z]
    if (!this.HAS.terrain) return
    const [lat, lon] = toLL(x, z)
    const [cx, cy] = tileXY(lat, lon, Z)
    // (a tile is about 5.5 km across here; the ring is the ones whose middle is within reach)
    const want = []
    for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
      const tx = Math.floor(cx) + i, ty = Math.floor(cy) + j
      const [la, lo] = tileLL(tx + 0.5, ty + 0.5, Z), [mx, mz] = toXZ(la, lo)
      const d = Math.hypot(mx - x, mz - z)
      if (d < REACH) want.push({ tx, ty, d })
    }
    want.sort((a, b) => a.d - b.d)
    this.wanted = want.length
    for (const w of want) {
      const key = `${w.tx},${w.ty}`
      let t = this.tiles.get(key)
      if (!t) { t = { x: w.tx, y: w.ty, h: null, mesh: null, state: 'new' }; this.tiles.set(key, t) }
      if (t.state === 'new' && this.live < 6) this.fetchTile(t)
    }
    // one built a frame, nearest first, so the train keeps moving
    const ready = want.map((w) => this.tiles.get(`${w.tx},${w.ty}`)).find((t) => t.state === 'data')
    if (ready) this.buildTile(ready)
    for (const [key, t] of this.tiles) {
      const [la, lo] = tileLL(t.x + 0.5, t.y + 0.5, Z), [mx, mz] = toXZ(la, lo)
      if (Math.hypot(mx - x, mz - z) > KEEP + 4000) { this.dropTile(t); this.tiles.delete(key) }
    }
    if (this.atlas) this.moveAtlas(lat, lon)
  }
  get counts() { let built = 0; for (const t of this.tiles.values()) if (t.state === 'built') built++; return { built, of: this.wanted } }

  async fetchTile(t) {
    t.state = 'loading'; this.live++
    try {
      const r = await fetch(heightUrl(Z, t.x, t.y), { mode: 'cors' })
      if (!r.ok) throw new Error(String(r.status))
      const bmp = await createImageBitmap(await r.blob())
      const cv = document.createElement('canvas'); cv.width = cv.height = 256
      const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0)
      const px = g.getImageData(0, 0, 256, 256).data
      const h = new Float32Array(256 * 256)
      for (let k = 0; k < 256 * 256; k++) h[k] = px[k * 4] * 256 + px[k * 4 + 1] + px[k * 4 + 2] / 256 - 32768
      t.h = h; t.state = 'data'
    } catch { t.state = 'failed' }
    this.live--
  }

  /** A tile of the wide ground: a mesh round its own middle, just under the strip where the track is near. */
  buildTile(t) {
    const stride = 4, N = 256 / stride + 1
    const [la0, lo0] = tileLL(t.x + 0.5, t.y + 0.5, Z), [ax, az] = toXZ(la0, lo0)
    const anchor = [Math.round(ax), Math.round(az)]
    const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3), merc = new Float32Array(N * N * 2)
    const c = new THREE.Color()
    const hAt = (i, j) => t.h[Math.min(255, j * stride) * 256 + Math.min(255, i * stride)]
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const px = Math.min(256, i * stride), py = Math.min(256, j * stride)
      const [lat, lon] = tileLL(t.x + px / 256, t.y + py / 256, Z)
      const [x, z] = toXZ(lat, lon)
      // (the sea: the elevation model has the sea bed; the water is at the level of the sea, over it)
      const natural = hAt(i, j), sea = natural < 0.4
      let g = sea ? 0 : natural
      // (under the strip by the track, so it never comes up through it)
      const near = this.tracks.near(x, z, 175)
      if (near) g = Math.min(g, this.shaped(near, g)) - 3 * (1 - clamp((near.off - 150) / 25, 0, 1))
      const k = j * N + i
      pos[k * 3] = x - anchor[0]; pos[k * 3 + 1] = g; pos[k * 3 + 2] = z - anchor[1]
      const [mx, my] = tileXY(lat, lon, SZ)
      merc[k * 2] = mx * 256; merc[k * 2 + 1] = my * 256
      const slope = Math.abs(hAt(Math.min(N - 1, i + 1), j) - hAt(Math.max(0, i - 1), j)) / (2 * stride * 22)
      if (sea) c.set(0x0c2430); else heightBand(g, slope, c)
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b
    }
    const idx = []
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = j * N + i, b = a + 1, cc = a + N, d = cc + 1; idx.push(a, cc, b, b, cc, d) }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.setAttribute('merc', new THREE.BufferAttribute(merc, 2))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, this.mat)
    mesh.position.set(anchor[0], 0, anchor[1])
    this.scene.add(mesh)
    t.mesh = mesh; t.state = 'built'
  }
  dropTile(t) { if (t.mesh) { this.scene.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh = null } t.h = null; t.state = 'gone' }
  /** A tile come in after the lines round it changed: built again so it sits under their strips. */
  rebuildNear(x, z, r) {
    for (const t of this.tiles.values()) {
      if (t.state !== 'built') continue
      const [la, lo] = tileLL(t.x + 0.5, t.y + 0.5, Z), [mx, mz] = toXZ(la, lo)
      if (Math.hypot(mx - x, mz - z) < r + 4000) { this.scene.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh = null; t.state = 'data' }
    }
  }

  /**
   * The strip beside the track from a to b on a line: the formation, the bank or the cutting, and the land out to 160 m
   * either side, every 20 m along. Built with the track (line.js), coloured like the rest of the ground.
   */
  strip(line, a, b) {
    const [ax, az] = line.centre((a + b) / 2), anchor = [Math.round(ax), Math.round(az)]
    const cols = this.HAS.terrain ? STRIP : STRIP_WIDE
    const W = cols.length
    const pos = [], col = [], merc = [], idx = []
    const c = new THREE.Color()
    let rows = 0
    for (let s = a; ; s = Math.min(b, s + 20)) {
      const [x, z] = line.centre(s), [tx, tz] = line.tangent(s), lane = line.laneAt(s), two = 1.7 * line.twoAt(s)
      const st = line.structureAt(s), over = st && (st.kind === 'bridge' || line.inTunnel(s))
      for (const o0 of cols) {
        // (the columns spread to make room for a second track)
        const o = o0 + Math.sign(o0) * two + lane
        const px = x + tz * o, pz = z - tx * o
        const natural = this.tileH(px, pz) ?? line.rowGround(s, o)
        let g = natural
        if (!over) {
          const near = this.tracks.near(px, pz, 175)
          if (near) g = this.shaped(near, natural)
        }
        pos.push(px - anchor[0], g, pz - anchor[1])
        const [lat, lon] = toLL(px, pz), [mx, my] = tileXY(lat, lon, SZ)
        merc.push(mx * 256, my * 256)
        // (the bed itself a little darker, a ballast and a cess)
        if (Math.abs(o0) < 6.1 && !over) c.set(0x3a3833)
        else heightBand(g, 0, c)
        col.push(c.r, c.g, c.b)
      }
      if (rows) for (let j = 0; j < W - 1; j++) { const p = (rows - 1) * W + j, q = p + W; idx.push(p, q, p + 1, p + 1, q, q + 1) }
      rows++
      if (s >= b) break
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    geo.setAttribute('merc', new THREE.Float32BufferAttribute(merc, 2))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, this.mat)
    mesh.position.set(anchor[0], 0, anchor[1])
    return mesh
  }

  // ── the photograph round the camera ────────────────────────────────────────────────────────────────────────────
  moveAtlas(lat, lon) {
    const A = this.atlas
    const [px, py] = tileXY(lat, lon, SZ)
    const x0 = Math.floor(px) - ATLAS_TILES / 2, y0 = Math.floor(py) - ATLAS_TILES / 2
    // (moved when the camera is two tiles off the middle of what it has)
    if (A.at && Math.abs(x0 - A.x0) < 2 && Math.abs(y0 - A.y0) < 2) { this.fillAtlas(); return }
    A.x0 = x0; A.y0 = y0; A.at = true
    A.g.fillStyle = '#000'; A.g.fillRect(0, 0, A.cv.width, A.cv.height)
    for (let i = 0; i < ATLAS_TILES; i++) for (let j = 0; j < ATLAS_TILES; j++) { const im = this.photos.get(`${x0 + i},${y0 + j}`); if (im instanceof Image) A.g.drawImage(im, i * 256, j * 256) }
    A.tex.needsUpdate = true
    this.uniforms.uRect.value.set(x0 * 256, y0 * 256, ATLAS_TILES * 256)
    // forget the photographs a long way off
    for (const [key, im] of this.photos) { const [x, y] = key.split(',').map(Number); if (Math.abs(x - x0 - 4) > 10 || Math.abs(y - y0 - 4) > 10) if (im instanceof Image) this.photos.delete(key) }
    this.fillAtlas()
  }
  fillAtlas() {
    const A = this.atlas
    const want = []
    for (let i = 0; i < ATLAS_TILES; i++) for (let j = 0; j < ATLAS_TILES; j++) { const key = `${A.x0 + i},${A.y0 + j}`; if (!this.photos.has(key)) want.push({ key, i, j, d: Math.hypot(i - 3.5, j - 3.5) }) }
    want.sort((a, b) => a.d - b.d)
    for (const w of want) {
      if (this.photoLive >= 6) break
      this.photos.set(w.key, 'loading'); this.photoLive++
      const [x, y] = w.key.split(',').map(Number)
      imgLoad(photoUrl(SZ, x, y)).then((im) => {
        this.photos.set(w.key, im)
        const i = x - A.x0, j = y - A.y0
        if (i >= 0 && j >= 0 && i < ATLAS_TILES && j < ATLAS_TILES) { A.g.drawImage(im, i * 256, j * 256); A.dirty = true }
      }, () => this.photos.set(w.key, 'failed')).finally(() => { this.photoLive-- })
    }
    // (the picture goes up to the card at most twice a second, as tiles land)
    const now = performance.now()
    if (A.dirty && now - (A.sent || 0) > 500) { A.tex.needsUpdate = true; A.dirty = false; A.sent = now }
  }
  get photoCounts() { if (!this.atlas) return null; let got = 0; for (const v of this.photos.values()) if (v instanceof Image) got++; return { got, of: ATLAS_TILES * ATLAS_TILES } }
}

/**
 * Where the nearest track is, from anywhere: every line's track every 20 m in squares of 250 m. near(x, z, within)
 * gives { line, s, off } for the nearest within that many metres, or null.
 */
export class Tracks {
  constructor() { this.cells = new Map(); this.lines = new Set() }
  add(line) {
    if (this.lines.has(line)) return
    this.lines.add(line)
    for (const [x, z, s] of line.samples(20)) {
      const k = `${Math.floor(x / 250)},${Math.floor(z / 250)}`
      if (!this.cells.has(k)) this.cells.set(k, [])
      this.cells.get(k).push(line, x, z, s)
    }
  }
  near(x, z, within = 250) {
    const cx = Math.floor(x / 250), cz = Math.floor(z / 250)
    let best = null, bd = within * within
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const list = this.cells.get(`${cx + i},${cz + j}`)
      if (!list) continue
      for (let k = 0; k < list.length; k += 4) { const dx = list[k + 1] - x, dz = list[k + 2] - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = { line: list[k], s: list[k + 3] } } }
    }
    if (!best) return null
    // (the nearest sample, then the exact point between it and its neighbours, and how far off the middle that is)
    const L = best.line
    let s = best.s, lo = Math.max(0, s - 20), hi = Math.min(L.length, s + 20)
    for (let it = 0; it < 12; it++) {
      const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3
      const [x1, z1] = L.centre(m1), [x2, z2] = L.centre(m2)
      if ((x1 - x) ** 2 + (z1 - z) ** 2 < (x2 - x) ** 2 + (z2 - z) ** 2) hi = m2; else lo = m1
    }
    s = (lo + hi) / 2
    // (how far across from the middle of its tracks, which a shared station's lane moves over)
    const [px, pz] = L.centre(s), [tx, tz] = L.tangent(s)
    const left = (x - px) * tz - (z - pz) * tx
    return { line: L, s, off: Math.abs(left - L.laneAt(s)), left }
  }
}
