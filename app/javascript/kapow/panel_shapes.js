// Pure geometry: generates the `pts` array for a new panel of a given
// "kind" (Box/Slant/Round/Burst), fitted within a bounding box. The kind
// only matters at creation time — once a panel exists, it's just `pts`
// (see panel_render.js), freely editable into any shape via per-vertex
// editing later, so there's no persistent "shape type" to track.

function round2(n) {
  return Math.round(n * 100) / 100
}

export function boxPoints(x, y, width, height) {
  return [
    [ round2(x), round2(y) ],
    [ round2(x + width), round2(y) ],
    [ round2(x + width), round2(y + height) ],
    [ round2(x), round2(y + height) ]
  ]
}

// A parallelogram: the top edge is shifted right by `skew` (a fraction of
// width), matching the "Slant" panel shape.
export function slantPoints(x, y, width, height, skew = 0.2) {
  const dx = width * skew
  return [
    [ round2(x + dx), round2(y) ],
    [ round2(x + width), round2(y) ],
    [ round2(x + width - dx), round2(y + height) ],
    [ round2(x), round2(y + height) ]
  ]
}

// A 14-point polygon approximating an ellipse inscribed in the box.
export function roundPoints(x, y, width, height, count = 14) {
  const cx = x + width / 2
  const cy = y + height / 2
  const rx = width / 2
  const ry = height / 2

  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2
    return [ round2(cx + rx * Math.cos(angle)), round2(cy + ry * Math.sin(angle)) ]
  })
}

// A 20-point (10-pointed) star inscribed in the box, alternating between
// the box's outer radius and an inner radius.
export function burstPoints(x, y, width, height, points = 10, innerRatio = 0.5) {
  const cx = x + width / 2
  const cy = y + height / 2
  const outerRx = width / 2
  const outerRy = height / 2
  const count = points * 2

  return Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI * i) / points - Math.PI / 2
    const ratio = i % 2 === 0 ? 1 : innerRatio
    return [ round2(cx + outerRx * ratio * Math.cos(angle)), round2(cy + outerRy * ratio * Math.sin(angle)) ]
  })
}

export const SHAPE_GENERATORS = {
  box: boxPoints,
  slant: slantPoints,
  round: roundPoints,
  burst: burstPoints
}

export function generatePanelPoints(kind, x, y, width, height) {
  const generator = SHAPE_GENERATORS[kind]
  if (!generator) throw new Error(`Unknown panel shape: ${kind}`)
  return generator(x, y, width, height)
}

// Unique enough for a client-generated panel id within one editing
// session — no need for cryptographic randomness (and unlike
// crypto.randomUUID(), this doesn't depend on a secure context).
export function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// A full panel object (see the doc's schema) for the given shape kind and
// bounding box.
export function newPanel(kind, x, y, width, height, id = generateId()) {
  return {
    id,
    pts: generatePanelPoints(kind, x, y, width, height),
    strokes: [],
    photo: null
  }
}
