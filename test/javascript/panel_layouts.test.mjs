// Run with: node test/javascript/panel_layouts.test.mjs

import test from "node:test"
import assert from "node:assert/strict"
import {
  gridPreset,
  actionPreset,
  bigPlusPreset,
  tallPlusPreset,
  PRESETS_BY_FORMAT,
  generatePreset
} from "../../app/javascript/kapow/panel_layouts.js"
import { newPanel } from "../../app/javascript/kapow/panel_shapes.js"

test("gridPreset returns rows*cols panels, all boxes", () => {
  const panels = gridPreset(620, 956, 2, 3, newPanel)
  assert.equal(panels.length, 6)
  for (const panel of panels) assert.equal(panel.pts.length, 4)
})

test("gridPreset panels stay within the page bounds and don't overlap", () => {
  const panels = gridPreset(620, 956, 3, 1, newPanel)
  assert.equal(panels.length, 3)

  const boxes = panels.map((p) => p.pts)
  for (const pts of boxes) {
    for (const [ x, y ] of pts) {
      assert.ok(x >= 0 && x <= 620)
      assert.ok(y >= 0 && y <= 956)
    }
  }

  // stacked rows: each panel's top (pts[0].y) should be below the previous
  // panel's bottom (pts[2].y)
  assert.ok(boxes[0][2][1] < boxes[1][0][1])
  assert.ok(boxes[1][2][1] < boxes[2][0][1])
})

test("actionPreset returns slanted (non-rectangular) rows", () => {
  const panels = actionPreset(560, 794, newPanel, 3)
  assert.equal(panels.length, 3)
  for (const panel of panels) {
    assert.equal(panel.pts.length, 4)
    // a slant's top-left x differs from its bottom-left x (unlike a box)
    assert.notEqual(panel.pts[0][0], panel.pts[3][0])
  }
})

test("bigPlusPreset returns 1 + n panels, big one first", () => {
  const panels = bigPlusPreset(620, 956, 2, newPanel)
  assert.equal(panels.length, 3)

  const [ big, ...smalls ] = panels
  const bigWidth = big.pts[1][0] - big.pts[0][0]
  const bigHeight = big.pts[2][1] - big.pts[1][1]
  assert.equal(smalls.length, 2)
  for (const small of smalls) {
    const smallWidth = small.pts[1][0] - small.pts[0][0]
    assert.ok(smallWidth < bigWidth)
  }
  // the big panel sits above the small ones
  assert.ok(big.pts[2][1] < smalls[0].pts[0][1])
  assert.equal(bigHeight, big.pts[2][1] - big.pts[1][1])
})

test("tallPlusPreset returns 1 + n panels, tall one first, on the left", () => {
  const panels = tallPlusPreset(500, 1500, 2, newPanel)
  assert.equal(panels.length, 3)

  const [ tall, ...smalls ] = panels
  assert.equal(smalls.length, 2)
  // the tall panel sits left of the small ones
  assert.ok(tall.pts[1][0] < smalls[0].pts[0][0])
  // small panels are stacked: first is above the second
  assert.ok(smalls[0].pts[2][1] < smalls[1].pts[0][1])
})

test("every format in the doc's table has its documented presets", () => {
  assert.deepEqual(Object.keys(PRESETS_BY_FORMAT.comic).sort(), [ "2×2", "2×3", "3 Rows", "Big + 2" ].sort())
  assert.deepEqual(Object.keys(PRESETS_BY_FORMAT.manga_b5).sort(), [ "2×2", "4-koma", "Action", "Big + 2" ].sort())
  assert.deepEqual(Object.keys(PRESETS_BY_FORMAT.newspaper_strip).sort(), [ "3 across", "4 across", "Big + 1" ].sort())
  assert.deepEqual(Object.keys(PRESETS_BY_FORMAT.webtoon).sort(), [ "3 stacked", "5 stacked", "Tall + 2" ].sort())
})

test("generatePreset dispatches to the right format+name combination", () => {
  const panels = generatePreset("comic", "2×2", 620, 956, newPanel)
  assert.equal(panels.length, 4)
})

test("generatePreset rejects an unknown format or preset name", () => {
  assert.throws(() => generatePreset("comic", "Nonexistent", 620, 956, newPanel), /Unknown preset/)
  assert.throws(() => generatePreset("nonexistent_format", "2×2", 620, 956, newPanel), /Unknown preset/)
})
