// Pure, framework-agnostic conversion of a panel (see the doc's schema:
// { id, pts:[[x,y]...], strokes:[...], photo:{...}|null }) into the data
// needed to render it as an SVG shape. No DOM dependency — this works the
// same for any point count/arrangement (a 4-point Box, a 4-point Slant, a
// 14-point Round ellipse, a 20-point Burst star all just become polygons)
// so it doesn't need to know which "kind" produced the points. See
// app/javascript/controllers/panel_controller.js for the DOM glue that
// actually renders this into an <svg>.
export function panelToRenderData(panel) {
  if (!Array.isArray(panel.pts) || panel.pts.length < 3) {
    throw new Error(`Panel ${panel.id} needs at least 3 points to render`)
  }

  return {
    id: panel.id,
    clipPathId: clipPathId(panel.id),
    pointsAttr: pointsToAttr(panel.pts)
  }
}

export function clipPathId(panelId) {
  return `panel-clip-${panelId}`
}

export function pointsToAttr(pts) {
  return pts.map(([ x, y ]) => `${x},${y}`).join(" ")
}
