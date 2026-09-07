// Run with: node test/javascript/panel_shapes.test.mjs

import test from "node:test"
import assert from "node:assert/strict"
import { boxPoints, slantPoints, roundPoints, burstPoints, newPanel, generatePanelPoints } from "../../app/javascript/kapow/panel_shapes.js"

test("boxPoints returns the 4 corners of the bounding box", () => {
  assert.deepEqual(boxPoints(10, 20, 100, 50), [ [ 10, 20 ], [ 110, 20 ], [ 110, 70 ], [ 10, 70 ] ])
})

test("slantPoints shifts the top edge right by the skew fraction", () => {
  const pts = slantPoints(0, 0, 100, 50, 0.2)
  assert.deepEqual(pts, [ [ 20, 0 ], [ 100, 0 ], [ 80, 50 ], [ 0, 50 ] ])
})

test("slantPoints defaults to a 0.2 skew", () => {
  assert.deepEqual(slantPoints(0, 0, 100, 50), slantPoints(0, 0, 100, 50, 0.2))
})

test("roundPoints returns 14 points by default, inscribed in the box", () => {
  const pts = roundPoints(0, 0, 200, 100)
  assert.equal(pts.length, 14)
  // topmost point should be at the horizontal center, y = 0 (top of box)
  assert.deepEqual(pts[0], [ 100, 0 ])
  for (const [ x, y ] of pts) {
    assert.ok(x >= -0.01 && x <= 200.01)
    assert.ok(y >= -0.01 && y <= 100.01)
  }
})

test("burstPoints returns 20 points by default, alternating outer/inner radius", () => {
  const pts = burstPoints(0, 0, 200, 200)
  assert.equal(pts.length, 20)

  const cx = 100, cy = 100
  const distances = pts.map(([ x, y ]) => Math.hypot(x - cx, y - cy))
  // alternating: even indices are the outer radius (100), odd are inner (50)
  assert.ok(Math.abs(distances[0] - 100) < 0.1)
  assert.ok(Math.abs(distances[1] - 50) < 0.1)
  assert.ok(Math.abs(distances[2] - 100) < 0.1)
})

test("generatePanelPoints dispatches to the right shape generator", () => {
  assert.deepEqual(generatePanelPoints("box", 0, 0, 100, 100), boxPoints(0, 0, 100, 100))
  assert.equal(generatePanelPoints("round", 0, 0, 100, 100).length, 14)
  assert.equal(generatePanelPoints("burst", 0, 0, 100, 100).length, 20)
})

test("generatePanelPoints rejects an unknown shape", () => {
  assert.throws(() => generatePanelPoints("hexagon", 0, 0, 10, 10), /Unknown panel shape/)
})

test("newPanel builds a full panel object with an id, empty strokes, no photo", () => {
  const panel = newPanel("box", 0, 0, 100, 100, "fixed-id")

  assert.equal(panel.id, "fixed-id")
  assert.deepEqual(panel.pts, boxPoints(0, 0, 100, 100))
  assert.deepEqual(panel.strokes, [])
  assert.equal(panel.photo, null)
})

test("newPanel generates a unique id when none is given", () => {
  const a = newPanel("box", 0, 0, 10, 10)
  const b = newPanel("box", 0, 0, 10, 10)
  assert.notEqual(a.id, b.id)
})
