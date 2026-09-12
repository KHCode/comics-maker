// Run with: node test/javascript/photo.test.mjs

import test from "node:test"
import assert from "node:assert/strict"
import {
  MIN_SCALE_PCT,
  MAX_SCALE_PCT,
  MIN_ROTATE_DEG,
  MAX_ROTATE_DEG,
  clampScalePct,
  clampRotateDeg,
  defaultPhoto,
  photoUrl,
  baseScale,
  photoRenderBox
} from "../../app/javascript/kapow/photo.js"

test("defaultPhoto centers, un-rotated/flipped, at 100% and not filling", () => {
  const photo = defaultPhoto("abc123", "cat.png", 400, 300)
  assert.deepEqual(photo, {
    src: "abc123", filename: "cat.png", nw: 400, nh: 300,
    x: 0, y: 0, pct: 100, rot: 0, flip: false, cover: false
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
