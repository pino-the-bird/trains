// The land beside the track (his to add, 29 Oct): what stands along a British railway that the map does not say. A
// line of telegraph poles on one side with their wires dipping between them, a post-and-wire fence along the boundary
// both sides, mileposts every quarter mile with the mile on the whole ones, and at each station a building behind the
// platform and, where there are two platforms, a footbridge over the line. Built a stretch at a time as the camera
// comes near (draw.js Near), the poles and posts one shape each, many times over.

import * as THREE from 'three'
import { solid, textCanvas, outlined } from './draw.js'
import { HALF } from './line.js'

const CHUNK = 2000
const poleGeo = new THREE.CylinderGeometry(0.11, 0.15, 8, 6).translate(0, 4, 0)
const armGeo = new THREE.BoxGeometry(1.6, 0.1, 0.1).translate(0, 7.5, 0)
const postGeo = new THREE.BoxGeometry(0.1, 1.3, 0.1).translate(0, 0.65, 0)
const mileGeo = new THREE.BoxGeometry(0.16, 1.1, 0.16).translate(0, 0.55, 0)
for (const g of [poleGeo, armGeo, postGeo, mileGeo]) g.userData.shared = true
const wood = solid(0x4a3a2c), wire = new THREE.LineBasicMaterial({ color: 0x2a2a2e }), white = solid(0xe8e4dc)

