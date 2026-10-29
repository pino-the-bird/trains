// Two things he can add for the ears (29 Oct), made in the browser like the rest of the sound, nothing fetched.
//
// The sound, all of it: the engine as a unit's diesel (two detuned saws and a sub through a filter, a turbo's whine as
// it works), the wheels over each rail joint as they really go, axle by axle down the first two cars (the diddly-dum),
// the squeal of the flanges on a tight curve, the brakes hissing and squealing as the train comes to a stand, the door
// beeps, the wind as it gets up speed, rain on the roof, the boom in a tunnel, and a steam engine's chuff in time with
// its wheels.
//
// The train plays the synth (his own words, 27 Oct: "Rig a bit of track to a synth and record the first loop"): the rail
// joints are the kick and the speed is the tempo, the height of the line is the bassline, each station sets the chord
// from its name, the signals are the hats, a viaduct opens the filter and a tunnel the echo. A button records it, and
// the loop is saved as a file.

import { clamp, hashStr } from './geo.js'

const JOINT = 18.3
// where the axles are, back from the front of the train, on the first two cars (a bogie each end, two axles each)
const AXLES = [3.3, 5.2, 17.8, 19.7, 27.5, 29.4, 42, 43.9]

function noiseBuffer(C) { const b = C.createBuffer(1, C.sampleRate * 2, C.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b }
function loopNoise(C, buf, type, f, q, out) { const s = C.createBufferSource(); s.buffer = buf; s.loop = true; const fl = C.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = C.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(out); s.start(); return { g, fl } }
function echo(C) { const len = C.sampleRate * 2.2, b = C.createBuffer(2, len, C.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3) } const c = C.createConvolver(); c.buffer = b; return c }

