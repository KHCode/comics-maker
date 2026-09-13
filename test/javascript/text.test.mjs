// Run with: node test/javascript/text.test.mjs

import test from "node:test"
import assert from "node:assert/strict"
import {
  MIN_TEXT_WIDTH,
  MIN_TEXT_HEIGHT,
  clampTextWidth,
  clampTextHeight,
  resizedSize,
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
