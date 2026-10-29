// The look of the town (his to add, 29 Oct): the simulator drawn the way pinos.world is, like an old console game. The
// picture is drawn small and blown up with no smoothing, Bayer-dithered into fifteen-bit colour with the deepest shadows
// tinted the town's blue (components/three/effects/dithering.jsx: a blue at about half strength where it is darkest),
// and the corners of things snap to the big pixels, so near things wobble a little as they move, as they did. Drawing
// it small is also cheaper: a phone draws a third of the pixels it did.

import * as THREE from 'three'

const FRAG = `
  uniform sampler2D tScene; uniform vec2 uRes; uniform float uDither; varying vec2 vUv;
  float bayer(vec2 p) {
    vec2 q = mod(p, 4.0);
    int i = int(q.x) + int(q.y) * 4;
    int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
    return (float(m[i]) + 0.5) / 16.0;
  }
  void main() {
    vec2 px = floor(vUv * uRes);
    vec3 c = texture2D(tScene, (px + 0.5) / uRes).rgb;
    c = pow(max(c, 0.0), vec3(1.0 / 2.2));
    float b = bayer(px) - 0.5;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    // the town's shadows: the darkest of it tinted blue, dithered in at the edge
    float sh = step(l + b * 0.06, 0.07);
    c = mix(c, mix(c, vec3(0.05, 0.08, 0.42), 0.5), sh);
    // fifteen-bit colour, dithered
    c = floor(c * 31.0 + b * uDither + 0.5) / 31.0;
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }`

export class Look {
  /** rows: how many rows of pixels the picture is drawn with (the town's own is half the screen; this is chunkier). */
  constructor(renderer, { rows = 300 } = {}) {
    this.renderer = renderer
    this.rows = rows
    this.on = true
    this.u = { tScene: { value: null }, uRes: { value: new THREE.Vector2(400, 300) }, uDither: { value: 1 } }
    this.target = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.HalfFloatType })
    this.u.tScene.value = this.target.texture
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: this.u, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG,
    }))
    this.quadScene = new THREE.Scene()
    this.quadScene.add(this.quad)
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.snapped = new WeakSet()
    this.sweepT = 0
  }
  resize(w, h) {
    const rows = Math.min(this.rows, h), cols = Math.max(160, Math.round(rows * w / h))
    this.target.setSize(cols, rows)
    this.size = [cols, rows]
    this.u.uRes.value.set(cols, rows)
  }
  /** Every material in the scene made to snap its corners to the big pixels (once each; new ones as they come). */
  sweep(scene, dt) {
    if ((this.sweepT -= dt) > 0) return
    this.sweepT = 1
    const U = this.u
    scene.traverse((o) => {
      const ms = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of ms) {
        if (!m || this.snapped.has(m) || m.isShaderMaterial || m.isPointsMaterial || m.isSpriteMaterial) continue
        this.snapped.add(m)
        const prev = m.onBeforeCompile
        m.onBeforeCompile = (sh, r) => {
          prev?.call(m, sh, r)
          sh.uniforms.uSnap = U.uRes
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nuniform vec2 uSnap;')
            .replace('#include <project_vertex>', '#include <project_vertex>\n  if (gl_Position.w > 0.0) { vec2 g = uSnap * 0.5; gl_Position.xy = floor(gl_Position.xy / gl_Position.w * g + 0.5) / g * gl_Position.w; }')
        }
        // (a material's program is keyed by its source; a changed onBeforeCompile needs a key of its own)
        m.customProgramCacheKey = () => `snap:${prev ? prev.toString().length : 0}`
        if (m.map) { m.map.magFilter = THREE.NearestFilter; m.map.needsUpdate = true }
        m.needsUpdate = true
      }
    })
  }
  render(scene, camera) {
    const r = this.renderer
    // (off, the corners snap to a grid too fine to see, so nothing wobbles in the smooth picture)
    if (!this.on) { this.u.uRes.value.set(8192, 8192); r.setRenderTarget(null); r.render(scene, camera); return }
    this.u.uRes.value.set(...this.size)
    r.setRenderTarget(this.target)
    r.render(scene, camera)
    r.setRenderTarget(null)
    r.render(this.quadScene, this.quadCam)
  }
}
