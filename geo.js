// Where things are, for every line at once (29 Oct, Sam: "have all the lines running properly at the same time").
// Until then each line drew itself in its own flat frame round its own middle, which is exact along one line and
// wrong between two: lines that meet at Carlisle would miss each other by hundreds of metres. So one frame for the
// whole of Britain: a transverse Mercator on the meridian two degrees west (as the Ordnance Survey's is), true to a
// few parts in ten thousand from Penzance to Thurso. Metres east (x) and south (z) of 54N 2W; up is metres above the
// sea. Three.js works out what is near the camera in full precision, so a mesh is built round a point of its own
// (its anchor) and placed there, and nothing needs moving as the train goes.

export const R = 6371008.8
const LAT0 = 54, LON0 = -2
export const rad = (d) => (d * Math.PI) / 180
export const deg = (r) => (r * 180) / Math.PI
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
export const lerp = (a, b, t) => a + (b - a) * t
export const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }

/** A place on the earth as [x, z] in the frame (metres east, metres south). */
export function toXZ(lat, lon) {
  const p = rad(lat), dl = rad(lon - LON0)
  const B = Math.cos(p) * Math.sin(dl)
  return [0.5 * R * Math.log((1 + B) / (1 - B)), -R * (Math.atan2(Math.tan(p), Math.cos(dl)) - rad(LAT0))]
}
/** And back: [lat, lon] of a point in the frame. */
export function toLL(x, z) {
  const D = -z / R + rad(LAT0)
  return [deg(Math.asin(Math.sin(D) / Math.cosh(x / R))), LON0 + deg(Math.atan2(Math.sinh(x / R), Math.cos(D)))]
}

/**
 * The flat frame a line's land from the map was written in (fetchScenery.mjs: metres east and south of the line's own
 * middle, the earth taken as flat there), turned into this one: a function of the old [x, z] to the new.
 */
export function fromLineFrame(origin) {
  const cosLat = Math.cos(rad(origin.lat))
  return (x, z) => toXZ(origin.lat - (z / R) * (180 / Math.PI), origin.lon + (x / (R * cosLat)) * (180 / Math.PI))
}

// the elevation and photograph tiles are the web's square ones (Web Mercator, z/x/y)
export const tileXY = (lat, lon, z) => { const n = 2 ** z; return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2) * n] }
export const tileLL = (x, y, z) => { const n = 2 ** z; return [deg(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)))), (x / n) * 360 - 180] }

/** A seeded run of numbers between 0 and 1, the same every time for the same seed. */
export function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
export const hashStr = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }
