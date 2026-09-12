// Run with: node test/javascript/photo.test.mjs

import test from "node:test"
import assert from "node:assert/strict"
import {
  MIN_SCALE_PCT,
  MAX_SCALE_PCT,
  MIN_ROTATE_DEG,
  MAX_ROTATE_DEG,
  MIN_ADJUST,
  MAX_ADJUST,
  MIN_HUE_DEG,
  MAX_HUE_DEG,
  clampScalePct,
  clampRotateDeg,
  clampAdjust,
  clampHueDeg,
  defaultPhoto,
  photoUrl,
  baseScale,
  photoRenderBox,
  photoFilterCss,
  handleLocalPositions,
  toLocalPoint,
  toWorldPoint,
  scalePctFromHandleDrag
} from "../../app/javascript/kapow/photo.js"

test("defaultPhoto centers, un-rotated/flipped, at 100% and not filling, with Adjust untouched", () => {
  const photo = defaultPhoto("abc123", "cat.png", 400, 300)
  assert.deepEqual(photo, {
    src: "abc123", filename: "cat.png", nw: 400, nh: 300,
    x: 0, y: 0, pct: 100, rot: 0, flip: false, cover: false,
    bright: 0, contrast: 0, hue: 0, sat: 0, look: "none"
  })
})

test("photoUrl builds the Active Storage blob-redirect path from src + filename", () => {
  const photo = defaultPhoto("abc123", "my photo.png", 400, 300)
  assert.equal(photoUrl(photo), "/rails/active_storage/blobs/redirect/abc123/my%20photo.png")
})

test("clampScalePct clamps to the 20-300% range", () => {
  assert.equal(clampScalePct(10), MIN_SCALE_PCT)
  assert.equal(clampScalePct(500), MAX_SCALE_PCT)
  assert.equal(clampScalePct(150), 150)
})

test("clampRotateDeg clamps to the +/-45 degree range", () => {
  assert.equal(clampRotateDeg(-90), MIN_ROTATE_DEG)
  assert.equal(clampRotateDeg(90), MAX_ROTATE_DEG)
  assert.equal(clampRotateDeg(10), 10)
})

test("clampAdjust clamps to the -100..100 range", () => {
  assert.equal(clampAdjust(-500), MIN_ADJUST)
  assert.equal(clampAdjust(500), MAX_ADJUST)
  assert.equal(clampAdjust(42), 42)
})

test("clampHueDeg clamps to the +/-180 degree range", () => {
  assert.equal(clampHueDeg(-270), MIN_HUE_DEG)
  assert.equal(clampHueDeg(270), MAX_HUE_DEG)
  assert.equal(clampHueDeg(90), 90)
})

test("photoFilterCss expresses neutral Adjust settings as neutral filter functions", () => {
  const photo = defaultPhoto("id", "f.png", 400, 200)
  assert.equal(
    photoFilterCss(photo),
    "brightness(1) contrast(1) saturate(1) hue-rotate(0deg)"
  )
})

test("photoFilterCss maps sliders onto their filter functions", () => {
  const photo = { ...defaultPhoto("id", "f.png", 400, 200), bright: 20, contrast: -30, sat: 50, hue: 90 }
  assert.equal(
    photoFilterCss(photo),
    "brightness(1.2) contrast(0.7) saturate(1.5) hue-rotate(90deg)"
  )
})

test("photoFilterCss layers a look's own fixed filters ahead of the sliders", () => {
  const photo = { ...defaultPhoto("id", "f.png", 400, 200), look: "ink_bw" }
  assert.equal(
    photoFilterCss(photo),
    "grayscale(1) contrast(1.2) brightness(1) contrast(1) saturate(1) hue-rotate(0deg)"
  )
})

test("photoFilterCss defaults missing Adjust fields to neutral, for photos saved before this field set existed", () => {
  const legacyPhoto = { src: "id", filename: "f.png", nw: 400, nh: 200, x: 0, y: 0, pct: 100, rot: 0, flip: false, cover: false }
  assert.equal(
    photoFilterCss(legacyPhoto),
    "brightness(1) contrast(1) saturate(1) hue-rotate(0deg)"
  )
})

test("baseScale contain-fits by default: the smaller of the two axis scales", () => {
  const photo = defaultPhoto("id", "f.png", 400, 200) // 2:1 landscape image
  // panel is 100x100 (square) — height is the binding axis (100/200 < 100/400)
  assert.equal(baseScale(photo, 100, 100), 0.25)
})

test("baseScale cover-fits when photo.cover is set: the larger of the two axis scales", () => {
  const photo = { ...defaultPhoto("id", "f.png", 400, 200), cover: true }
  assert.equal(baseScale(photo, 100, 100), 0.5)
})

