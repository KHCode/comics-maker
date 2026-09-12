// Run with: node test/javascript/ink.test.mjs

import test from "node:test"
import assert from "node:assert/strict"
import {
  INK_TOOLS,
  INK_SIZES,
  INK_COLORS,
  pressureOrDefault,
  strokeWidth,
  eraseStrokes
} from "../../app/javascript/kapow/ink.js"

test("INK_COLORS exposes exactly 7 swatches", () => {
  assert.equal(INK_COLORS.length, 7)
})

test("pressureOrDefault passes through a real pressure reading", () => {
  assert.equal(pressureOrDefault(0.8), 0.8)
})

test("pressureOrDefault falls back to 0.5 for a zero/missing reading", () => {
  assert.equal(pressureOrDefault(0), 0.5)
  assert.equal(pressureOrDefault(undefined), 0.5)
})

test("strokeWidth at default pressure is just the size's base width for Pen", () => {
  assert.equal(strokeWidth("m", "pen"), INK_SIZES.m)
  assert.equal(strokeWidth("s", "pen"), INK_SIZES.s)
  assert.equal(strokeWidth("l", "pen"), INK_SIZES.l)
})

test("strokeWidth applies Marker's 2.4x width multiplier", () => {
  assert.equal(strokeWidth("m", "marker"), INK_SIZES.m * 2.4)
})

test("strokeWidth scales with pressure relative to the 0.5 default", () => {
  assert.equal(strokeWidth("m", "pen", 1), INK_SIZES.m * 2)
  assert.equal(strokeWidth("m", "pen", 0.25), INK_SIZES.m * 0.5)
})

test("INK_TOOLS gives Marker a 45% opacity and Pen full opacity", () => {
  assert.equal(INK_TOOLS.marker.opacity, 0.45)
  assert.equal(INK_TOOLS.pen.opacity, 1)
})

test("eraseStrokes leaves strokes untouched when the eraser never gets close", () => {
  const strokes = [ { tool: "pen", color: "#000", w: 4, op: 1, pts: [ [ 0, 0 ], [ 100, 0 ] ] } ]
  const result = eraseStrokes(strokes, [ [ 500, 500 ] ], 10)
  assert.deepEqual(result, strokes)
})

test("eraseStrokes removes a stroke entirely when the eraser covers all of it", () => {
  const strokes = [ { tool: "pen", color: "#000", w: 4, op: 1, pts: [ [ 0, 0 ], [ 5, 0 ], [ 10, 0 ] ] } ]
  const result = eraseStrokes(strokes, [ [ 5, 0 ] ], 50)
  assert.deepEqual(result, [])
})

test("eraseStrokes splits a stroke into two segments when the eraser passes through its middle", () => {
  const strokes = [ { tool: "pen", color: "#000", w: 4, op: 1, pts: [ [ 0, 0 ], [ 10, 0 ], [ 20, 0 ], [ 30, 0 ], [ 40, 0 ] ] } ]
  const result = eraseStrokes(strokes, [ [ 20, 0 ] ], 5)

  assert.equal(result.length, 2)
  assert.deepEqual(result[0].pts, [ [ 0, 0 ], [ 10, 0 ] ])
  assert.deepEqual(result[1].pts, [ [ 30, 0 ], [ 40, 0 ] ])
})

test("eraseStrokes drops a surviving segment with fewer than 2 points", () => {
  const strokes = [ { tool: "pen", color: "#000", w: 4, op: 1, pts: [ [ 0, 0 ], [ 10, 0 ], [ 20, 0 ] ] } ]
  // erasing everything but the very first point leaves a 1-point remnant
  const result = eraseStrokes(strokes, [ [ 10, 0 ], [ 20, 0 ] ], 3)
  assert.deepEqual(result, [])
})

test("eraseStrokes preserves the other stroke fields (tool/color/w/op) on surviving segments", () => {
  const strokes = [ { tool: "marker", color: "#e0452d", w: 19.2, op: 0.45, pts: [ [ 0, 0 ], [ 10, 0 ], [ 20, 0 ] ] } ]
  const result = eraseStrokes(strokes, [ [ 100, 100 ] ], 5)
  assert.deepEqual(result, strokes)
})

test("eraseStrokes leaves other strokes on the same panel untouched", () => {
  const untouched = { tool: "pen", color: "#000", w: 4, op: 1, pts: [ [ 500, 500 ], [ 600, 500 ] ] }
  const erased = { tool: "pen", color: "#000", w: 4, op: 1, pts: [ [ 0, 0 ], [ 5, 0 ] ] }
  const result = eraseStrokes([ untouched, erased ], [ [ 2, 0 ] ], 10)
  assert.deepEqual(result, [ untouched ])
})
