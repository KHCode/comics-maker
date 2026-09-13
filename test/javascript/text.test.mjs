// Run with: node test/javascript/text.test.mjs

import test from "node:test"
import assert from "node:assert/strict"
import {
  TEXT_KINDS,
  MIN_TEXT_WIDTH,
  MIN_TEXT_HEIGHT,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  FONT_SIZE_STEP,
  ROTATE_STEP_DEG,
  FONT_CHOICES,
  SFX_COLORS,
  SFX_DEFAULT_COLOR,
  SFX_DEFAULT_ROTATION_DEG,
  clampTextWidth,
  clampTextHeight,
  resizedSize,
  clampFontSize,
  rotateStep,
  tailBaseCenter,
  tailShaftMidpoint,
  speechBubblePath,
  shoutStarPoints,
  shoutStarPath,
  tailedShapeBounds,
  defaultText,
  fontFamilyCss
} from "../../app/javascript/kapow/text.js"

test("clampTextWidth/Height clamp to their minimums", () => {
  assert.equal(clampTextWidth(10), MIN_TEXT_WIDTH)
  assert.equal(clampTextWidth(200), 200)
  assert.equal(clampTextHeight(5), MIN_TEXT_HEIGHT)
  assert.equal(clampTextHeight(90), 90)
})

test("resizedSize grows/shrinks from the original size and clamps to the minimum", () => {
  assert.deepEqual(resizedSize(200, 120, 50, -20), { w: 250, h: 100 })
  assert.deepEqual(resizedSize(200, 120, -1000, -1000), { w: MIN_TEXT_WIDTH, h: MIN_TEXT_HEIGHT })
})

test("defaultText centers a speech bubble on (x, y), with a fixed default tail below it", () => {
  const text = defaultText("speech", 300, 200)
  assert.equal(text.kind, "speech")
  assert.equal(text.x, 300 - text.w / 2)
  assert.equal(text.y, 200 - text.h / 2)
  assert.equal(text.fs, 22)
  assert.equal(text.rot, 0)
  assert.equal(text.text, "")
  assert.equal(text.font, "comic")
  assert.equal(text.bold, true)
  assert.equal(text.italic, false)
  assert.equal(text.color, null)
  assert.deepEqual(text.tail, [ 300, 200 + text.h / 2 + 30 ])
})

test("defaultText gives caption/narration no tail", () => {
  assert.equal(defaultText("caption", 0, 0).tail, null)
  assert.equal(defaultText("narration", 0, 0).tail, null)
})

test("defaultText sets narration to bold+italic per the doc's defaults table, caption to bold only", () => {
  const caption = defaultText("caption", 0, 0)
  assert.equal(caption.bold, true)
  assert.equal(caption.italic, false)

  const narration = defaultText("narration", 0, 0)
  assert.equal(narration.bold, true)
  assert.equal(narration.italic, true)
})

test("TEXT_KINDS lists all 5 kinds covered so far, Think excluded (a later PR)", () => {
  assert.deepEqual(TEXT_KINDS, [ "speech", "caption", "narration", "shout", "sfx" ])
})

test("defaultText gives Shout a fixed default tail below it, like Speech", () => {
  const text = defaultText("shout", 300, 200)
  assert.equal(text.font, "loud")
  assert.deepEqual(text.tail, [ 300, 200 + text.h / 2 + 30 ])
})

test("defaultText sets SFX's doc-specified defaults: Loud font, red color, -8deg rotation, no tail", () => {
  const text = defaultText("sfx", 0, 0)
  assert.equal(text.font, "loud")
  assert.equal(text.color, SFX_DEFAULT_COLOR)
  assert.equal(text.rot, SFX_DEFAULT_ROTATION_DEG)
  assert.equal(text.tail, null)
})

test("SFX_COLORS lists 7 swatches", () => {
  assert.equal(SFX_COLORS.length, 7)
})

test("defaultText assigns each a unique id", () => {
  const a = defaultText("speech", 0, 0)
  const b = defaultText("speech", 0, 0)
  assert.notEqual(a.id, b.id)
})

test("fontFamilyCss maps the doc's 4 font choices to their CSS stacks", () => {
  assert.equal(fontFamilyCss("comic"), '"Comic Neue", cursive')
  assert.equal(fontFamilyCss("loud"), '"Bangers", cursive')
  assert.equal(fontFamilyCss("print"), '"Nunito", sans-serif')
  assert.equal(fontFamilyCss("serif"), "Georgia, serif")
})

test("fontFamilyCss falls back to the comic stack for an unknown/missing font", () => {
  assert.equal(fontFamilyCss(undefined), fontFamilyCss("comic"))
  assert.equal(fontFamilyCss("nonsense"), fontFamilyCss("comic"))
})

