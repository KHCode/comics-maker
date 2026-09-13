// Letter mode's text elements — pure geometry/schema logic mirroring
// kapow/photo.js's style. See the doc's schema: text:{id,kind,x,y,w,h,fs,
// rot,text,tail:[x,y]|null,font?,bold?,italic?,color?}. No DOM dependency;
// see text_controller.js for the HTML-overlay rendering and the
// pointer-driven move/resize/edit gestures.
//
// Speech/Caption/Narration (the "box-shaped" kinds) and Shout/SFX (the
// starburst/plain-display kinds) are covered here, per the plan's phase
// split — Think (the last kind, reusing/extending this same tail
// mechanism for its bubble-trail tail) is a later PR.

export const TEXT_KINDS = [ "speech", "caption", "narration", "shout", "sfx" ]

export const MIN_TEXT_WIDTH = 60
export const MIN_TEXT_HEIGHT = 40

export function clampTextWidth(w) {
  return Math.max(MIN_TEXT_WIDTH, w)
}

export function clampTextHeight(h) {
  return Math.max(MIN_TEXT_HEIGHT, h)
}

// A resize handle drag's new size, given page-unit deltas from the
// pointer's start position — the box grows/shrinks from its own top-left
// (x/y never change), clamped to a sane minimum either axis.
export function resizedSize(originalW, originalH, dx, dy) {
  return { w: clampTextWidth(originalW + dx), h: clampTextHeight(originalH + dy) }
}

// Floating bar's A-/A+ font-size step and clamp range.
export const MIN_FONT_SIZE = 10
export const MAX_FONT_SIZE = 72
export const FONT_SIZE_STEP = 4

export function clampFontSize(fs) {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fs))
}

// Floating bar's rotate buttons step in fixed 8° increments (see the
// doc), with no min/max — a full, repeatable rotation, unlike photo's
// bounded +/-45°. Normalized into [0, 360) after each step just so the
// stored number doesn't grow without bound across many clicks.
export const ROTATE_STEP_DEG = 8

export function rotateStep(rot, direction) {
  const stepped = rot + direction * ROTATE_STEP_DEG
  return ((stepped % 360) + 360) % 360
}

// The doc's 4 lettering font choices, in the order the floating bar's
// type row presents them.
export const FONT_CHOICES = [ "comic", "loud", "print", "serif" ]

// Speech's bubble + tail as ONE continuous shape (real comic-book bubbles
// have no seam where the tail meets the body — a separately drawn ellipse
// and triangle, each with their own stroke, can't achieve that). The
// tail's two flanks leave the ellipse boundary at a small angular offset
// either side of "straight down" (the box's own bottom-*edge* only
// touches the ellipse at the single bottommost point, not across a
// range), then meet at the tail tip.
const TAIL_BASE_HALF_ANGLE_DEG = 16

function ellipsePoint(cx, cy, rx, ry, deg) {
  const rad = (deg * Math.PI) / 180
  return [ cx + rx * Math.cos(rad), cy + ry * Math.sin(rad) ]
}

// The bottom-center point of the bubble's own bounding box — a rough
// anchor for the tail's "shaft" handle (see tailShaftMidpoint), not
// exactly where the tail's flanks leave the ellipse (see
// TAIL_BASE_HALF_ANGLE_DEG above) since that precision doesn't matter for
// a handle position.
export function tailBaseCenter(text) {
  return [ text.x + text.w / 2, text.y + text.h ]
}

// The "move both together" handle (see text_controller.js#startBothDrag)
// sits at the midpoint of the tail's shaft, roughly between the bubble
// and its tip — a location distinct from both the bubble body (drag =
// bubble only) and the tail-tip dot (drag = tail only).
export function tailShaftMidpoint(text) {
  if (!text.tail) return null
  const [ bx, by ] = tailBaseCenter(text)
  const [ tx, ty ] = text.tail
  return [ (bx + tx) / 2, (by + ty) / 2 ]
}