test("photoRenderBox centers on the box center plus the photo's own pan offset", () => {
  const photo = defaultPhoto("id", "f.png", 400, 200)
  const box = photoRenderBox(photo, { x: 50, y: 50 }, 100, 100)
  assert.equal(box.centerX, 50)
  assert.equal(box.centerY, 50)
  assert.equal(box.width, 100) // 400 * 0.25 (contain scale) * (100/100 pct)
  assert.equal(box.height, 50) // 200 * 0.25

  const panned = { ...photo, x: 10, y: -5 }
  const pannedBox = photoRenderBox(panned, { x: 50, y: 50 }, 100, 100)
  assert.equal(pannedBox.centerX, 60)
  assert.equal(pannedBox.centerY, 45)
})

test("photoRenderBox scales width/height with the pct slider on top of the base fit", () => {
  const photo = { ...defaultPhoto("id", "f.png", 400, 200), pct: 200 }
  const box = photoRenderBox(photo, { x: 0, y: 0 }, 100, 100)
  assert.equal(box.width, 200) // 100 (100% contain) * 2
  assert.equal(box.height, 100)
})

test("handleLocalPositions places all 8 handles at the box's corners/edge-midpoints", () => {
  assert.deepEqual(handleLocalPositions(200, 100), {
    nw: [ -100, -50 ], n: [ 0, -50 ], ne: [ 100, -50 ], e: [ 100, 0 ],
    se: [ 100, 50 ], s: [ 0, 50 ], sw: [ -100, 50 ], w: [ -100, 0 ]
  })
})

test("toLocalPoint/toWorldPoint round-trip with no rotation or flip", () => {
  const center = { x: 50, y: 50 }
  const local = { x: 30, y: -10 }
  const world = toWorldPoint(local, center, 0, false)
  assert.deepEqual(world, { x: 80, y: 40 })
  const roundTripped = toLocalPoint(world, center, 0, false)
  assert.ok(Math.abs(roundTripped.x - local.x) < 1e-9)
  assert.ok(Math.abs(roundTripped.y - local.y) < 1e-9)
})

test("toWorldPoint applies flip before rotation, mirroring the x axis", () => {
  const center = { x: 0, y: 0 }
  assert.deepEqual(toWorldPoint({ x: 30, y: 10 }, center, 0, true), { x: -30, y: 10 })
})

test("toWorldPoint rotates a point 90 degrees around the center", () => {
  const center = { x: 0, y: 0 }
  const world = toWorldPoint({ x: 10, y: 0 }, center, 90, false)
  assert.ok(Math.abs(world.x - 0) < 1e-9)
  assert.ok(Math.abs(world.y - 10) < 1e-9)
})

test("toLocalPoint/toWorldPoint round-trip with rotation and flip combined", () => {
  const center = { x: 20, y: -15 }
  const local = { x: 40, y: -25 }
  for (const rot of [ -45, 0, 30, 90 ]) {
    for (const flip of [ false, true ]) {
      const world = toWorldPoint(local, center, rot, flip)
      const roundTripped = toLocalPoint(world, center, rot, flip)
      assert.ok(Math.abs(roundTripped.x - local.x) < 1e-9, `x mismatch at rot=${rot} flip=${flip}`)
      assert.ok(Math.abs(roundTripped.y - local.y) < 1e-9, `y mismatch at rot=${rot} flip=${flip}`)
    }
  }
})

test("scalePctFromHandleDrag grows pct when a corner is dragged further from center", () => {
  const handle = handleLocalPositions(200, 100).se // [100, 50]
  const pct = scalePctFromHandleDrag(100, handle, { x: 150, y: 75 }) // 1.5x further out
  assert.ok(Math.abs(pct - 150) < 1e-9)
})

test("scalePctFromHandleDrag shrinks pct when a corner is dragged toward center", () => {
  const handle = handleLocalPositions(200, 100).se
  const pct = scalePctFromHandleDrag(100, handle, { x: 50, y: 25 }) // half the distance
  assert.equal(pct, 50)
})

test("scalePctFromHandleDrag on an edge handle only responds to movement along its own axis", () => {
  const eastHandle = handleLocalPositions(200, 100).e // [100, 0]
  // dragging straight down (perpendicular to east) barely changes pct
  const pct = scalePctFromHandleDrag(100, eastHandle, { x: 100, y: 80 })
  assert.equal(pct, 100)
})

test("scalePctFromHandleDrag clamps to the 20-300% range", () => {
  const handle = handleLocalPositions(200, 100).se
  assert.equal(scalePctFromHandleDrag(100, handle, { x: 1000, y: 500 }), MAX_SCALE_PCT)
  assert.equal(scalePctFromHandleDrag(100, handle, { x: 1, y: 0.5 }), MIN_SCALE_PCT)
})
