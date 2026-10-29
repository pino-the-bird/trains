// How things are drawn: the way Pino draws (black ground, a white key line, fluorescent colour), and the few things
// every part of the simulator draws with. Shared, so a hundred stations are a handful of materials.

import * as THREE from 'three'

export const INK = 0xf4f2ee, GROUND = 0x0b0b0d, ACID = 0xa7cd07, PINK = 0xe14a89, CYAN = 0x2fd1ff, GOLD = 0xf0c44d

export const inkLine = new THREE.LineBasicMaterial({ color: INK })
const lambert = new Map()
/** One Lambert material per colour, shared by everything of that colour. */
export function solid(color) {
  if (!lambert.has(color)) lambert.set(color, new THREE.MeshLambertMaterial({ color }))
  return lambert.get(color)
}
const basic = new Map()
export function flat(color) {
  if (!basic.has(color)) basic.set(color, new THREE.MeshBasicMaterial({ color }))
  return basic.get(color)
}

/** A shape in its colour with the key line round its edges. */
export function outlined(geo, color, { opacity = 1 } = {}) {
  const g = new THREE.Group()
  g.add(new THREE.Mesh(geo, opacity < 1 ? new THREE.MeshLambertMaterial({ color, transparent: true, opacity }) : solid(color)))
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), inkLine))
  return g
}

/** Words on a board, as a texture: a name and a smaller line under it. */
export function textCanvas(lines, { w = 1024, h = 256, bg = '#0b0b0d', fg = '#f4f2ee', accent = '#a7cd07', size = 92, box = true } = {}) {
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

/** Everything under an object given back: its geometry, its own materials and their pictures (the shared ones kept). */
export function dispose(obj) {
  obj.traverse((o) => {
    // (marked, so whatever kept a hold on it, like the photograph under the train, knows it has gone)
    o.userData.gone = true
    if (!o.geometry?.userData?.shared) o.geometry?.dispose?.()
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    for (const m of ms) {
      if (m.userData?.shared || [...lambert.values(), ...basic.values(), inkLine].includes(m)) continue
      m.map?.dispose?.()
      m.dispose?.()
    }
  })
}

/**
 * What is near the camera is built and what is far is given back: anything along a line (a stretch of track, a station,
 * a viaduct, a wood) is an item with where it is, how near the camera has to be, and how to build it. Built a few a
 * frame, nearest first, so nothing stalls while the train runs.
 */
export class Near {
  constructor(scene) { this.scene = scene; this.items = []; this.built = 0 }
  add(item) { this.items.push({ reach: 6000, ...item, obj: null }); return item }
  update(x, z, { perFrame = 3, ready = () => true } = {}) {
    const todo = []
    for (const it of this.items) {
      const d = Math.hypot(it.x - x, it.z - z) - (it.r || 0)
      if (it.obj && d > it.reach * 1.4) { this.scene.remove(it.obj); dispose(it.obj); it.obj = null; this.built-- }
      else if (!it.obj && d < it.reach && ready(it)) todo.push([d, it])
    }
    todo.sort((a, b) => a[0] - b[0])
    for (const [, it] of todo.slice(0, perFrame)) {
      try { it.obj = it.build(); if (it.obj) { this.scene.add(it.obj); this.built++ } } catch (err) { console.warn('build', it.kind, err.message); it.obj = null; it.reach = -1 }
    }
    return todo.length
  }
  clear() { for (const it of this.items) if (it.obj) { this.scene.remove(it.obj); dispose(it.obj); it.obj = null } this.items = []; this.built = 0 }
}
