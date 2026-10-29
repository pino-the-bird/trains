// The trains: what each is made of, and a train put on its line. The four from 24 Oct (Sam: "ride different trains
// from the ui"): the diesel unit as they run these lines, an express of four, a freight behind a loco, a steam engine
// with its tender and three coaches; each in Pino's colours with the key line round it, lamps lit at whichever end
// leads, the inside lit after dark.

import * as THREE from 'three'
import { INK, PINK, CYAN, GOLD, inkLine, solid, flat, outlined, textCanvas, dispose } from './draw.js'
import { CAR, GAP, KINDS } from './kinds.js'

export { CAR, GAP, KINDS, lengthOf } from './kinds.js'

// shared by every train (the windows glow after dark, all at once)
export const glassMat = new THREE.MeshLambertMaterial({ color: 0x0b0d12, emissive: new THREE.Color(0xffe6a8), emissiveIntensity: 0 })
glassMat.userData.shared = true
const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffee }); lampMat.userData.shared = true
const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a }); tailMat.userData.shared = true
const wheelMat = solid(0x2a2a2e)
const blinds = new Map()
function blindTex(dest) {
  if (!blinds.has(dest)) { const t = textCanvas([dest], { w: 512, h: 110, size: 64, box: false, fg: '#f0c44d' }); blinds.set(dest, new THREE.MeshBasicMaterial({ map: t, transparent: true })); blinds.get(dest).userData.shared = true }
  return blinds.get(dest)
}

