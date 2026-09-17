// Run with: node test/javascript/flood_fill.test.mjs

import test from "node:test"
import assert from "node:assert/strict"
import { floodFillMask, bucketFillRegion, filledBounds } from "../../app/javascript/kapow/flood_fill.js"

// Builds a label grid from an array of strings, one char per cell:
// "." = open (0), "#" = ink (1), "X" = boundary (2). Every row must be the
// same length. Much easier to read/author a test case this way than as a
// flat Uint8Array literal.
function grid(rows) {
  const height = rows.length
  const width = rows[0].length
  const labels = new Uint8Array(width * height)
  rows.forEach((row, y) => {
    assert.equal(row.length, width, "all rows must be the same length")
    for (let x = 0; x < width; x++) {
      labels[y * width + x] = row[x] === "#" ? 1 : row[x] === "X" ? 2 : 0
    }
  })
  return { labels, width, height }
}

function filledRows(filled, width, height) {
  const rows = []
  for (let y = 0; y < height; y++) {
    let row = ""
    for (let x = 0; x < width; x++) row += filled[y * width + x] ? "#" : "."
    rows.push(row)
  }
  return rows
}

test("floodFillMask fills a region fully enclosed by ink, touching no boundary cells", () => {
  const { labels, width, height } = grid([
    "XXXXXXX",
    "X#####X",
    "X#...#X",
    "X#...#X",
    "X#####X",
    "XXXXXXX"
  ])

  const result = floodFillMask(labels, width, height, 3, 2) // a "." cell inside the ring
  assert.ok(result)
  assert.equal(result.touchedBoundaryCells.size, 0)
  assert.deepEqual(filledRows(result.filled, width, height), [
    ".......",
    ".......",
    "..###..",
    "..###..",
    ".......",
    "......."
  ])
})

test("floodFillMask spreads out to an unenclosed region and records the boundary cells it touched", () => {
  const { labels, width, height } = grid([
    "XXXXXXX",
    "X#####X",
    "X#...XX", // the ring has a gap on its right edge -- open to the boundary
    "X#...#X",
    "X#####X",
    "XXXXXXX"
  ])

  const result = floodFillMask(labels, width, height, 3, 2)
  assert.ok(result)
  assert.ok(result.touchedBoundaryCells.size > 0)
})

test("floodFillMask does not leak through an ink wall even one cell thick", () => {
  const { labels, width, height } = grid([
    "XXXXXXXXX",
    "X#######X",
    "X#..#..#X",
    "X#..#..#X",
    "X#######X",
    "XXXXXXXXX"
  ])

  const left = floodFillMask(labels, width, height, 2, 2)
  assert.ok(left)
  assert.equal(left.touchedBoundaryCells.size, 0)
  assert.deepEqual(filledRows(left.filled, width, height), [
    ".........",
    ".........",
    "..##.....",
    "..##.....",
    ".........",
    "........."
  ])
})

test("floodFillMask returns null when the start cell is ink", () => {
  const { labels, width, height } = grid([
    "XXX",
    "X#X",
    "XXX"
  ])
  assert.equal(floodFillMask(labels, width, height, 1, 1), null)
})

test("floodFillMask returns null when the start cell is the boundary", () => {
  const { labels, width, height } = grid([
    "XXX",
    "X.X",
    "XXX"
  ])
  assert.equal(floodFillMask(labels, width, height, 0, 0), null)
})

test("floodFillMask returns null for an out-of-range start point", () => {
  const { labels, width, height } = grid([ "..", ".." ])
  assert.equal(floodFillMask(labels, width, height, 5, 5), null)
  assert.equal(floodFillMask(labels, width, height, -1, 0), null)
})

test("filledBounds returns the tight bounding box of the filled cells", () => {
  const { labels, width, height } = grid([
    "XXXXXXX",
    "X#####X",
    "X#...#X",
    "X#...#X",
    "X#####X",
    "XXXXXXX"
  ])
  const result = floodFillMask(labels, width, height, 3, 2)
  assert.deepEqual(filledBounds(result.filled, width, height), { minX: 2, minY: 2, maxX: 4, maxY: 3 })
})