test("clampFontSize clamps to the min/max font size", () => {
  assert.equal(clampFontSize(2), MIN_FONT_SIZE)
  assert.equal(clampFontSize(200), MAX_FONT_SIZE)
  assert.equal(clampFontSize(30), 30)
})

test("FONT_SIZE_STEP is a sane, nonzero A-/A+ increment", () => {
  assert.ok(FONT_SIZE_STEP > 0)
})

test("rotateStep steps by the doc's 8-degree increment in either direction", () => {
  assert.equal(rotateStep(0, 1), ROTATE_STEP_DEG)
  assert.equal(rotateStep(ROTATE_STEP_DEG, -1), 0)
})

test("rotateStep normalizes into [0, 360) rather than growing/going negative without bound", () => {
  assert.equal(rotateStep(356, 1), (356 + ROTATE_STEP_DEG) % 360)
  assert.equal(rotateStep(0, -1), 360 - ROTATE_STEP_DEG)
})

test("FONT_CHOICES lists the doc's 4 lettering fonts", () => {
  assert.deepEqual(FONT_CHOICES, [ "comic", "loud", "print", "serif" ])
})

test("tailBaseCenter is the bubble box's own bottom-center point", () => {
  assert.deepEqual(tailBaseCenter({ x: 100, y: 50, w: 200, h: 120 }), [ 200, 170 ])
})

test("tailShaftMidpoint sits halfway between the bubble's base and the tail tip", () => {
  const text = { x: 100, y: 50, w: 200, h: 120, tail: [ 400, 500 ] }
  // base center is [200, 170]; tail tip is [400, 500]
  assert.deepEqual(tailShaftMidpoint(text), [ 300, 335 ])
})

test("tailShaftMidpoint returns null when the element has no tail", () => {
  assert.equal(tailShaftMidpoint({ x: 0, y: 0, w: 10, h: 10, tail: null }), null)
})

test("speechBubblePath draws a single closed path (no separate re-entry) whether or not there's a tail", () => {
  const withTail = { x: 100, y: 50, w: 200, h: 120, tail: [ 400, 500 ] }
  const path = speechBubblePath(withTail)
  assert.match(path, /^M .+ L .+ L .+ A .+ Z$/)
  // The tail tip's own coordinates appear verbatim in the path (the
  // second point drawn, right after the first "M").
  assert.match(path, /L 400 500 /)

  const withoutTail = { x: 100, y: 50, w: 200, h: 120, tail: null }
  assert.match(speechBubblePath(withoutTail), /^M .+ A .+ A .+ Z$/)
})

test("tailedShapeBounds is just the body's own box when there's no tail", () => {
  assert.deepEqual(tailedShapeBounds({ x: 100, y: 50, w: 200, h: 120, tail: null }), {
    minX: 100, minY: 50, maxX: 300, maxY: 170
  })
})

test("tailedShapeBounds extends to include a tail tip that sits outside the body's own box", () => {
  assert.deepEqual(tailedShapeBounds({ x: 100, y: 50, w: 200, h: 120, tail: [ 400, 500 ] }), {
    minX: 100, minY: 50, maxX: 400, maxY: 500
  })
  // A tail tip dragged up and to the left of the body extends minX/minY
  // instead of maxX/maxY.
  assert.deepEqual(tailedShapeBounds({ x: 100, y: 50, w: 200, h: 120, tail: [ -20, -10 ] }), {
    minX: -20, minY: -10, maxX: 300, maxY: 170
  })
})

test("shoutStarPoints generates a 20-vertex (10-point) star inscribed in the box, no tail", () => {
  const points = shoutStarPoints({ x: 100, y: 50, w: 200, h: 120, tail: null })
  assert.equal(points.length, 20)
  // The bottommost outer vertex sits at the box's own bottom-center when
  // there's no tail to stretch it toward.
  const [ cx, cy ] = tailBaseCenter({ x: 100, y: 50, w: 200, h: 120 })
  const [ bx, by ] = points[10]
  assert.ok(Math.abs(bx - cx) < 0.001)
  assert.ok(Math.abs(by - cy) < 0.001)
})

test("shoutStarPoints stretches its bottommost point out to the tail tip instead, when there's a tail", () => {
  const points = shoutStarPoints({ x: 100, y: 50, w: 200, h: 120, tail: [ 500, 600 ] })
  assert.deepEqual(points[10], [ 500, 600 ])
})

test("shoutStarPath draws a single closed polygon through all 20 vertices", () => {
  const path = shoutStarPath({ x: 100, y: 50, w: 200, h: 120, tail: [ 500, 600 ] })
  assert.match(path, /^M .+ Z$/)
  assert.equal((path.match(/L /g) || []).length, 19)
  assert.match(path, /L 500 600/)
})
