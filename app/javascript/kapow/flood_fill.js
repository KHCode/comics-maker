// Pure flood-fill logic for Draw mode's paint bucket (see
// panel_controller.js#startBucketFill for the actual tool). No DOM
// dependency — the caller rasterizes a panel's own shape and ink strokes
// into a plain label grid first (necessarily DOM/Canvas-bound, so that
// part lives in panel_controller.js instead), then hands it to
// bucketFillRegion/floodFillMask here.
//
// Labels, one per grid cell:
//   0 = open (fillable)
//   1 = ink (a drawn stroke) — blocks the fill
//   2 = boundary (outside the panel's own shape, including a 1-cell pad
//       around the whole grid) — also blocks the fill, the same as ink;
//       the panel's own edge is a wall too, not just a stopping point to
//       take note of and keep going past.

// Returns null if the start cell isn't open (the click landed exactly on
// ink, or outside the panel) — there's no sensible region to fill there.
// `touchedBoundaryCells` is the set of boundary-cell indices the fill
// actually reached — not just whether it reached any, but which ones —
// so bucketFillRegion below can tell "reached this whole side of the
// panel" apart from "reached the panel's edge only where ink didn't
// block it".
export function floodFillMask(labels, width, height, startX, startY) {
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) return null
  const startIndex = startY * width + startX
  if (labels[startIndex] !== 0) return null

  const filled = new Uint8Array(width * height)
  filled[startIndex] = 1
  const touchedBoundaryCells = new Set()

  // Iterative (an explicit stack, not recursion) — a large panel at a
  // reasonable raster scale can easily exceed a few thousand open cells,
  // well past a safe recursion depth.
  const stack = [ startIndex ]
  while (stack.length) {
    const index = stack.pop()
    const x = index % width
    const y = (index - x) / width

    const neighbors = [ [ x - 1, y ], [ x + 1, y ], [ x, y - 1 ], [ x, y + 1 ] ]
    for (const [ nx, ny ] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const nIndex = ny * width + nx
      const label = labels[nIndex]
      if (label === 2) {
        touchedBoundaryCells.add(nIndex)
        continue
      }
      if (label === 1 || filled[nIndex]) continue
      filled[nIndex] = 1
      stack.push(nIndex)
    }
  }

  return { filled, touchedBoundaryCells }
}

// The actual decision behind the paint bucket: does this click's region
// become its own filled shape, or does it mean "color the whole panel's
// background"?
//
// A region only reaching the panel's real edge is not, on its own, reason
// enough to call it "background" — a shape drawn with one open side (a
// line that starts at the panel's edge and ends at the panel's edge, e.g.
// cutting the panel in half, or an alcove open on one side) is still a
// bound region as far as the user is concerned, and clicking inside it
// should color only it, not the entire panel.
//
// The real test: run the flood fill twice from the same point — once
// respecting ink as a wall (the real fill), and once with ink relabeled
// as open (as if none had been drawn at all). If ink isn't actually
// blocking this region off from any part of the panel's own edge, both
// passes reach exactly the same boundary cells — this is the ordinary
// open "desk" around whatever's drawn elsewhere, so color the whole
// background. If the real pass reaches *fewer* boundary cells than the
// no-ink pass, some ink is standing between this region and part of the
// panel's edge — that's what makes it a bound region, whether or not it
// also happens to touch the edge on its own remaining sides.
export function bucketFillRegion(labels, width, height, startX, startY) {
  const real = floodFillMask(labels, width, height, startX, startY)
  if (!real) return null

  const labelsIgnoringInk = labels.map((label) => (label === 1 ? 0 : label))
  const withoutInk = floodFillMask(labelsIgnoringInk, width, height, startX, startY)

  // withoutInk is only ever null if `real` already was (same start cell,
  // same out-of-range checks) — real being non-null here guarantees this
  // is too, but the check costs nothing and avoids relying on that.
  const isBackground = !!withoutInk && real.touchedBoundaryCells.size === withoutInk.touchedBoundaryCells.size

  return { filled: real.filled, isBackground }
}

// The filled mask's own tight bounding box, in grid coordinates — used to
// crop the rasterized fill image down to just the region that was
// actually filled, rather than storing one full-panel-sized image per
// fill. Returns null for an all-empty mask (shouldn't happen given
// floodFillMask always marks its own start cell, but kept safe).
export function filledBounds(filled, width, height) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!filled[y * width + x]) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (minX > maxX) return null
  return { minX, minY, maxX, maxY }
}
