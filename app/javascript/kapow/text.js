// Letter mode's text elements — pure geometry/schema logic mirroring
// kapow/photo.js's style. See the doc's schema: text:{id,kind,x,y,w,h,fs,
// rot,text,tail:[x,y]|null,font?,bold?,italic?,color?}. No DOM dependency;
// see text_controller.js for the HTML-overlay rendering and the
// pointer-driven move/resize/edit gestures.
//
// This PR covers only the three "box-shaped" kinds (Speech/Caption/
// Narration) per the plan's own phase split — Shout/SFX/Think are a later
// PR. `rot`/`color` are stored (matching the full schema) but always their
// neutral default here — there's no UI to change them until the Letter
// floating bar lands in a later PR, same pattern as photo.js's
// bright/contrast/hue/sat fields before the Adjust tab existed.

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
// Speech's tail is a fixed point straight below the box — dragging it
// elsewhere is the doc's "Letter floating bar + tail dragging" PR; until
// then this just gives Speech bubbles a sensible-looking default.
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
