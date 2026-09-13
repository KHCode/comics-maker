// Letter mode's text elements — pure geometry/schema logic mirroring
// kapow/photo.js's style. See the doc's schema: text:{id,kind,x,y,w,h,fs,
// rot,text,tail:[x,y]|null,font?,bold?,italic?,color?}. No DOM dependency;
// see text_controller.js for the HTML-overlay rendering and the
// pointer-driven move/resize/edit gestures.
//
// This PR covers only the three "box-shaped" kinds (Speech/Caption/
// Narration) per the plan's own phase split — Shout/SFX/Think are a later
// PR. `color` is stored (matching the full schema) but always its neutral
// default here — SFX is the only kind that ever sets it (a later PR), same
// pattern as photo.js's bright/contrast/hue/sat fields before the Adjust
// tab existed.

export const TEXT_KINDS = [ "speech", "caption", "narration" ]

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

// The pointed tail's triangle (Speech only, for now — Think/Shout are a
// later PR): a fixed-width notch on the box's own bottom edge as its base,
// aimed at wherever the draggable tail dot (text.tail) currently is. The
// base stays anchored to the box rather than also following an arbitrary
// drag target, keeping the tail visually attached to the bubble it
// belongs to regardless of how far its tip has been dragged.
const TAIL_BASE_HALF_WIDTH = 16

export function tailTriangle(text) {
  if (!text.tail) return null

  const baseY = text.y + text.h
  const baseCenterX = text.x + text.w / 2
  const [ tx, ty ] = text.tail

  return [
    [ baseCenterX - TAIL_BASE_HALF_WIDTH, baseY ],
    [ baseCenterX + TAIL_BASE_HALF_WIDTH, baseY ],
    [ tx, ty ]
  ]
}

// Per-kind rendering defaults (see the doc's Letter-mode table): font
// choice, weight/style, and a starting box size roomy enough for a short
// line at the default font size.
const KIND_DEFAULTS = {
  speech: { font: "comic", bold: true, italic: false, w: 200, h: 120 },
  caption: { font: "comic", bold: true, italic: false, w: 220, h: 70 },
  narration: { font: "comic", bold: true, italic: true, w: 220, h: 70 }
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
// Speech's tail starts as a fixed point straight below the box — a
// sensible-looking default until the user drags its handle elsewhere (see
// text_controller.js#startTailDrag).
export function defaultText(kind, x, y) {
  const { font, bold, italic, w, h } = KIND_DEFAULTS[kind]

  return {
    id: generateId(),
    kind,
    x: x - w / 2,
    y: y - h / 2,
    w,
    h,
    fs: DEFAULT_FONT_SIZE,
    rot: 0,
    text: "",
    tail: kind === "speech" ? [ x, y + h / 2 + 30 ] : null,
    font,
    bold,
    italic,
    color: null
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
