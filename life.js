// Life along the line (his to add, 29 Oct): people waiting on the platforms, sheep on the fells and cows lower down in
// the fields beside the line, and cars waiting at the level crossings while the barriers are down (a red hatchback
// among them: slyShrew80's stripped GTI, which he said he would drop into the simulator). Small and low, in the
// simulator's own drawing, built as the camera comes near.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { mulberry, hashStr } from './geo.js'
import { HALF } from './line.js'

const person = mergeGeometries([new THREE.CylinderGeometry(0.22, 0.26, 1.15, 6).translate(0, 0.58, 0), new THREE.SphereGeometry(0.17, 6, 5).translate(0, 1.33, 0)])
const sheep = mergeGeometries([new THREE.BoxGeometry(0.5, 0.45, 0.9).translate(0, 0.55, 0), new THREE.BoxGeometry(0.22, 0.25, 0.3).translate(0, 0.72, 0.55)])
const cow = mergeGeometries([new THREE.BoxGeometry(0.75, 0.8, 1.9).translate(0, 1.05, 0), new THREE.BoxGeometry(0.35, 0.4, 0.5).translate(0, 1.25, 1.15), ...[[-0.25, -0.7], [0.25, -0.7], [-0.25, 0.7], [0.25, 0.7]].map(([x, z]) => new THREE.BoxGeometry(0.14, 0.65, 0.14).translate(x, 0.33, z))])
const carBody = mergeGeometries([new THREE.BoxGeometry(1.7, 0.7, 4).translate(0, 0.65, 0), new THREE.BoxGeometry(1.5, 0.55, 2.1).translate(0, 1.27, -0.3)])
const hatch = mergeGeometries([new THREE.BoxGeometry(1.65, 0.7, 3.6).translate(0, 0.62, 0), new THREE.BoxGeometry(1.5, 0.6, 2.2).translate(0, 1.25, -0.5)])
for (const g of [person, sheep, cow, carBody, hatch]) g.userData.shared = true
const mats = {
  person: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  sheep: new THREE.MeshLambertMaterial({ color: 0xe8e4dc }),
  cow: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  car: new THREE.MeshLambertMaterial({ color: 0xffffff }),
}
for (const m of Object.values(mats)) m.userData.shared = true
const COATS = [0x2fd1ff, 0xe14a89, 0xa7cd07, 0xf0c44d, 0x3a3833, 0x7a2a2a, 0x8d8a84, 0x1f3b2a]
const CARS = [0x8d8a84, 0x15151a, 0x2a4a6a, 0xe8e4dc, 0x5a5a60]

