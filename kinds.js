// The kinds of train, as the railway needs them (no drawing here, so the timetable can be worked out anywhere): what
// each is called, how long each vehicle is, and how fast it runs against the line's speed.

export const CAR = 23, GAP = 1.2
export const KINDS = {
  dmu: { label: 'diesel unit', lens: [CAR, CAR], speed: 1 },
  express: { label: 'express', lens: [CAR, CAR, CAR, CAR], speed: 1.1 },
  freight: { label: 'freight', lens: [CAR - 3, CAR - 2, CAR - 2, CAR - 2], speed: 0.8 },
  steam: { label: 'steam', lens: [11, 7, CAR, CAR, CAR], speed: 0.85 },
}
export const lengthOf = (kind) => { const k = KINDS[kind] || KINDS.dmu; return k.lens.reduce((a, b) => a + b, 0) + (k.lens.length - 1) * GAP }