function bogie(z, wheels) {
  const g = new THREE.Group()
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.5, 3), solid(0x1b1b1f)); frame.position.y = 0.75; g.add(frame)
  for (const dz of [-0.95, 0.95]) for (const x of [-0.75, 0.75]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.14, 14), wheelMat)
    w.rotation.z = Math.PI / 2; w.position.set(x, 0.46, dz); g.add(w); wheels.push(w)
    const rim = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 14 }, (_, k) => new THREE.Vector3(0, Math.cos((k / 14) * Math.PI * 2) * 0.46, Math.sin((k / 14) * Math.PI * 2) * 0.46))), inkLine)
    rim.position.set(x + Math.sign(x) * 0.08, 0.46, dz); g.add(rim)
  }
  g.position.z = z
  return g
}
function carBody(L, colour, { cabs = true, low = false } = {}) {
  // the side silhouette, extruded across the width: the floor, the raked ends, the curve of the roof
  const h = low ? 2.4 : 3.4, rake = cabs ? 1.1 : 0.2
  const sh = new THREE.Shape()
  sh.moveTo(-L / 2 + rake, 0.7); sh.lineTo(L / 2 - rake, 0.7); sh.lineTo(L / 2, 1.5); sh.lineTo(L / 2, h - 0.9)
  sh.quadraticCurveTo(L / 2, h, L / 2 - 0.9, h); sh.lineTo(-L / 2 + 0.9, h); sh.quadraticCurveTo(-L / 2, h, -L / 2, h - 0.9)
  sh.lineTo(-L / 2, 1.5); sh.lineTo(-L / 2 + rake, 0.7)
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 2.7, bevelEnabled: false, curveSegments: 6 })
  geo.translate(0, 0, -1.35)
  geo.rotateY(Math.PI / 2)
  return outlined(geo, colour)
}
/** A car of the diesel unit, a cab at each end, the destination over each. */
function car(t) {
  const g = new THREE.Group()
  g.add(carBody(CAR, CYAN))
  for (const x of [-1.36, 1.36]) {
    const band = new THREE.Mesh(new THREE.PlaneGeometry(CAR - 4.4, 0.95), glassMat); band.position.set(x, 2.45, 0); band.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2; g.add(band)
    const pts = []
    for (let z = -CAR / 2 + 2.2; z <= CAR / 2 - 2.2; z += 2.1) pts.push(new THREE.Vector3(x + Math.sign(x) * 0.005, 1.98, z), new THREE.Vector3(x + Math.sign(x) * 0.005, 2.92, z))
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), inkLine))
    for (const z of [-CAR / 2 + 3.2, CAR / 2 - 3.2]) { const door = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.3, 2.3)), inkLine); door.position.set(x + Math.sign(x) * 0.01, 1.9, z); door.rotation.y = Math.PI / 2; g.add(door) }
  }
  for (const z of [-CAR / 2, CAR / 2]) {
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.0), glassMat); screen.position.set(0, 2.5, z + Math.sign(z) * 0.02); screen.rotation.y = z > 0 ? 0 : Math.PI; g.add(screen)
    const blind = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.34), blindTex(t.dest)); blind.position.set(0, 3.1, z + Math.sign(z) * 0.03); blind.rotation.y = z > 0 ? 0 : Math.PI; g.add(blind)
    const yellow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), flat(GOLD)); yellow.position.set(0, 1.2, z + Math.sign(z) * 0.02); yellow.rotation.y = z > 0 ? 0 : Math.PI; g.add(yellow)
    const tail = new THREE.Mesh(new THREE.CircleGeometry(0.12, 10), tailMat); tail.position.set(-0.9, 1.6, z + Math.sign(z) * 0.03); tail.rotation.y = z > 0 ? 0 : Math.PI; g.add(tail)
  }
  const band = new THREE.Mesh(new THREE.BoxGeometry(2.76, 0.22, CAR - 2.4), flat(PINK)); band.position.y = 1.72; g.add(band)
  for (const z of [-CAR / 2 + 5, 0, CAR / 2 - 5]) { const pod = outlined(new THREE.BoxGeometry(1.4, 0.3, 2.6), 0x1f2a30); pod.position.set(0, 3.5, z); g.add(pod) }
  for (const z of [-CAR / 2 + 4.2, CAR / 2 - 4.2]) g.add(bogie(z, t.wheels))
  return g
}
/** A coach: the unit's body without the cabs, in maroon, its windows. */
function coach(t) {
  const g = new THREE.Group()
  g.add(carBody(CAR, 0x7a2a2a, { cabs: false }))
  for (const x of [-1.36, 1.36]) {
    const band = new THREE.Mesh(new THREE.PlaneGeometry(CAR - 3, 0.9), glassMat); band.position.set(x, 2.45, 0); band.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2; g.add(band)
    const pts = []
    for (let z = -CAR / 2 + 1.5; z <= CAR / 2 - 1.5; z += 1.9) pts.push(new THREE.Vector3(x + Math.sign(x) * 0.005, 2, z), new THREE.Vector3(x + Math.sign(x) * 0.005, 2.9, z))
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), inkLine))
  }
  const band = new THREE.Mesh(new THREE.BoxGeometry(2.76, 0.18, CAR - 1), flat(GOLD)); band.position.y = 1.7; g.add(band)
  for (const z of [-CAR / 2 + 4.2, CAR / 2 - 4.2]) g.add(bogie(z, t.wheels))
  return g
}
/** A diesel loco for the freight: a long hood, a cab at each end, the pink band. */
function loco(t) {
  const g = new THREE.Group()
  g.add(carBody(CAR - 3, 0x2a2a30))
  const hood = outlined(new THREE.BoxGeometry(2.4, 0.9, CAR - 7), 0x1f1f24); hood.position.y = 3.6; g.add(hood)
  const band = new THREE.Mesh(new THREE.BoxGeometry(2.76, 0.3, CAR - 5), flat(PINK)); band.position.y = 1.9; g.add(band)
  for (const z of [-CAR / 2 + 1.5, CAR / 2 - 1.5]) { const screen = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.8), glassMat); screen.position.set(0, 2.6, z + Math.sign(z) * 0.02); screen.rotation.y = z > 0 ? 0 : Math.PI; g.add(screen); const yellow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1), flat(GOLD)); yellow.position.set(0, 1.3, z + Math.sign(z) * 0.02); yellow.rotation.y = z > 0 ? 0 : Math.PI; g.add(yellow) }
  for (const z of [-CAR / 2 + 4.6, CAR / 2 - 4.6]) g.add(bogie(z, t.wheels))
  return g
}
/** The steam engine: boiler, smokebox and chimney, the cab, three big driving wheels a side with their rods. */
function steam(t) {
  const g = new THREE.Group()
  const L = 11
  const frame = outlined(new THREE.BoxGeometry(2.4, 0.5, L), 0x1b1b1f); frame.position.y = 1.2; g.add(frame)
  const boiler = outlined(new THREE.CylinderGeometry(1.05, 1.05, L - 4, 14).rotateX(Math.PI / 2), 0x1f3b2a); boiler.position.set(0, 2.9, 1.2); g.add(boiler)
  const smokebox = outlined(new THREE.CylinderGeometry(1.08, 1.08, 1.4, 14).rotateX(Math.PI / 2), 0x151517); smokebox.position.set(0, 2.9, L / 2 - 1.2); g.add(smokebox)
  const chimney = outlined(new THREE.CylinderGeometry(0.28, 0.36, 1.1, 10), 0x151517); chimney.position.set(0, 4.4, L / 2 - 1.2); g.add(chimney)
  const dome = outlined(new THREE.SphereGeometry(0.5, 10, 8), 0x1f3b2a); dome.position.set(0, 3.9, 0.5); g.add(dome)
  const cab = outlined(new THREE.BoxGeometry(2.6, 2.6, 2.6), 0x1f3b2a); cab.position.set(0, 3.0, -L / 2 + 1.6); g.add(cab)
  const roof = outlined(new THREE.BoxGeometry(2.8, 0.16, 2.8), 0x151517); roof.position.set(0, 4.35, -L / 2 + 1.6); g.add(roof)
  const band = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.14, 2.62), flat(GOLD)); band.position.set(0, 2.2, -L / 2 + 1.6); g.add(band)
  const beam = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.4, 0.2), flat(0xa01010)); beam.position.set(0, 1.0, L / 2); g.add(beam)
  for (const x of [-1.25, 1.25]) {
    for (const z of [-2.6, 0, 2.6]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.16, 16), wheelMat); w.rotation.z = Math.PI / 2; w.position.set(x, 0.95, z); g.add(w); t.wheels.push(w)
      const spokes = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 16 }, (_, k) => new THREE.Vector3(0, Math.cos((k / 8) * Math.PI) * 0.9, Math.sin((k / 8) * Math.PI) * 0.9))), inkLine); spokes.position.set(x + Math.sign(x) * 0.09, 0.95, z); w.userData.spokes = spokes; g.add(spokes)
    }
    const small = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.14, 12), wheelMat); small.rotation.z = Math.PI / 2; small.position.set(x, 0.45, L / 2 - 1.2); g.add(small); t.wheels.push(small)
    const rod = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 5.4), flat(0xcfcac0)); rod.position.set(x + Math.sign(x) * 0.18, 0.95, 0); g.add(rod); rod.userData.rod = true; t.wheels.push(rod)
  }
  t.chimney = new THREE.Vector3(0, 4.9, L / 2 - 1.2)
  t.steamer = g
  return g
}
function tender(t) {
  const g = new THREE.Group()
  const body = outlined(new THREE.BoxGeometry(2.6, 2.4, 7), 0x1f3b2a); body.position.y = 2.2; g.add(body)
  const coal = outlined(new THREE.BoxGeometry(2.2, 0.5, 4), 0x0b0b0d); coal.position.set(0, 3.5, 0.5); g.add(coal)
  const band = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.14, 7.02), flat(GOLD)); band.position.y = 2.2; g.add(band)
  for (const z of [-2.2, 2.2]) g.add(bogie(z, t.wheels))
  return g
}
function wagon(t) {
  const g = new THREE.Group()
  g.add(carBody(CAR - 2, GOLD, { cabs: false, low: true }))
  const load = outlined(new THREE.BoxGeometry(2.2, 0.5, CAR - 6), 0x4a4741); load.position.y = 2.5; g.add(load)
  for (const z of [-CAR / 2 + 4.2, CAR / 2 - 4.2]) g.add(bogie(z, t.wheels))
  return g
}

