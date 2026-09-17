// Run with: node test/javascript/flood_fill.test.mjs

import test from "node:test"
import assert from "node:assert/strict"
import { floodFillMask, filledBounds } from "../../app/javascript/kapow/flood_fill.js"

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

test("floodFillMask fills a region fully enclosed by ink, and reports it as not touching the boundary", () => {
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
  assert.equal(result.touchedBoundary, false)
  assert.deepEqual(filledRows(result.filled, width, height), [
    ".......",
    ".......",
    "..###..",
    "..###..",
    ".......",
    "......."
  ])
})

test("floodFillMask spreads out to an unenclosed region and reports touchedBoundary", () => {
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
  assert.equal(result.touchedBoundary, true)
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
  assert.equal(left.touchedBoundary, false)
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