export class RailSound {
  /** C: the AudioContext; out: where it goes (sim.js's master). */
  constructor(C, out) {
    this.C = C; this.out = out
    const noise = (this.noise = noiseBuffer(C))
    // the room it is heard in: dry, or a tunnel's boom
    this.dry = C.createGain(); this.dry.connect(out)
    this.verb = echo(C); this.wet = C.createGain(); this.wet.gain.value = 0; this.verb.connect(this.wet); this.wet.connect(out)
    const bus = (this.bus = C.createGain()); bus.connect(this.dry); bus.connect(this.verb)
    // the engine: two saws a little apart and a square an octave down, through a filter and a little drive
    this.eng = [C.createOscillator(), C.createOscillator(), C.createOscillator()]
    this.eng[0].type = 'sawtooth'; this.eng[1].type = 'sawtooth'; this.eng[2].type = 'square'
    this.engLp = C.createBiquadFilter(); this.engLp.type = 'lowpass'; this.engLp.Q.value = 3
    const shaper = C.createWaveShaper(); const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(2.2 * x) } shaper.curve = curve
    this.engG = C.createGain(); this.engG.gain.value = 0
    this.chug = C.createGain(); this.chug.gain.value = 1
    this.chugLfo = C.createOscillator(); this.chugLfo.type = 'sine'; const chugDepth = C.createGain(); chugDepth.gain.value = 0.35; this.chugLfo.connect(chugDepth); chugDepth.connect(this.chug.gain)
    for (const o of this.eng) { o.connect(this.engLp); o.start() }
    this.chugLfo.start()
    this.engLp.connect(shaper); shaper.connect(this.chug); this.chug.connect(this.engG); this.engG.connect(bus)
    // the turbo's whine, the wind, the roar of the wheels, rain on the roof, the flanges
    this.turbo = C.createOscillator(); this.turbo.type = 'sine'; this.turboG = C.createGain(); this.turboG.gain.value = 0; this.turbo.connect(this.turboG); this.turboG.connect(bus); this.turbo.start()
    this.wind = loopNoise(C, noise, 'lowpass', 600, 0.5, bus)
    this.roar = loopNoise(C, noise, 'bandpass', 180, 0.7, bus)
    this.rain = loopNoise(C, noise, 'highpass', 3500, 0.4, this.dry)
    this.squeal = loopNoise(C, noise, 'bandpass', 3200, 18, bus)
    this.brakeS = C.createOscillator(); this.brakeS.type = 'triangle'; this.brakeS.frequency.value = 2350; this.brakeG = C.createGain(); this.brakeG.gain.value = 0; this.brakeS.connect(this.brakeG); this.brakeG.connect(bus); this.brakeS.start()
    this.joint = 0; this.pending = []; this.lastV = 0; this.chuffAt = 0; this.wasStill = true
  }
  tap(at, gain) {
    const C = this.C, src = C.createBufferSource(); src.buffer = this.noise
    const f = C.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700 + Math.random() * 500; f.Q.value = 1.4
    const g = C.createGain(); g.gain.setValueAtTime(gain, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.09)
    src.connect(f); f.connect(g); g.connect(this.bus); src.start(at); src.stop(at + 0.1)
  }
  puff(at, gain, f = 700, len = 0.18) {
    const C = this.C, src = C.createBufferSource(); src.buffer = this.noise
    const fl = C.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = 0.8
    const g = C.createGain(); g.gain.setValueAtTime(gain, at); g.gain.exponentialRampToValueAtTime(0.001, at + len)
    src.connect(fl); fl.connect(g); g.connect(this.bus); src.start(at); src.stop(at + len + 0.02)
  }
  beeps() { const C = this.C; for (let k = 0; k < 3; k++) for (const [f, dt] of [[1750, 0], [1350, 0.18]]) { const o = C.createOscillator(); o.type = 'square'; o.frequency.value = f; const g = C.createGain(); const t = C.currentTime + k * 0.5 + dt; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16); o.connect(g); g.connect(this.dry); o.start(t); o.stop(t + 0.18) } }
  /**
   * Each frame: v (m/s), pull (0..1 how hard the engine works), braking (0..1), curve (1/m), tunnel, bridge, rain (0..1),
   * steam (a steam engine), dt.
   */
  step({ v, pull, braking, curve, tunnel, bridge, rain, steam, dt }) {
    const C = this.C, t = C.currentTime
    const rpm = steam ? 0 : 0.5 + pull * 0.5 + v / 60
    const f0 = 32 + rpm * 38
    this.eng[0].frequency.setTargetAtTime(f0, t, 0.25); this.eng[1].frequency.setTargetAtTime(f0 * 1.012, t, 0.25); this.eng[2].frequency.setTargetAtTime(f0 / 2, t, 0.25)
    this.chugLfo.frequency.setTargetAtTime(f0 / 4, t, 0.25)
    this.engLp.frequency.setTargetAtTime(240 + pull * 900 + v * 5, t, 0.3)
    this.engG.gain.setTargetAtTime(steam ? 0 : 0.05 + pull * 0.11, t, 0.4)
    this.turbo.frequency.setTargetAtTime(1600 + pull * 1800 + v * 10, t, 0.6)
    this.turboG.gain.setTargetAtTime(steam ? 0 : pull * 0.012, t, 0.8)
    this.wind.g.gain.setTargetAtTime(Math.min(0.12, (v * v) / 9000), t, 0.5)
    this.roar.g.gain.setTargetAtTime(Math.min(tunnel ? 0.6 : 0.3, v / (tunnel ? 50 : 90)), t, 0.4)
    this.roar.fl.frequency.setTargetAtTime(bridge ? 420 : tunnel ? 110 : 180, t, 0.4)
    this.rain.g.gain.setTargetAtTime(rain * 0.05, t, 1)
    this.wet.gain.setTargetAtTime(tunnel ? 0.7 : 0.04, t, 0.3)
    // the flanges on a tight curve
    const tight = Math.abs(curve) > 1 / 280 && v > 3
    this.squeal.g.gain.setTargetAtTime(tight ? Math.min(0.05, Math.abs(curve) * 6) * (0.5 + Math.random() * 0.5) : 0, t, 0.08)
    // the brakes: a squeal at walking pace coming to a stand
    this.brakeG.gain.setTargetAtTime(braking > 0.1 && v > 0.3 && v < 5 ? 0.02 : 0, t, 0.1)
    if (this.lastV > 0.5 && v < 0.05) this.puff(t, 0.18, 1800, 1.4)
    this.lastV = v
    // the joints under each axle of the first two cars, in turn
    this.joint += v * dt
    if (this.joint > JOINT) {
      this.joint -= JOINT
      if (v > 0.5) for (const ax of AXLES) this.tap(t + ax / v, Math.min(0.5, 0.08 + v / 60) * (ax < 20 ? 1 : 0.6))
    }
    // a steam engine's chuff, four to a turn of its driving wheels
    if (steam && v > 0.1) { const every = (2 * Math.PI * 0.95) / v / 4; if (t - this.chuffAt > every) { this.chuffAt = t; this.puff(t, Math.min(0.5, 0.15 + pull * 0.35), 600 + Math.random() * 300, Math.min(0.3, every * 0.8)) } }
  }
}

// a minor key, and four chords in it, picked by a station's name
const ROOT = 45 // A2
const SCALE = [0, 3, 5, 7, 10]
const CHORDS = [[0, 3, 7], [5, 8, 12], [7, 10, 14], [3, 7, 10]]
const hz = (n) => 440 * Math.pow(2, (n - 69) / 12)

