// A driver's cab (his to add, 29 Oct): the view from the cab with the cab round it. The windscreen and its pillars,
// the desk under it with the speedometer and its needle, the brake gauge, the clock, the warning indicator (black when
// all is well, the yellow and black sunflower after a caution), the power and brake handle that moves as it is driven,
// wipers that run in the rain with drops on the glass, and the cab swaying through the curves and jolting at the rail
// joints. Low and flat-shaded, in Pino's colours, carried with the camera.

import * as THREE from 'three'
import { INK, ACID, PINK, GOLD } from './draw.js'
import { clamp } from './geo.js'

const DESK = 0x18191d, FRAME = 0x101114

function dial(size = 256) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace
  return { cv, g: cv.getContext('2d'), tex, last: null }
}

export class Cab {
  constructor(camera) {
    this.camera = camera
    this.group = new THREE.Group()
    this.group.visible = false
    camera.add(this.group)
    const mat = (c) => new THREE.MeshBasicMaterial({ color: c })
    const line = new THREE.LineBasicMaterial({ color: INK })
    const plate = (w, h, c) => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(c)); g.add(m); g.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), line)); this.group.add(g); return g }
    // the windscreen's frame (two pillars, the roof edge, the middle pillar), the desk under it with its pink edge;
    // laid out to the camera's own view in layout(), so they sit at its edges on any screen
    this.pillarL = plate(0.09, 1.2, FRAME); this.pillarR = plate(0.09, 1.2, FRAME)
    this.roof = plate(3, 0.08, FRAME)
    this.middle = plate(0.022, 1.2, FRAME)
    this.desk = plate(3, 0.2, DESK)
    this.strip = plate(3, 0.008, PINK)
    // the gauges on the desk, each a little face drawn as it changes
    this.speedo = dial(256); this.brakeG = dial(128); this.clockD = dial(256); this.aws = dial(128)
    const face = (d, w, h) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: d.tex, transparent: true })); this.group.add(m); return m }
    this.faces = { speedo: face(this.speedo, 0.12, 0.12), brake: face(this.brakeG, 0.075, 0.075), clock: face(this.clockD, 0.16, 0.054), aws: face(this.aws, 0.055, 0.055) }
    // the power and brake handle, on the left of the desk, turning with the notch
    this.handle = new THREE.Group()
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.08, 0.014), mat(0x55524c)); shaft.position.y = 0.04; this.handle.add(shaft)
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), mat(GOLD)); knob.position.y = 0.085; this.handle.add(knob)
    this.group.add(this.handle)
    // the glass: drops in the rain, and two wipers parked along the bottom of it
    this.drops = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xcfdbe6, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.55, depthTest: false }))
    this.dropPos = new Float32Array(90 * 3)
    this.drops.geometry.setAttribute('position', new THREE.BufferAttribute(this.dropPos, 3))
    this.drops.frustumCulled = false
    this.group.add(this.drops)
    this.wipers = [0, 1].map(() => { const p = new THREE.Group(); const blade = new THREE.Mesh(new THREE.PlaneGeometry(0.008, 0.26), mat(FRAME)); blade.position.y = 0.13; p.add(blade); this.group.add(p); return p })
    this.wipeT = 0
    this.sway = 0
    this.jolt = 0
    this.aspect = 0
    for (const o of this.group.children) o.renderOrder = 20
    this.group.traverse((o) => { if (o.material) { o.material.depthTest = false; o.material.fog = false; o.material.userData.shared = true; o.renderOrder = 20 } })
  }

  /** Everything put where the camera sees it: the pillars at the edges, the desk along the bottom, the dials on it. */
  layout() {
    const Z = -0.6, h = Math.abs(Z) * Math.tan((this.camera.fov * Math.PI) / 360), w = h * this.camera.aspect
    this.aspect = this.camera.aspect
    const at = (o, x, y) => o.position.set(x, y, Z)
    at(this.pillarL, -w + 0.03, 0); this.pillarL.rotation.z = -0.08
    at(this.pillarR, w - 0.03, 0); this.pillarR.rotation.z = 0.08
    at(this.roof, 0, h - 0.02)
    at(this.middle, 0, 0)
    // (on a narrow screen the middle pillar would cut the line in two: it is there only when there is room)
    this.middle.visible = this.camera.aspect > 1.1
    // (high enough that the strip along the bottom of the page does not cover the dials)
    const top = -h + 0.2
    at(this.desk, 0, top - 0.1); this.desk.scale.y = 1.5
    at(this.strip, 0, top)
    const dy = top - 0.07, k = Math.min(1, w / 0.55)
    at(this.faces.speedo, -0.02 * k, dy); this.faces.speedo.scale.setScalar(k)
    at(this.faces.brake, 0.11 * k, dy - 0.01); this.faces.brake.scale.setScalar(k)
    at(this.faces.clock, 0.26 * k, dy); this.faces.clock.scale.setScalar(k)
    at(this.faces.aws, -0.14 * k, dy - 0.01); this.faces.aws.scale.setScalar(k)
    at(this.handle, -0.3 * k, top - 0.06); this.handle.scale.setScalar(k)
    this.wipers[0].position.set(-w * 0.55, top + 0.005, Z + 0.01); this.wipers[1].position.set(w * 0.05, top + 0.005, Z + 0.01)
    this.glass = { w, top, h, Z }
    for (let k2 = 0; k2 < 90; k2++) this.drop(k2)
  }
  drop(k) { const g = this.glass; this.dropPos.set([(Math.random() - 0.5) * 2 * g.w * 0.9, g.top + Math.random() * (g.h - g.top) * 0.95, g.Z + 0.005], k * 3) }

  /**
   * Each frame, in the cab: v the speed (m/s), notch the handle (-1 brake to 1 power, null when the train drives itself),
   * clock the time, rain how hard it is raining, caution whether the last signal was at caution, curve how sharply the
   * line turns (1/m, left positive), joint a tap at a rail joint, dt.
   */
  update({ v, notch, clock, rain, caution, curve, joint, dt }) {
    this.group.visible = true
    if (this.aspect !== this.camera.aspect) this.layout()
    this.drawSpeedo(v)
    this.drawBrake(notch)
    this.drawClock(clock)
    this.drawAws(caution)
    // the handle: forward for power, back for the brake (the train driving itself holds it where its pull is)
    this.handle.rotation.x = clamp(notch ?? 0, -1, 1) * -0.6
    // the drops gather in the rain, and the wipers clear them on a beat
    this.drops.material.opacity = clamp(rain * 0.9, 0, 0.55)
    // (parked flat along the bottom of the glass, they sweep up and back)
    const PARK = -Math.PI / 2 + 0.06
    if (rain > 0.1) {
      this.wipeT += dt * (0.8 + rain * 0.7)
      const sweep = (1 - Math.cos(this.wipeT * Math.PI)) / 2
      for (const w of this.wipers) w.rotation.z = PARK + sweep * (Math.PI / 2 + 0.15)
      for (let k = 0; k < 90; k++) if (Math.random() < dt * rain * 0.6) this.drop(k)
      // (what the blades pass over is cleared)
      if (sweep > 0.97) for (let k = 0; k < 90; k++) if (Math.random() < 0.6) this.dropPos[k * 3 + 1] = -5
      this.drops.geometry.attributes.position.needsUpdate = true
    } else for (const w of this.wipers) w.rotation.z = PARK
    // the cab leans out of the curves and shakes at the joints
    this.sway += (clamp(curve * v * v * 0.08, -0.05, 0.05) - this.sway) * Math.min(1, dt * 2)
    this.jolt = joint ? 0.004 * Math.min(1, v / 20) : this.jolt * Math.pow(0.001, dt)
  }
  /** The roll and the jolt, for the camera to carry. */
  get roll() { return this.sway }
  get bob() { return this.jolt * Math.sin(performance.now() * 0.09) }
  hide() { this.group.visible = false }

  drawSpeedo(v) {
    const mph = Math.round(v * 2.23694)
    const d = this.speedo; if (d.last === mph) return; d.last = mph
    const g = d.g, S = d.cv.width, c = S / 2
    g.clearRect(0, 0, S, S)
    g.fillStyle = '#0b0b0d'; g.beginPath(); g.arc(c, c, c - 4, 0, Math.PI * 2); g.fill()
    g.strokeStyle = '#f4f2ee'; g.lineWidth = 5; g.stroke()
    const ang = (m) => Math.PI * 0.75 + (m / 100) * Math.PI * 1.5
    g.lineWidth = 3
    for (let m = 0; m <= 100; m += 10) { const a = ang(m), r1 = c - 14, r2 = m % 20 ? c - 26 : c - 36; g.beginPath(); g.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2); g.stroke() }
    g.fillStyle = '#a7cd07'; g.font = 'bold 44px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.fillText(String(mph), c, c + 70)
    g.fillStyle = '#8d8a84'; g.font = '20px ui-monospace, Menlo, monospace'; g.fillText('mph', c, c + 96)
    const a = ang(clamp(mph, 0, 100))
    g.strokeStyle = '#e14a89'; g.lineWidth = 7; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * (c - 30), c + Math.sin(a) * (c - 30)); g.stroke()
    g.fillStyle = '#f4f2ee'; g.beginPath(); g.arc(c, c, 10, 0, Math.PI * 2); g.fill()
    d.tex.needsUpdate = true
  }
  drawBrake(notch) {
    const b = Math.round(clamp(-(notch ?? 0), 0, 1) * 8)
    const d = this.brakeG; if (d.last === b) return; d.last = b
    const g = d.g, S = d.cv.width, c = S / 2
    g.clearRect(0, 0, S, S)
    g.fillStyle = '#0b0b0d'; g.beginPath(); g.arc(c, c, c - 3, 0, Math.PI * 2); g.fill()
    g.strokeStyle = '#f4f2ee'; g.lineWidth = 3; g.stroke()
    const a = Math.PI * 0.75 + (b / 8) * Math.PI * 1.5
    g.strokeStyle = '#f0c44d'; g.lineWidth = 5; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * (c - 16), c + Math.sin(a) * (c - 16)); g.stroke()
    g.fillStyle = '#8d8a84'; g.font = '16px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.fillText('brake', c, c + 40)
    d.tex.needsUpdate = true
  }
  drawClock(clock) {
    const t = Math.floor(((clock % 86400) + 86400) % 86400 / 60)
    const d = this.clockD; if (d.last === t) return; d.last = t
    const g = d.g, W = d.cv.width
    g.clearRect(0, 0, W, W)
    g.fillStyle = '#0b0b0d'; g.fillRect(0, 0, W, W / 3)
    g.fillStyle = '#a7cd07'; g.font = 'bold 64px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`, W / 2, W / 6)
    d.tex.needsUpdate = true
  }
  drawAws(caution) {
    const k = caution ? 1 : 0
    const d = this.aws; if (d.last === k) return; d.last = k
    const g = d.g, S = d.cv.width, c = S / 2
    g.clearRect(0, 0, S, S)
    g.fillStyle = '#0b0b0d'; g.beginPath(); g.arc(c, c, c - 3, 0, Math.PI * 2); g.fill()
    if (caution) { g.fillStyle = '#f0c44d'; for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(c, c); g.arc(c, c, c - 8, (i / 8) * Math.PI * 2, ((i + 0.5) / 8) * Math.PI * 2); g.fill() } }
    g.strokeStyle = '#f4f2ee'; g.lineWidth = 3; g.beginPath(); g.arc(c, c, c - 3, 0, Math.PI * 2); g.stroke()
    d.tex.needsUpdate = true
  }
}