// An SVG path `d` string for the combined bubble+tail outline. Falls back
// to a plain closed ellipse if there's no tail (shouldn't happen in
// practice — every Speech text gets a default tail — but keeps this safe
// to call unconditionally).
export function speechBubblePath(text) {
  const cx = text.x + text.w / 2
  const cy = text.y + text.h / 2
  const rx = text.w / 2
  const ry = text.h / 2

  if (!text.tail) {
    return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`
  }

  const [ leftX, leftY ] = ellipsePoint(cx, cy, rx, ry, 90 + TAIL_BASE_HALF_ANGLE_DEG)
  const [ rightX, rightY ] = ellipsePoint(cx, cy, rx, ry, 90 - TAIL_BASE_HALF_ANGLE_DEG)
  const [ tx, ty ] = text.tail

  return [
    `M ${leftX} ${leftY}`,
    `L ${tx} ${ty}`,
    `L ${rightX} ${rightY}`,
    // sweep-flag=0 (not 1) is what actually resolves to *this* ellipse
    // (centered on the bubble's own box) for the long way around — the
    // other flag combos either draw the short bottom sliver or a wildly
    // different, wrong ellipse through the same two points; verified
    // empirically against getBBox(), not derived by hand.
    `A ${rx} ${ry} 0 1 0 ${leftX} ${leftY}`,
    "Z"
  ].join(" ")
}

// The bounding box a combined body+tail shape needs to render in (Speech's
// ellipse, or Shout's star below) — the body's own box, extended to
// include the tail tip (which is otherwise free to sit well outside it).
// Generic over both: neither the ellipse nor the star ever exceeds their
// own box's edges, so this only needs text.x/y/w/h/tail, not the kind.
export function tailedShapeBounds(text) {
  let minX = text.x
  let minY = text.y
  let maxX = text.x + text.w
  let maxY = text.y + text.h

  if (text.tail) {
    const [ tx, ty ] = text.tail
    minX = Math.min(minX, tx)
    minY = Math.min(minY, ty)
    maxX = Math.max(maxX, tx)
    maxY = Math.max(maxY, ty)
  }

  return { minX, minY, maxX, maxY }
}

// Shout's "10-point starburst" (the doc counts outer points; each has a
// matching inward point between it and the next, for 20 vertices total —
// the same star panels' own Burst shape uses, see kapow/panel_shapes.js's
// burstPoints, though duplicated rather than imported for the same
// Propshaft cross-module-import reason as generateId above).
const SHOUT_STAR_POINTS = 10
const SHOUT_STAR_INNER_RATIO = 0.5

// The star's own vertex list, inscribed in the box — or, when there's a
// tail, with its one bottommost point (see the angle math below: at
// i = SHOUT_STAR_POINTS the angle is exactly straight down) stretched out
// to the tail tip instead. That turns one of the star's own natural spikes
// into the tail, rather than bolting on a separate triangle — the same
// seamless-shape convention speechBubblePath follows, achieved here for
// free since the star already comes to a point.
export function shoutStarPoints(text) {
  const cx = text.x + text.w / 2
  const cy = text.y + text.h / 2
  const outerRx = text.w / 2
  const outerRy = text.h / 2
  const count = SHOUT_STAR_POINTS * 2

  const points = Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI * i) / SHOUT_STAR_POINTS - Math.PI / 2
    const ratio = i % 2 === 0 ? 1 : SHOUT_STAR_INNER_RATIO
    return [ cx + outerRx * ratio * Math.cos(angle), cy + outerRy * ratio * Math.sin(angle) ]
  })

  if (text.tail) points[SHOUT_STAR_POINTS] = text.tail

  return points
}

// An SVG path `d` string for the star (see shoutStarPoints) as one closed
// polygon.
export function shoutStarPath(text) {
  const [ first, ...rest ] = shoutStarPoints(text)
  return [ `M ${first[0]} ${first[1]}`, ...rest.map(([ x, y ]) => `L ${x} ${y}`), "Z" ].join(" ")
}

// SFX's own default rotation and color (the doc: "Loud, red #e0452d, −8°
// rotation") — no other kind has a non-zero default rotation or sets
// color at all, so these constants exist only for SFX's own KIND_DEFAULTS
// entry below.
export const SFX_DEFAULT_ROTATION_DEG = -8
export const SFX_DEFAULT_COLOR = "#e0452d"

// SFX's 7-swatch color row — the same 7 hues as Draw mode's own ink
// palette (kapow/ink.js's INK_COLORS / EditorHelper::INK_COLORS), reused
// here for visual consistency across the app rather than introducing a
// second palette. Duplicated, not imported, for the same reason
// generateId is inlined below (a relative kapow/-to-kapow/ import 404s
// under Propshaft's fingerprinted URLs).
export const SFX_COLORS = [
  "#1c1a17",
  "#e0452d",
  "#ffd43a",
  "#f2994a",
  "#2f6fed",
  "#2f9e52",
  "#8b5cf6"
]

// Per-kind rendering defaults (see the doc's Letter-mode table): font
// choice, weight/style, and a starting box size roomy enough for a short
// line at the default font size. `rot`/`color` are omitted (defaultText
// falls back to 0/null below) for every kind but SFX.
const KIND_DEFAULTS = {
  speech: { font: "comic", bold: true, italic: false, w: 200, h: 120 },
  caption: { font: "comic", bold: true, italic: false, w: 220, h: 70 },
  narration: { font: "comic", bold: true, italic: true, w: 220, h: 70 },
  shout: { font: "loud", bold: false, italic: false, w: 180, h: 140 },
  sfx: {
    font: "loud",
    bold: false,
    italic: false,
    w: 160,
    h: 80,
    rot: SFX_DEFAULT_ROTATION_DEG,
    color: SFX_DEFAULT_COLOR
  }
}

const DEFAULT_FONT_SIZE = 22

// Duplicated from kapow/panel_shapes.js's own generateId rather than
// imported from it: a relative import between two kapow/ modules resolves
// against the *other* module's un-fingerprinted filename (e.g.
// "./panel_shapes.js"), which 404s in the browser — Propshaft only serves
// the digest-suffixed URL the importmap actually points "kapow/
// panel_shapes" at. The bare specifier form controllers use ("kapow/
// panel_shapes") resolves fine in the browser but isn't understood by
// plain Node (this module's own unit tests run under `node --test`, with
// no importmap). Inlining this one trivial line sidesteps needing either.
function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// A freshly dropped text element of the given kind, centered on (x, y).
// Speech/Shout's tail starts as a fixed point straight below the box — a
// sensible-looking default until the user drags its handle elsewhere (see
// text_controller.js#startTailDrag).
export function defaultText(kind, x, y) {
  const { font, bold, italic, w, h, rot = 0, color = null } = KIND_DEFAULTS[kind]

  return {
    id: generateId(),
    kind,
    x: x - w / 2,
    y: y - h / 2,
    w,
    h,
    fs: DEFAULT_FONT_SIZE,
    rot,
    text: "",
    tail: kind === "speech" || kind === "shout" ? [ x, y + h / 2 + 30 ] : null,
    font,
    bold,
    italic,
    color
  }
}

// The doc's 4 lettering font choices (Comic/Loud/Print/Serif), mapped onto
// the fonts actually vendored in this app (see app/assets/stylesheets/
// fonts.css) — "Print" and "Serif" are system fonts (Nunito's already
// vendored for UI chrome; Georgia needs no vendoring at all).
export const FONT_STACKS = {
  comic: '"Comic Neue", cursive',
  loud: '"Bangers", cursive',
  print: '"Nunito", sans-serif',
  serif: 'Georgia, serif'
}

export function fontFamilyCss(font) {
  return FONT_STACKS[font] ?? FONT_STACKS.comic
}