export class Life {
  constructor(near, ctx) { this.near = near; this.ctx = ctx }
  add(line) {
    line.stops.forEach((st, k) => { const [x, z] = line.centre(st.s); this.near.add({ kind: 'people', x, z, reach: 1500, build: () => this.people(line, st, k) }) })
    for (let a = 0; a < line.length; a += 2000) {
      const b = Math.min(line.length, a + 2000), [x, z] = line.centre((a + b) / 2)
      this.near.add({ kind: 'beasts', x, z, r: 1000, reach: 2500, needsGround: true, pts: [line.centre(a), line.centre(b)], build: () => this.beasts(line, a, b) })
    }
  }
  /** The crossings once the line's are known (line.js puts them on ctx.crossings as it is added). */
  crossings(line) {
    for (const cr of this.ctx.crossings) {
      if (cr.line !== line || cr.cars) continue
      cr.cars = true
      const [x, z] = line.centre(cr.s)
      this.near.add({ kind: 'traffic', x, z, reach: 1500, build: () => this.traffic(line, cr) })
    }
  }
  people(line, st, k) {
    const rng = mulberry(hashStr(`${line.slug}:${k}`))
    const two = line.twoAt(st.s) > 0.5
    const sides = two ? [1, -1] : [k % 2 ? -1 : 1]
    const n = 3 + Math.floor(rng() * 9)
    const im = new THREE.InstancedMesh(person, mats.person, n * sides.length)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color(), p = new THREE.Vector3()
    let i = 0
    for (const sd of sides) for (let j = 0; j < n; j++) {
      const s = st.s + (rng() - 0.5) * 80, off = sd * ((two ? HALF : 0) + 1.5 + 1 + rng() * 3.2)
      line.pos(s, 0, 1, p)
      const [tx, tz] = line.tangent(s), o = off
      p.x += tz * o; p.z -= tx * o
      q.setFromAxisAngle(up, line.yaw(s) + (sd > 0 ? -Math.PI / 2 : Math.PI / 2) + (rng() - 0.5) * 1.2)
      im.setMatrixAt(i, m.compose(p, q, new THREE.Vector3(1, 0.9 + rng() * 0.25, 1)))
      im.setColorAt(i++, c.set(COATS[Math.floor(rng() * COATS.length)]))
    }
    return anchoredInstances(im)
  }
  beasts(line, a, b) {
    const rng = mulberry(hashStr(`${line.slug}:${a}`))
    const g = new THREE.Group()
    const sheepAt = [], cowsAt = []
    // a flock or a herd every few hundred metres, out in the fields either side, sheep on the high ground
    for (let s = a + rng() * 400; s < b; s += 300 + rng() * 500) {
      const st = line.structureAt(s); if (st && line.inTunnel(s)) continue
      const side = rng() < 0.5 ? 1 : -1, off = side * (30 + rng() * 140)
      const [cx, cz] = line.centre(s), [tx, tz] = line.tangent(s)
      const fx = cx + tz * off, fz = cz - tx * off
      const h = this.ctx.ground.h(fx, fz); if (h == null || h < 1) continue
      const list = h > 180 ? sheepAt : cowsAt, n = h > 180 ? 5 + Math.floor(rng() * 10) : 3 + Math.floor(rng() * 5)
      for (let k = 0; k < n; k++) { const x = fx + (rng() - 0.5) * 40, z = fz + (rng() - 0.5) * 40; list.push([x, this.ctx.ground.h(x, z) ?? h, z, rng() * Math.PI * 2]) }
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), c = new THREE.Color()
    for (const [list, geo, mat, colour] of [[sheepAt, sheep, mats.sheep, null], [cowsAt, cow, mats.cow, (r) => (r < 0.5 ? 0x15151a : r < 0.8 ? 0x6a3b2a : 0xe8e4dc)]]) {
      if (!list.length) continue
      const im = new THREE.InstancedMesh(geo, mat, list.length)
      list.forEach(([x, y, z, r], k) => { im.setMatrixAt(k, m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, r), one)); if (colour) im.setColorAt(k, c.set(colour(rng()))) })
      g.add(anchoredInstances(im))
    }
    return g
  }
  traffic(line, cr) {
    const g = new THREE.Group()
    const rng = mulberry(hashStr(`${line.slug}:cr:${Math.round(cr.s)}`))
    const im = new THREE.InstancedMesh(carBody, mats.car, 3)
    const gti = new THREE.Mesh(hatch, new THREE.MeshLambertMaterial({ color: 0xc8102e }))
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), c = new THREE.Color()
    // queued on the road either side of the barriers, facing the line (the road runs across it)
    const spots = [[-9.5, 1], [-15, 1], [9.5, -1], [15, -1]]
    spots.forEach(([x, face], k) => {
      q.setFromAxisAngle(up, face > 0 ? Math.PI / 2 : -Math.PI / 2)
      const p = new THREE.Vector3(x, 0.4, face > 0 ? 1.4 : -1.4)
      if (k === 2) { gti.position.copy(p); gti.quaternion.copy(q); g.add(gti); return }
      im.setMatrixAt(k > 2 ? 2 : k, m.compose(p, q, one)); im.setColorAt(k > 2 ? 2 : k, c.set(CARS[Math.floor(rng() * CARS.length)]))
    })
    g.add(im)
    line.placeAlong(g, cr.s, 0, 0)
    // (there while the barriers are down: sim.js shows them by the crossing's own state)
    g.visible = false
    cr.traffic = g
    return g
  }
}

/** An instanced mesh whose instances were placed in the world, moved to a point of its own so its numbers stay small. */
function anchoredInstances(im) {
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3()
  im.getMatrixAt(0, m); m.decompose(p, q, sc)
  const ax = Math.round(p.x), az = Math.round(p.z)
  for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m); m.decompose(p, q, sc); p.x -= ax; p.z -= az; im.setMatrixAt(i, m.compose(p, q, sc)) }
  im.position.set(ax, 0, az)
  im.instanceMatrix.needsUpdate = true
  if (im.instanceColor) im.instanceColor.needsUpdate = true
  return im
}