// what each kind is made of (the lengths are kinds.js's)
const MAKE = { dmu: [car, car], express: [car, coach, coach, car], freight: [loco, wagon, wagon, wagon], steam: [steam, tender, coach, coach, coach] }

/**
 * A train you can see: its vehicles, placed on its line each frame by where the railway says it is. dest: what its
 * blinds say. Its lamps are lit at the leading end; its windows glow after dark.
 */
export class Train3D {
  constructor(kind, dest) {
    this.kind = KINDS[kind] ? kind : 'dmu'
    this.wheels = []
    this.dest = dest
    this.cars = MAKE[this.kind].map((f) => f(this))
    this.lens = KINDS[this.kind].lens.slice()
    this.group = new THREE.Group()
    for (const c of this.cars) this.group.add(c)
    this.lamps = new THREE.Group()
    for (const x of [-0.8, 0.8]) { const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), lampMat); lamp.position.set(x, 1.6, 0.05); this.lamps.add(lamp) }
    { const top = new THREE.Mesh(new THREE.CircleGeometry(0.14, 16), lampMat); top.position.set(0, 3.25, 0.05); this.lamps.add(top) }
    this.dist = 0
    this.lead = 0
  }
  /** Where each vehicle is: line, the front at s, going dir, on side (eased between tracks), pos(s) the line's own. */
  place(line, s, dir, side, travelled) {
    // (at the end of the line the train does not turn: its other end leads, and an engine at the back runs backwards)
    if (this.dir && dir !== this.dir) { this.cars.reverse(); this.lens.reverse(); for (const c of this.cars) c.userData.back = !c.userData.back }
    this.dir = dir
    let back = 0
    const f = new THREE.Vector3(), b = new THREE.Vector3()
    this.cars.forEach((c, k) => {
      const L = this.lens[k]
      const mid = s - dir * (back + L / 2)
      back += L + GAP
      const h = Math.min(8, L / 2 - 0.5)
      line.pos(mid + dir * h, side, 0, f); line.pos(mid - dir * h, side, 0, b)
      c.position.copy(f).add(b).multiplyScalar(0.5)
      c.lookAt(f)
      if (c.userData.back) c.rotateY(Math.PI)
    })
    // the lamps at the front of whichever end leads
    const front = this.cars[0]
    if (this.lamps.parent !== front) front.add(this.lamps)
    this.lamps.position.set(0, 0, this.lens[0] / 2)
    // the wheels turn with the distance it has gone
    const dd = travelled - this.dist
    this.dist = travelled
    for (const w of this.wheels) {
      if (w.userData.rod) { w.position.y = 0.95 + Math.sin(travelled / 0.95) * 0.3; continue }
      const r = w.geometry.parameters?.radiusTop || 0.46
      w.rotation.x += dd / r
      if (w.userData.spokes) w.userData.spokes.rotation.x = w.rotation.x
    }
  }
  dispose() { dispose(this.group) }
}