export class LineSynth {
  constructor(C, out) {
    this.C = C; this.on = false
    this.out = C.createGain(); this.out.gain.value = 0.7; this.out.connect(out)
    this.filter = C.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 900; this.filter.Q.value = 6; this.filter.connect(this.out)
    this.verb = echo(C); this.wet = C.createGain(); this.wet.gain.value = 0.1; this.verb.connect(this.wet); this.wet.connect(this.out); this.filter.connect(this.verb)
    this.noise = noiseBuffer(C)
    this.pad = [0, 1, 2].map(() => { const o = C.createOscillator(); o.type = 'sawtooth'; const g = C.createGain(); g.gain.value = 0; o.connect(g); g.connect(this.filter); o.start(); return { o, g } })
    this.dest = C.createMediaStreamDestination(); this.out.connect(this.dest)
    this.step = 0; this.next = 0; this.chord = 0; this.joint = 0; this.rec = null
  }
  start() { this.on = true; this.next = this.C.currentTime + 0.05 }
  stop() { this.on = false; for (const p of this.pad) p.g.gain.setTargetAtTime(0, this.C.currentTime, 0.2) }
  kick(at) { const C = this.C, o = C.createOscillator(); o.frequency.setValueAtTime(140, at); o.frequency.exponentialRampToValueAtTime(42, at + 0.18); const g = C.createGain(); g.gain.setValueAtTime(0.6, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.3); o.connect(g); g.connect(this.out); o.start(at); o.stop(at + 0.32) }
  hat(at, open) { const C = this.C, s = C.createBufferSource(); s.buffer = this.noise; const f = C.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000; const g = C.createGain(); g.gain.setValueAtTime(open ? 0.12 : 0.06, at); g.gain.exponentialRampToValueAtTime(0.001, at + (open ? 0.25 : 0.05)); s.connect(f); f.connect(g); g.connect(this.out); s.start(at); s.stop(at + 0.3) }
  bass(at, n, len) { const C = this.C, o = C.createOscillator(); o.type = 'square'; o.frequency.value = hz(n); const g = C.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.16, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + len); o.connect(g); g.connect(this.filter); o.start(at); o.stop(at + len + 0.02) }
  /**
   * Each frame: v (m/s), height (m), station (the name of the stop it is at or making for), caution (a signal at
   * caution ahead), bridge, tunnel, dt. The joints are the kick; sixteen steps a bar at the speed's own tempo.
   */
  update({ v, height, station, caution, bridge, tunnel, dt }) {
    if (!this.on) return
    const C = this.C, t = C.currentTime
    // the kick on the joints, as the train runs over them
    this.joint += v * dt
    if (this.joint > JOINT) { this.joint -= JOINT; if (v > 1) this.kick(t + 0.01) }
    // the chord from the station, the pad on it
    const chord = CHORDS[hashStr(station || '') % CHORDS.length]
    if (chord !== this.chord) { this.chord = chord; chord.forEach((n, k) => { this.pad[k].o.frequency.setTargetAtTime(hz(ROOT + 12 + n), t, 0.4) }) }
    for (const p of this.pad) p.g.gain.setTargetAtTime(0.025, t, 0.5)
    this.filter.frequency.setTargetAtTime(bridge ? 3800 : 500 + Math.min(v, 30) * 40, t, 0.6)
    this.wet.gain.setTargetAtTime(tunnel ? 0.8 : 0.12, t, 0.4)
    // sixteen steps a bar: the faster the train, the faster the bar (from a crawl to a gallop)
    const stepLen = clamp(0.32 - v * 0.007, 0.11, 0.32)
    while (this.next < t + 0.12) {
      const at = this.next, k = this.step % 16
      if (v > 0.2) {
        this.hat(at, caution && k % 4 === 2)
        // the bassline walks the scale by the height of the line
        if (k % 4 === 0) { const deg = Math.floor(clamp(height, 0, 600) / 30) + (k / 4); const n = ROOT + SCALE[deg % SCALE.length] + 12 * Math.floor((deg % 10) / 5); this.bass(at, n, stepLen * 2.5) }
      }
      this.step++; this.next += stepLen
    }
  }
  /** Start or stop recording the loop; stopping hands back the file. */
  record(onFile) {
    if (this.rec) { this.rec.stop(); return false }
    const chunks = []
    const rec = new MediaRecorder(this.dest.stream)
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    rec.onstop = () => { this.rec = null; onFile(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })) }
    rec.start(); this.rec = rec
    return true
  }
}
