// Draw mode's Photo layer — pure geometry/schema logic for a panel's
// inserted photo (see the doc's schema: photo:{src,nw,nh,x,y,pct,rot,flip,
// cover,...}). No DOM dependency; see panel_controller.js for the SVG
// <image> rendering and pointer-driven pan gesture.
//
// `filename` is stored alongside `src` (the blob's signed_id) even though
// the doc's own schema doesn't list it — Active Storage's blob-serving
// route needs both to resolve an actual URL (see photoUrl below), and
// "resolved to a URL at render time" (the doc's own phrasing for `src`)
// isn't otherwise possible client-side with no server round-trip per
// render. bright/contrast/hue/sat/look (the Adjust tab) are a later PR;
// omitted here rather than stored with unused placeholder values.

export const MIN_SCALE_PCT = 20
export const MAX_SCALE_PCT = 300
export const MIN_ROTATE_DEG = -45
export const MAX_ROTATE_DEG = 45

export function clampScalePct(pct) {
  return Math.min(MAX_SCALE_PCT, Math.max(MIN_SCALE_PCT, pct))
}

export function clampRotateDeg(deg) {
  return Math.min(MAX_ROTATE_DEG, Math.max(MIN_ROTATE_DEG, deg))
}

// A freshly inserted photo: centered (x/y are an offset from the panel's
// own bounding-box center, in page units — see photoRenderBox), at 100%
// of its "contain" fit, unrotated, unflipped, not filling the panel.
export function defaultPhoto(src, filename, nw, nh) {
  return { src, filename, nw, nh, x: 0, y: 0, pct: 100, rot: 0, flip: false, cover: false }
}

// The Active Storage blob-redirect URL for a photo — needs both the
// blob's signed_id (`src`) and its original `filename` (the route takes
// both; only the signed_id is actually used to look the blob up, but the
// route requires the filename segment to be present).
export function photoUrl(photo) {
  return `/rails/active_storage/blobs/redirect/${photo.src}/${encodeURIComponent(photo.filename)}`
}

// The scale (image pixels -> page units) that makes the image exactly
// contain (default) or cover (photo.cover, "Fill panel") the panel's own
// bounding box, before the user's own Scale slider (photo.pct) multiplies
// it further.
export function baseScale(photo, boxWidth, boxHeight) {
  const scaleX = boxWidth / photo.nw
  const scaleY = boxHeight / photo.nh
  return photo.cover ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)
}

// Everything panel_controller.js needs to actually place the <image>: the
// panel-space point its (unrotated, unflipped) center sits at, and its
// rendered width/height at the combined base+user scale. `boxCenter` is
// the panel's own bounding-box center — since photo.x/y are stored as an
// *offset* from that (not absolute page coordinates), a panel move or
// scale that shifts/resizes the box automatically carries the photo along
// for free, without needing to touch photo.x/y itself (see
// panel_controller.js's beginDrag).
export function photoRenderBox(photo, boxCenter, boxWidth, boxHeight) {
  const scale = baseScale(photo, boxWidth, boxHeight) * (photo.pct / 100)
  return {
    centerX: boxCenter.x + photo.x,
    centerY: boxCenter.y + photo.y,
    width: photo.nw * scale,
    height: photo.nh * scale
  }
}

// Scale/corner-drag handles for a selected photo (see panel_controller.js
// #renderPhotoHandles/startPhotoScale). Each is named for its position on
// the image's own *unrotated* bounding box, given as a [x, y] offset from
// the box's center — the same local space toLocalPoint/toWorldPoint below
// convert to/from.
export function handleLocalPositions(width, height) {
  const hw = width / 2
  const hh = height / 2
  return {
    nw: [ -hw, -hh ], n: [ 0, -hh ], ne: [ hw, -hh ], e: [ hw, 0 ],
    se: [ hw, hh ], s: [ 0, hh ], sw: [ -hw, hh ], w: [ -hw, 0 ]
  }
}

function degToRad(deg) {
  return (deg * Math.PI) / 180
}

// Converts a page-space (world) point into the photo's own local
// coordinate space — unrotated, unflipped, relative to its own center —
// by undoing the exact rotate+flip transform panel_controller.js renders
// the <image> with (translate(center) rotate(rot) scale(flip?-1:1, 1)).
// Used to interpret a pointer's drag position in the same local space the
// handle positions above are already expressed in, regardless of the
// photo's current rotation/flip.
export function toLocalPoint(worldPoint, center, rot, flip) {
  const dx = worldPoint.x - center.x
  const dy = worldPoint.y - center.y
  const rad = degToRad(-rot)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const rx = dx * cos - dy * sin
  const ry = dx * sin + dy * cos
  return { x: flip ? -rx : rx, y: ry }
}

// The inverse of toLocalPoint — where a local point (e.g. one of
// handleLocalPositions' entries) actually renders on the page, given the
// photo's current rotation/flip. Used to position the handle dots
// themselves so they track the image's actual (rotated) corners/edges.
export function toWorldPoint(localPoint, center, rot, flip) {
  const sx = flip ? -localPoint.x : localPoint.x
  const rad = degToRad(rot)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const wx = sx * cos - localPoint.y * sin
  const wy = sx * sin + localPoint.y * cos
  return { x: center.x + wx, y: center.y + wy }
}

// How far a handle has been dragged, expressed as a new pct: projects the
// pointer's local-space position (see toLocalPoint) onto the handle's own
// direction from center, and scales photo.pct by how that projected
// distance compares to the handle's own original distance from center.
// Uniform (not per-axis) on purpose — every handle, corner or edge alike,
// scales the whole photo by the same factor around its own center, same
// as the Scale slider, just driven by a drag instead of a fixed control.
export function scalePctFromHandleDrag(originalPct, handleLocalPos, pointerLocalPos) {
  const [ hx, hy ] = handleLocalPos
  const originalDist = Math.hypot(hx, hy)
  if (originalDist === 0) return originalPct

  const dirX = hx / originalDist
  const dirY = hy / originalDist
  const projected = pointerLocalPos.x * dirX + pointerLocalPos.y * dirY

  return clampScalePct(originalPct * (projected / originalDist))
}
