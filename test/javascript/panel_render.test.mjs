// Run with: node test/javascript/panel_render.test.mjs

import test from "node:test"
import assert from "node:assert/strict"
import { panelToRenderData, clipPathId, pointsToAttr } from "../../app/javascript/kapow/panel_render.js"

function ellipsePoints(cx, cy, rx, ry, count = 14) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count
    return [ cx + rx * Math.cos(angle), cy + ry * Math.sin(angle) ]
  })
}

function starPoints(cx, cy, outerR, innerR, points = 10) {
  const count = points * 2
  return Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI * i) / points
    const r = i % 2 === 0 ? outerR : innerR
    return [ cx + r * Math.sin(angle), cy - r * Math.cos(angle) ]
  })
}

test("pointsToAttr renders a plain SVG points string", () => {
  assert.equal(pointsToAttr([ [ 0, 0 ], [ 100, 0 ], [ 100, 100 ] ]), "0,0 100,0 100,100")
})

test("clipPathId is namespaced and stable per panel id", () => {
  assert.equal(clipPathId("p1"), "panel-clip-p1")
  assert.equal(clipPathId("p1"), clipPathId("p1"))
  assert.notEqual(clipPathId("p1"), clipPathId("p2"))
})

test("throws for a panel with fewer than 3 points", () => {
  assert.throws(() => panelToRenderData({ id: "bad", pts: [ [ 0, 0 ], [ 1, 1 ] ] }), /at least 3 points/)
})

test("throws for a panel with no pts at all", () => {
  assert.throws(() => panelToRenderData({ id: "bad" }), /at least 3 points/)
})

test("renders a Box (4-point rectangle)", () => {
  const panel = { id: "box1", pts: [ [ 0, 0 ], [ 100, 0 ], [ 100, 100 ], [ 0, 100 ] ] }
  const data = panelToRenderData(panel)

  assert.equal(data.id, "box1")
  assert.equal(data.clipPathId, "panel-clip-box1")
  assert.equal(data.pointsAttr, "0,0 100,0 100,100 0,100")
})

test("renders a Slant (4-point parallelogram)", () => {
  const panel = { id: "slant1", pts: [ [ 20, 0 ], [ 120, 0 ], [ 100, 100 ], [ 0, 100 ] ] }
  const data = panelToRenderData(panel)

  assert.equal(data.pointsAttr, "20,0 120,0 100,100 0,100")
})

test("renders a Round panel (14-point ellipse)", () => {
  const pts = ellipsePoints(310, 400, 120, 150, 14)
  const panel = { id: "round1", pts }
  const data = panelToRenderData(panel)

  assert.equal(pts.length, 14)
  assert.equal(data.pointsAttr.split(" ").length, 14)
})

test("renders a Burst panel (20-point star)", () => {
  const pts = starPoints(310, 400, 120, 60, 10)
  const panel = { id: "burst1", pts }
  const data = panelToRenderData(panel)

  assert.equal(pts.length, 20)
  assert.equal(data.pointsAttr.split(" ").length, 20)
})