export class Land {
  constructor(near, ctx) { this.near = near; this.ctx = ctx }
  add(line) {
    // (a tramway runs down a street and along a prom: no railway's fences, poles or station buildings)
    if (line.meta.kind === 'tram') return
    for (let a = 0; a < line.length; a += CHUNK) {
      const b = Math.min(line.length, a + CHUNK), [x, z] = line.centre((a + b) / 2)
      this.near.add({ kind: 'lineside', x, z, r: CHUNK / 2, reach: 3500, needsGround: true, pts: [line.centre(a), line.centre(b)], build: () => this.stretch(line, a, b) })
    }
    line.stops.forEach((st, k) => { const [x, z] = line.centre(st.s); this.near.add({ kind: 'station-building', x, z, reach: 3000, build: () => this.station(line, st, k) }) })
  }
  // (nothing along a bridge, in a tunnel or through a station's platforms)
  clear(line, s) {
    const st = line.structureAt(s)
    if (st && (st.kind === 'bridge' || line.inTunnel(s))) return false
    return !line.stops.some((x) => Math.abs(x.s - s) < 70)
  }
  stretch(line, a, b) {
    const g = new THREE.Group()
    const [ax, az] = line.centre((a + b) / 2), anchor = new THREE.Vector3(Math.round(ax), 0, Math.round(az))
    g.position.copy(anchor)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1)
    const H = (x, z, s) => this.ctx.ground.h(x, z) ?? line.trackY(s)
    const at = (s, off) => { const [x, z] = line.centre(s), [tx, tz] = line.tangent(s), o = line.laneAt(s) + off; return [x + tz * o, z - tx * o] }
    // the telegraph poles, every 55 m on the left going up the line, and three wires between each pair
    const poles = [], wires = []
    for (let s = Math.ceil(a / 55) * 55; s < b; s += 55) {
      if (!this.clear(line, s)) continue
      const off = HALF * line.twoAt(s) + 9
      const [x, z] = at(s, off), y = H(x, z, s)
      poles.push([x, y, z, s])
    }
    for (let k = 1; k < poles.length; k++) {
      const [x0, y0, z0, s0] = poles[k - 1], [x1, y1, z1, s1] = poles[k]
      if (s1 - s0 > 70) continue
      for (const [dx, dy] of [[-0.65, 7.45], [0, 7.45], [0.65, 7.45]]) {
        const [tx0, tz0] = line.tangent(s0), [tx1, tz1] = line.tangent(s1)
        const p0 = new THREE.Vector3(x0 + tz0 * dx, y0 + dy, z0 - tx0 * dx).sub(anchor), p1 = new THREE.Vector3(x1 + tz1 * dx, y1 + dy, z1 - tx1 * dx).sub(anchor)
        const mid = p0.clone().add(p1).multiplyScalar(0.5); mid.y -= 0.45
        wires.push(p0, mid, mid, p1)
      }
    }
    if (poles.length) {
      const pm = new THREE.InstancedMesh(poleGeo, wood, poles.length), am = new THREE.InstancedMesh(armGeo, wood, poles.length)
      poles.forEach(([x, y, z, s], k) => { q.setFromAxisAngle(up, line.yaw(s)); m.compose(new THREE.Vector3(x - anchor.x, y - 0.2, z - anchor.z), q, one); pm.setMatrixAt(k, m); am.setMatrixAt(k, m) })
      g.add(pm, am)
      if (wires.length) g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wires), wire))
    }
    // the boundary fence both sides: a post every 3 m, three wires
    const posts = [], strands = []
    for (const side of [1, -1]) {
      let prev = null
      for (let s = Math.ceil(a / 3) * 3; s < b; s += 3) {
        if (!this.clear(line, s)) { prev = null; continue }
        const off = side * (HALF * line.twoAt(s) + 13)
        const [x, z] = at(s, off), y = H(x, z, s)
        posts.push([x, y, z, s])
        if (prev) for (const h of [0.45, 0.8, 1.15]) strands.push(new THREE.Vector3(prev[0] - anchor.x, prev[1] + h, prev[2] - anchor.z), new THREE.Vector3(x - anchor.x, y + h, z - anchor.z))
        prev = [x, y, z]
      }
    }
    if (posts.length) {
      const fm = new THREE.InstancedMesh(postGeo, wood, posts.length)
      posts.forEach(([x, y, z], k) => { m.compose(new THREE.Vector3(x - anchor.x, y - 0.1, z - anchor.z), q.identity(), one); fm.setMatrixAt(k, m) })
      g.add(fm)
      g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(strands), wire))
    }
    // the mileposts, every quarter mile on the left, the whole miles with their number
    const quarter = 1609.344 / 4
    const miles = []
    for (let s = Math.ceil(a / quarter) * quarter; s < b; s += quarter) {
      if (!this.clear(line, s)) continue
      const [x, z] = at(s, HALF * line.twoAt(s) + 3.6)
      miles.push([x, H(x, z, s), z, s])
    }
    if (miles.length) {
      const mm = new THREE.InstancedMesh(mileGeo, white, miles.length)
      miles.forEach(([x, y, z], k) => { m.compose(new THREE.Vector3(x - anchor.x, y, z - anchor.z), q.identity(), one); mm.setMatrixAt(k, m) })
      g.add(mm)
      for (const [x, y, z, s] of miles) {
        const n = Math.round(s / 1609.344 * 4)
        if (n % 4) continue
        const board = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5), new THREE.MeshBasicMaterial({ map: textCanvas([String(n / 4)], { w: 128, h: 96, size: 64, box: false, fg: '#0b0b0d' }), color: 0xe8e4dc, side: THREE.DoubleSide }))
        board.position.set(x - anchor.x, y + 1.25, z - anchor.z); board.rotation.y = line.yaw(s) + Math.PI / 2
        g.add(board)
      }
    }
    return g
  }
  station(line, st, k) {
    const g = new THREE.Group()
    const two = line.twoAt(st.s) > 0.5
    const side = two ? 1 : k % 2 ? -1 : 1
    const behind = side * ((two ? HALF : 0) + 1.5 + 5.2 + 5)
    // the building: brick, a pitched roof, its windows lit after dark (the town's own house material)
    const house = new THREE.Group()
    const walls = outlined(new THREE.BoxGeometry(6, 3.6, 16), 0x6a3b2a); walls.position.y = 1.8; house.add(walls)
    const prof = new THREE.Shape([new THREE.Vector2(-3.4, 0), new THREE.Vector2(3.4, 0), new THREE.Vector2(0, 2.2)])
    const roof = outlined(new THREE.ExtrudeGeometry(prof, { depth: 17, bevelEnabled: false }).translate(0, 3.6, -8.5), 0x2b2a27); house.add(roof)
    for (const z of [-5, 0, 5]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.4), this.ctx.mats.house); w.position.set(-side * 3.02, 2, z); w.rotation.y = -side * Math.PI / 2; house.add(w) }
    g.add(line.placeAlong(house, st.s + 10, behind, 0.4))
    house.position.y = (this.ctx.ground.h(house.position.x, house.position.z) ?? house.position.y) - 0.1
    // the footbridge over two tracks: steps up from each platform and a deck across
    if (two) {
      const bridge = new THREE.Group()
      const span = 2 * (HALF + 1.5 + 5.2)
      const deck = outlined(new THREE.BoxGeometry(span, 0.4, 2.2), 0x3a3a40); deck.position.y = 6.2; bridge.add(deck)
      for (const sx of [-1, 1]) {
        const sideW = outlined(new THREE.BoxGeometry(span, 1.2, 0.08), 0x2a2a30); sideW.position.set(0, 7, sx * 1.1); bridge.add(sideW)
        const tower = outlined(new THREE.BoxGeometry(2.2, 6.4, 2.2), 0x3a3a40); tower.position.set(sx * (span / 2 - 1.1), 3.2, 0); bridge.add(tower)
      }
      // (placed along the line, its length runs across it)
      g.add(line.placeAlong(bridge, st.s - 30, 0, 0.6))
    }
    return g
  }
}
