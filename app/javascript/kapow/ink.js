// Draw mode's Ink layer — pure, framework-agnostic logic for the stroke
// schema itself (see the doc: `strokes:[{tool,color,w,op,pts}]`). No DOM
// dependency; see app/javascript/controllers/panel_controller.js for the
// pointer-event capture and rendering glue.

function round2(n) {
  return Math.round(n * 100) / 100
}

// Marker is wider and translucent compared to Pen; Eraser has no color/
// opacity of its own since it never paints anything (see eraseStrokes).
export const INK_TOOLS = {
  pen: { widthMultiplier: 1, opacity: 1 },
  marker: { widthMultiplier: 2.4, opacity: 0.45 }
}

// Base stroke widths (page units) for the 3 brush sizes, before the tool's
// own width multiplier and pressure scaling are applied.
export const INK_SIZES = { s: 4, m: 8, l: 14 }

// 7 swatches — Ink black plus 6 hues spanning the rest of the palette.
// Keep in sync with EditorHelper::INK_COLORS (app/helpers/editor_helper.rb),
// which renders the matching swatch buttons server-side.
export const INK_COLORS = [
  "#1c1a17",
  "#e0452d",
  "#ffd43a",
  "#f2994a",
  "#2f6fed",
  "#2f9e52",
  "#8b5cf6"
]

const DEFAULT_PRESSURE = 0.5

// PointerEvent.pressure reports a flat 0.5 for hardware that doesn't report
// real pressure (mouse, most fingers) — treated as "normal" weight, so a
// non-stylus input still draws at the brush size's own base width rather
// than being silently thinned out by a stray 0 reading.
export function pressureOrDefault(pressure) {
  return pressure > 0 ? pressure : DEFAULT_PRESSURE
}

// The stroke schema stores one width for the whole stroke, not a
// per-point value, so pressure scales the stroke as a single average over
// the whole gesture rather than varying the line's weight along its
// length. Normalized around DEFAULT_PRESSURE so ordinary (non-stylus)
// input draws at exactly the brush size's own base width.
export function strokeWidth(sizeKey, toolName, avgPressure = DEFAULT_PRESSURE) {
  const baseWidth = INK_SIZES[sizeKey] ?? INK_SIZES.m
  const tool = INK_TOOLS[toolName] ?? INK_TOOLS.pen
  const pressureFactor = pressureOrDefault(avgPressure) / DEFAULT_PRESSURE
  return round2(baseWidth * tool.widthMultiplier * pressureFactor)
}

// True eraser: splits/removes the portions of existing strokes that pass
// within `radius` of the eraser's own path, so it reveals whatever is
// beneath (panel background, or a future photo layer) rather than
// painting over affected strokes with an opaque color — the prototype's
// known "eraser paints white" bug, which this deliberately avoids.
export function eraseStrokes(strokes, eraserPts, radius) {
  if (!eraserPts.length) return strokes

  const result = []
  for (const stroke of strokes) {
    result.push(...splitStrokeAroundEraser(stroke, eraserPts, radius))
  }
  return result
}

function splitStrokeAroundEraser(stroke, eraserPts, radius) {
  const segments = []
  let current = []

  for (const point of stroke.pts) {
    if (isWithinRadius(point, eraserPts, radius)) {
      if (current.length >= 2) segments.push(current)
      current = []
    } else {
      current.push(point)
    }
  }
  if (current.length >= 2) segments.push(current)

  return segments.map((pts) => ({ ...stroke, pts }))
}

function isWithinRadius(point, eraserPts, radius) {
  const [ px, py ] = point
  return eraserPts.some(([ ex, ey ]) => {
    const dx = px - ex
    const dy = py - ey
    return dx * dx + dy * dy <= radius * radius
  })
}
