// Pure geometry for moving/scaling a panel's `pts`. No DOM dependency —
// panel_controller.js applies these during a drag and commits the result
// through the document store on release.

export function boundingBox(pts) {
  const xs = pts.map(([ x ]) => x)
  const ys = pts.map(([ , y ]) => y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

export function translatePoints(pts, dx, dy) {
  return pts.map(([ x, y ]) => [ x + dx, y + dy ])
}

// Scales `pts` toward/away from a fixed anchor point, by independent x/y
// factors. A factor of 1 leaves that axis unchanged.
export function scalePointsFromAnchor(pts, anchorX, anchorY, scaleX, scaleY) {
  return pts.map(([ x, y ]) => [
    anchorX + (x - anchorX) * scaleX,
    anchorY + (y - anchorY) * scaleY
  ])
}

// Which side of the bounding box each corner name sits on, so the drag
// math below can treat all 4 corners uniformly instead of 4 special cases.
const CORNERS = {
  nw: { x: "min", y: "min" },
  ne: { x: "max", y: "min" },
  se: { x: "max", y: "max" },
  sw: { x: "min", y: "max" }
}

export function cornerPoint(pts, corner) {
  const { minX, minY, maxX, maxY } = boundingBox(pts)
  const side = CORNERS[corner]
  if (!side) throw new Error(`Unknown corner: ${corner}`)
  return [ side.x === "min" ? minX : maxX, side.y === "min" ? minY : maxY ]
}

// Computes the anchor point and per-axis scale factors a corner-handle
// drag implies (free/non-aspect-locked, clamped so the panel can't
// collapse to zero or flip inside-out past the anchor) — split out from
// scaleFromCornerDrag so panel_controller.js can apply the exact same
// transform to a panel's ink strokes (pts and stroke width) as it drags,
// not just to the panel's own pts.
export function cornerScaleFactors(pts, corner, pointerX, pointerY, minSize = 20) {
  const side = CORNERS[corner]
  if (!side) throw new Error(`Unknown corner: ${corner}`)

  const { minX, minY, maxX, maxY } = boundingBox(pts)
  const width = maxX - minX
  const height = maxY - minY

  const anchorX = side.x === "min" ? maxX : minX
  const anchorY = side.y === "min" ? maxY : minY
  const originalCornerX = side.x === "min" ? minX : maxX
  const originalCornerY = side.y === "min" ? minY : maxY

  const rawScaleX = (pointerX - anchorX) / (originalCornerX - anchorX)
  const rawScaleY = (pointerY - anchorY) / (originalCornerY - anchorY)

  const minScaleX = width > 0 ? minSize / width : 1
  const minScaleY = height > 0 ? minSize / height : 1

  return {
    anchorX,
    anchorY,
    scaleX: Math.max(rawScaleX, minScaleX),
    scaleY: Math.max(rawScaleY, minScaleY)
  }
}

// Scales `pts` as if the user dragged the given corner to (pointerX,
// pointerY) — see cornerScaleFactors above for the actual math.
export function scaleFromCornerDrag(pts, corner, pointerX, pointerY, minSize = 20) {
  const { anchorX, anchorY, scaleX, scaleY } = cornerScaleFactors(pts, corner, pointerX, pointerY, minSize)
  return scalePointsFromAnchor(pts, anchorX, anchorY, scaleX, scaleY)
}

// Per-vertex shape editing (floating bar's ✎ mode): move a single vertex
// freely, or insert/remove one.

export function updateVertex(pts, index, x, y) {
  return pts.map((pt, i) => (i === index ? [ x, y ] : pt))
}

// Inserts a new vertex at the midpoint of the edge from pts[index] to the
// following point (wrapping around), matching the ◆ midpoint-tap gesture.
export function insertMidpointVertex(pts, index) {
  const a = pts[index]
  const b = pts[(index + 1) % pts.length]
  const midpoint = [ (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 ]

  const next = pts.slice()
  next.splice(index + 1, 0, midpoint)
  return next
}

// Removes the vertex at `index`, refusing to drop below `minVertices` (a
// panel needs at least 3 points to remain a closed shape).
export function removeVertex(pts, index, minVertices = 3) {
  if (pts.length <= minVertices) return pts
  return pts.filter((_, i) => i !== index)
}
