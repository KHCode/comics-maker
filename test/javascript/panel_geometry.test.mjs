// Run with: node test/javascript/panel_geometry.test.mjs

import test from "node:test"
import assert from "node:assert/strict"
import {
  boundingBox,
  translatePoints,
  scalePointsFromAnchor,
  cornerPoint,
  scaleFromCornerDrag,
  updateVertex,
  insertMidpointVertex,
  removeVertex
} from "../../app/javascript/kapow/panel_geometry.js"

const BOX = [ [ 100, 100 ], [ 300, 100 ], [ 300, 300 ], [ 100, 300 ] ]

test("boundingBox finds the min/max extents of arbitrary points", () => {
  assert.deepEqual(boundingBox(BOX), { minX: 100, minY: 100, maxX: 300, maxY: 300 })
})

test("boundingBox works for non-rectangular point sets too", () => {
  const slant = [ [ 120, 100 ], [ 300, 100 ], [ 280, 300 ], [ 100, 300 ] ]
  assert.deepEqual(boundingBox(slant), { minX: 100, minY: 100, maxX: 300, maxY: 300 })
})

test("translatePoints shifts every point by the same delta", () => {
  assert.deepEqual(translatePoints(BOX, 10, -5), [ [ 110, 95 ], [ 310, 95 ], [ 310, 295 ], [ 110, 295 ] ])
})

test("scalePointsFromAnchor leaves the anchor point fixed", () => {
  const scaled = scalePointsFromAnchor(BOX, 100, 100, 2, 2)
  assert.deepEqual(scaled, [ [ 100, 100 ], [ 500, 100 ], [ 500, 500 ], [ 100, 500 ] ])
})

test("scalePointsFromAnchor supports independent x/y factors", () => {
  const scaled = scalePointsFromAnchor(BOX, 100, 100, 2, 0.5)
  assert.deepEqual(scaled, [ [ 100, 100 ], [ 500, 100 ], [ 500, 200 ], [ 100, 200 ] ])
})

test("scalePointsFromAnchor with factor 1 on both axes is a no-op", () => {
  assert.deepEqual(scalePointsFromAnchor(BOX, 100, 100, 1, 1), BOX)
})

test("cornerPoint returns each named corner of the bounding box", () => {
  assert.deepEqual(cornerPoint(BOX, "nw"), [ 100, 100 ])
  assert.deepEqual(cornerPoint(BOX, "ne"), [ 300, 100 ])
  assert.deepEqual(cornerPoint(BOX, "se"), [ 300, 300 ])
  assert.deepEqual(cornerPoint(BOX, "sw"), [ 100, 300 ])
})

test("cornerPoint rejects an unknown corner name", () => {
  assert.throws(() => cornerPoint(BOX, "north"), /Unknown corner/)
})

test("scaleFromCornerDrag on se grows the box toward the pointer, anchored at nw", () => {
  const scaled = scaleFromCornerDrag(BOX, "se", 500, 500)
  assert.deepEqual(boundingBox(scaled), { minX: 100, minY: 100, maxX: 500, maxY: 500 })
})

test("scaleFromCornerDrag on nw grows the box toward the pointer, anchored at se", () => {
  const scaled = scaleFromCornerDrag(BOX, "nw", 0, 0)
  assert.deepEqual(boundingBox(scaled), { minX: 0, minY: 0, maxX: 300, maxY: 300 })
})

test("scaleFromCornerDrag on ne moves only the top-right corner's side, anchored at sw", () => {
  const scaled = scaleFromCornerDrag(BOX, "ne", 400, 50)
  assert.deepEqual(boundingBox(scaled), { minX: 100, minY: 50, maxX: 400, maxY: 300 })
})

test("scaleFromCornerDrag on sw moves only the bottom-left corner's side, anchored at ne", () => {
  const scaled = scaleFromCornerDrag(BOX, "sw", 50, 400)
  assert.deepEqual(boundingBox(scaled), { minX: 50, minY: 100, maxX: 300, maxY: 400 })
})

test("scaleFromCornerDrag scales every point, not just the bounding box, for non-box panels", () => {
  // a Slant (parallelogram): top edge shifted right by 20 relative to the
  // bottom edge, both edges the same length (200) — skew, not a width change
  const slant = [ [ 120, 100 ], [ 300, 100 ], [ 280, 300 ], [ 100, 300 ] ]
  const scaled = scaleFromCornerDrag(slant, "se", 600, 500)

  // anchored at nw (100,100 is the bounding box's min corner, from point 3/0);
  // scaleX = (600-100)/(300-100) = 2.5, scaleY = (500-100)/(300-100) = 2
  assert.deepEqual(scaled, [
    [ 100 + (120 - 100) * 2.5, 100 ],
    [ 100 + (300 - 100) * 2.5, 100 ],
    [ 100 + (280 - 100) * 2.5, 100 + (300 - 100) * 2 ],
    [ 100, 100 + (300 - 100) * 2 ]
  ])

  // the skew (top-left inset relative to bottom-left) scales with scaleX,
  // same as every other point — the shape's proportions are preserved
  const originalSkew = slant[0][0] - slant[3][0]
  const scaledSkew = scaled[0][0] - scaled[3][0]
  assert.equal(scaledSkew, originalSkew * 2.5)
})

test("scaleFromCornerDrag refuses to collapse the panel below minSize", () => {
  // dragging se almost onto the nw anchor would otherwise shrink toward 0
  const scaled = scaleFromCornerDrag(BOX, "se", 105, 105, 20)
  const box = boundingBox(scaled)
  assert.ok(box.maxX - box.minX >= 20)
  assert.ok(box.maxY - box.minY >= 20)
})

test("scaleFromCornerDrag refuses to flip the panel inside-out past the anchor", () => {
  // dragging se to the left of/above the nw anchor shouldn't invert the shape
  const scaled = scaleFromCornerDrag(BOX, "se", 0, 0, 20)
  const box = boundingBox(scaled)
  assert.ok(box.minX < box.maxX)
  assert.ok(box.minY < box.maxY)
})

test("updateVertex replaces only the point at the given index", () => {
  assert.deepEqual(updateVertex(BOX, 1, 999, 888), [ [ 100, 100 ], [ 999, 888 ], [ 300, 300 ], [ 100, 300 ] ])
})

test("insertMidpointVertex inserts between an edge's two points", () => {
  const next = insertMidpointVertex(BOX, 0)
  assert.deepEqual(next, [ [ 100, 100 ], [ 200, 100 ], [ 300, 100 ], [ 300, 300 ], [ 100, 300 ] ])
})

test("insertMidpointVertex wraps around from the last point to the first", () => {
  const next = insertMidpointVertex(BOX, 3)
  assert.deepEqual(next, [ [ 100, 100 ], [ 300, 100 ], [ 300, 300 ], [ 100, 300 ], [ 100, 200 ] ])
})

test("removeVertex drops the point at the given index", () => {
  assert.deepEqual(removeVertex(BOX, 1), [ [ 100, 100 ], [ 300, 300 ], [ 100, 300 ] ])
})

test("removeVertex refuses to go below the minimum vertex count", () => {
  const triangle = [ [ 0, 0 ], [ 100, 0 ], [ 50, 100 ] ]
  assert.deepEqual(removeVertex(triangle, 0), triangle)
})

test("removeVertex allows a custom minimum", () => {
  const square = [ [ 0, 0 ], [ 100, 0 ], [ 100, 100 ], [ 0, 100 ] ]
  assert.deepEqual(removeVertex(square, 0, 4), square)
})
