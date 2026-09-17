// Pure flood-fill logic for Draw mode's paint bucket (see
// panel_controller.js#startBucketFill for the actual tool). No DOM
// dependency — the caller rasterizes a panel's own shape and ink strokes
// into a plain label grid first (necessarily DOM/Canvas-bound, so that
// part lives in panel_controller.js instead), then hands it to
// floodFillMask here.
//
// Labels, one per grid cell:
//   0 = open (fillable)
//   1 = ink (a drawn stroke) — blocks the fill, but staying within it still
//       counts as "enclosed"
//   2 = boundary (outside the panel's own shape, including a 1-cell pad
//       around the whole grid) — reaching this means the region reaches
//       the panel's real edge, i.e. it is NOT enclosed by ink.
//
// Distinguishing label 1 from label 2 is what lets one tool do two
// different things: a region enclosed only by ink becomes its own filled
// shape; a region that reaches the panel's actual edge (nothing enclosing
// it) instead sets the whole panel's background color — exactly the "at
// least a background color, but really a paint bucket" the feature was
// asked for, using a single reachability test rather than two separate
// code paths the user has to choose between.

// Returns null if the start cell isn't open (the click landed exactly on
// ink, or outside the panel) — there's no sensible region to fill there.
export function floodFillMask(labels, width, height, startX, startY) {
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) return null
  const startIndex = startY * width + startX
  if (labels[startIndex] !== 0) return null

  const filled = new Uint8Array(width * height)
  filled[startIndex] = 1
  let touchedBoundary = false

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
        touchedBoundary = true
        continue
      }
      if (label === 1 || filled[nIndex]) continue
      filled[nIndex] = 1
      stack.push(nIndex)
    }
  }

  return { filled, touchedBoundary }
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
