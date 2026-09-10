// Pure geometry: generates a full set of panels for a named preset,
// fitted to a page's dimensions. Presets replace all panels on the
// newest page (see editor_controller.js); the tray's "add panel" buttons
// generate a single panel instead (see panel_shapes.js's newPanel).
//
// Every function takes `makePanel` (matching panel_shapes.js's newPanel
// signature: (kind, x, y, width, height) -> panel) as an explicit argument
// rather than importing it directly. Propshaft doesn't rewrite plain
// relative JS imports between separately-fingerprinted assets (it only
// rewrites its own RAILS_ASSET_URL(...) macro) — so a bare `import ...
// from "./panel_shapes.js"` here would 404 in the browser. Dependency
// injection sidesteps that entirely, and keeps this file just as
// Node-testable.

export const GUTTER = 20

// An evenly-spaced grid of `rows` × `cols` box panels.
export function gridPreset(pageWidth, pageHeight, rows, cols, makePanel, gutter = GUTTER) {
  const cellWidth = (pageWidth - gutter * (cols + 1)) / cols
  const cellHeight = (pageHeight - gutter * (rows + 1)) / rows
  const panels = []

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = gutter + col * (cellWidth + gutter)
      const y = gutter + row * (cellHeight + gutter)
      panels.push(makePanel("box", x, y, cellWidth, cellHeight))
    }
  }

  return panels
}

// Rows of Slant panels instead of boxes (Manga B5's "Action" preset).
export function actionPreset(pageWidth, pageHeight, makePanel, rows = 3, gutter = GUTTER) {
  const cellHeight = (pageHeight - gutter * (rows + 1)) / rows

  return Array.from({ length: rows }, (_, row) => {
    const y = gutter + row * (cellHeight + gutter)
    return makePanel("slant", gutter, y, pageWidth - gutter * 2, cellHeight)
  })
}

// One large panel across the top, `n` equal panels in a row below it.
export function bigPlusPreset(pageWidth, pageHeight, n, makePanel, gutter = GUTTER) {
  const bigHeight = pageHeight * 0.6 - gutter * 1.5
  const bigPanel = makePanel("box", gutter, gutter, pageWidth - gutter * 2, bigHeight)

  const smallY = gutter * 2 + bigHeight
  const smallHeight = pageHeight - smallY - gutter
  const smallWidth = (pageWidth - gutter * (n + 1)) / n
  const smallPanels = Array.from({ length: n }, (_, i) => {
    const x = gutter + i * (smallWidth + gutter)
    return makePanel("box", x, smallY, smallWidth, smallHeight)
  })

  return [ bigPanel, ...smallPanels ]
}

// One tall panel on the left spanning the full height, `n` equal panels
// stacked on the right (Webtoon's "Tall + n").
export function tallPlusPreset(pageWidth, pageHeight, n, makePanel, gutter = GUTTER) {
  const tallWidth = pageWidth * 0.6 - gutter * 1.5
  const tallPanel = makePanel("box", gutter, gutter, tallWidth, pageHeight - gutter * 2)

  const smallX = gutter * 2 + tallWidth
  const smallWidth = pageWidth - smallX - gutter
  const smallHeight = (pageHeight - gutter * (n + 1)) / n
  const smallPanels = Array.from({ length: n }, (_, i) => {
    const y = gutter + i * (smallHeight + gutter)
    return makePanel("box", smallX, y, smallWidth, smallHeight)
  })

  return [ tallPanel, ...smallPanels ]
}

// Preset name -> generator, one registry per format. Names match the doc's
// page-format table verbatim.
export const PRESETS_BY_FORMAT = {
  comic: {
    "3 Rows": (w, h, makePanel) => gridPreset(w, h, 3, 1, makePanel),
    "2×2": (w, h, makePanel) => gridPreset(w, h, 2, 2, makePanel),
    "2×3": (w, h, makePanel) => gridPreset(w, h, 2, 3, makePanel),
    "Big + 2": (w, h, makePanel) => bigPlusPreset(w, h, 2, makePanel)
  },
  manga_b5: {
    "4-koma": (w, h, makePanel) => gridPreset(w, h, 4, 1, makePanel),
    "2×2": (w, h, makePanel) => gridPreset(w, h, 2, 2, makePanel),
    Action: (w, h, makePanel) => actionPreset(w, h, makePanel, 3),
    "Big + 2": (w, h, makePanel) => bigPlusPreset(w, h, 2, makePanel)
  },
  newspaper_strip: {
    "3 across": (w, h, makePanel) => gridPreset(w, h, 1, 3, makePanel),
    "4 across": (w, h, makePanel) => gridPreset(w, h, 1, 4, makePanel),
    "Big + 1": (w, h, makePanel) => bigPlusPreset(w, h, 1, makePanel)
  },
  webtoon: {
    "3 stacked": (w, h, makePanel) => gridPreset(w, h, 3, 1, makePanel),
    "5 stacked": (w, h, makePanel) => gridPreset(w, h, 5, 1, makePanel),
    "Tall + 2": (w, h, makePanel) => tallPlusPreset(w, h, 2, makePanel)
  }
}

export function generatePreset(format, presetName, pageWidth, pageHeight, makePanel) {
  const generator = PRESETS_BY_FORMAT[format]?.[presetName]
  if (!generator) throw new Error(`Unknown preset "${presetName}" for format "${format}"`)
  return generator(pageWidth, pageHeight, makePanel)
}