test("filledBounds returns null for an empty mask", () => {
  assert.equal(filledBounds(new Uint8Array(9), 3, 3), null)
})

// bucketFillRegion is the actual decision behind the tool: background vs.
// a local fill. A region merely touching the panel's own edge isn't
// enough on its own to call it "background" — see each case below.

test("bucketFillRegion: an empty panel with no ink at all is background", () => {
  const { labels, width, height } = grid([
    "XXXXX",
    "X...X",
    "X...X",
    "X...X",
    "XXXXX"
  ])
  const result = bucketFillRegion(labels, width, height, 2, 2)
  assert.ok(result)
  assert.equal(result.isBackground, true)
})

test("bucketFillRegion: a region fully enclosed by a closed ink loop is a local fill, not background", () => {
  const { labels, width, height } = grid([
    "XXXXXXX",
    "X#####X",
    "X#...#X",
    "X#...#X",
    "X#####X",
    "XXXXXXX"
  ])
  const result = bucketFillRegion(labels, width, height, 3, 2)
  assert.ok(result)
  assert.equal(result.isBackground, false)
})

// A doodle that sits entirely inside the panel (never touching the real
// edge itself) doesn't cut off any part of the panel's own boundary from
// the open space around it — clicking in that surrounding space is still
// "the open desk", i.e. background, even though the doodle is ink.
test("bucketFillRegion: open space around a closed ink loop that doesn't touch the edge is still background", () => {
  const { labels, width, height } = grid([
    "XXXXXXXXX",
    "X.......X",
    "X.#####.X",
    "X.#...#.X",
    "X.#####.X",
    "X.......X",
    "XXXXXXXXX"
  ])
  const result = bucketFillRegion(labels, width, height, 1, 1) // top-left corner of the open margin
  assert.ok(result)
  assert.equal(result.isBackground, true)
  // and it doesn't leak into the ring's own interior
  assert.equal(result.filled[3 * width + 4], 0)
})

// A line that starts at one edge of the panel and ends at another splits
// it into two regions, each of which touches the panel's own edge on its
// own remaining sides — exactly the case this feature request was about.
// Neither half should be treated as "background".
test("bucketFillRegion: a wall touching the panel's edge on both ends splits it into two local fills", () => {
  const { labels, width, height } = grid([
    "XXXXXXXXX",
    "X....#..X",
    "X....#..X",
    "X....#..X",
    "X....#..X",
    "XXXXXXXXX"
  ])

  const left = bucketFillRegion(labels, width, height, 2, 2)
  assert.ok(left)
  assert.equal(left.isBackground, false)
  assert.deepEqual(filledRows(left.filled, width, height), [
    ".........",
    ".####....",
    ".####....",
    ".####....",
    ".####....",
    "........."
  ])

  const right = bucketFillRegion(labels, width, height, 6, 2)
  assert.ok(right)
  assert.equal(right.isBackground, false)
  assert.deepEqual(filledRows(right.filled, width, height), [
    ".........",
    "......##.",
    "......##.",
    "......##.",
    "......##.",
    "........."
  ])
})

// A stub of ink touching the edge on one side but not reaching all the
// way across still leaves one specific boundary cell — directly behind
// the stub's own tip — unreachable no matter which way the fill goes
// around it (nothing open is ever adjacent to it once ink occupies the
// only cell that would connect to it). Read strictly, that's still
// "bound on the one side the stub touches" per the request this fixes,
// so this is a (near-panel-sized) local fill rather than background —
// not visually different in practice, since it still covers virtually
// the whole open interior either way.
test("bucketFillRegion: a stub of ink touching the edge is still its own bound region, even though it doesn't cross the panel", () => {
  const { labels, width, height } = grid([
    "XXXXXXXXX",
    "X....#..X",
    "X....#..X",
    "X....#..X",
    "X.......X",
    "XXXXXXXXX"
  ])
  const result = bucketFillRegion(labels, width, height, 2, 2)
  assert.ok(result)
  assert.equal(result.isBackground, false)
})

test("bucketFillRegion returns null when the click starts on ink", () => {
  const { labels, width, height } = grid([ "X#X", "X.X", "XXX" ])
  assert.equal(bucketFillRegion(labels, width, height, 1, 0), null)
})
