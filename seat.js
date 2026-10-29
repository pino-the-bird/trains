// A seat by the window (his to add, 29 Oct; sleepyMoth15: "I'll try to model a similar carriage interior for the
// simulator"): the view from a seat in the second carriage, looking out of the window at the land going by, with the
// carriage round it: the window's frame, the seat back in front, the table under the window, the luggage rack above.
// Carried with the camera, laid out to its view like the cab (cab.js).

import * as THREE from 'three'
import { INK, PINK } from './draw.js'

export class Seat {
  constructor(camera) {
    this.camera = camera
    this.group = new THREE.Group()
    this.group.visible = false
    camera.add(this.group)
    const mat = (c) => new THREE.MeshBasicMaterial({ color: c })
    const line = new THREE.LineBasicMaterial({ color: INK })
    const plate = (w, h, c) => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(c)); g.add(m); g.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), line)); this.group.add(g); return g }
    this.wallTop = plate(4, 0.6, 0xd8d2c6)
    this.wallBot = plate(4, 0.6, 0xd8d2c6)
    this.pillarL = plate(0.16, 2, 0xc8c2b6)
    this.pillarR = plate(0.16, 2, 0xc8c2b6)
    this.rack = plate(4, 0.05, 0x55524c)
    this.table = plate(0.7, 0.05, 0x3a3833)
    this.seatBack = plate(0.13, 0.2, 0x2a4a7a)
    this.headrest = plate(0.11, 0.035, PINK)
    for (const o of this.group.children) o.renderOrder = 20
    this.group.traverse((o) => { if (o.material) { o.material.depthTest = false; o.material.fog = false; o.material.userData.shared = true; o.renderOrder = 20 } })
    this.aspect = 0
  }
  layout() {
    const Z = -0.6, h = Math.abs(Z) * Math.tan((this.camera.fov * Math.PI) / 360), w = h * this.camera.aspect
    this.aspect = this.camera.aspect
    const at = (o, x, y) => o.position.set(x, y, Z)
    // the window: wall above and below, a pillar each side, a little in from the edges
    const top = h * 0.62, bottom = -h * 0.45, side = Math.min(w * 0.82, w - 0.05)
    at(this.wallTop, 0, top + 0.3); at(this.wallBot, 0, bottom - 0.3)
    at(this.pillarL, -side - 0.08, 0); at(this.pillarR, side + 0.08, 0)
    at(this.rack, 0, top + 0.06)
    at(this.table, 0, bottom + 0.02)
    at(this.seatBack, -side + 0.06, bottom + 0.06); at(this.headrest, -side + 0.06, bottom + 0.17)
  }
  update() { this.group.visible = true; if (this.aspect !== this.camera.aspect) this.layout() }
  hide() { this.group.visible = false }
}
