import { Controller } from "@hotwired/stimulus"
import { newPanel } from "kapow/panel_shapes"
import { generatePreset, GUTTER } from "kapow/panel_layouts"
import { boundingBox, translatePoints } from "kapow/panel_geometry"

// New single-panel adds are dropped near page center, offset a bit further
// each time so several adds in a row don't stack exactly on top of each
// other. Cycles rather than drifting off-page indefinitely.
const ADD_PANEL_OFFSET_STEP = 30
const ADD_PANEL_OFFSET_CYCLE = 5

// Editor shell: mode-tab switching, plus the Layout tray's "add panel" and
// "apply preset" buttons. For paginated formats (comic/manga/newspaper),
// panels target whichever page was last clicked (see selectPage) — the
// newest page by default, matching the doc ("New panels drop near page
// center of the newest page" / "Applying a preset replaces panels on the
// newest page only"). Webtoon has only one (growing) page, so there's
// nothing to select — but a preset there can't "replace panels on the
// page" the way paginated formats do, since the page is one continuous,
// ever-growing canvas: see applyWebtoonPreset.
export default class extends Controller {
  static targets = ["tab", "tray", "emptyHint", "page"]
  static values = { format: String, pageUnitHeight: Number }

  connect() {
    this.activePageElement = null
    this.markActivePage(this.newestPageElement)
  }

  switchMode(event) {
    const mode = event.currentTarget.dataset.mode

    this.tabTargets.forEach((tab) => {
      tab.classList.toggle("mode-tab--active", tab.dataset.mode === mode)
    })

    this.trayTargets.forEach((tray) => {
      tray.hidden = tray.dataset.mode !== mode
    })
  }

  selectPage(event) {
    this.markActivePage(event.currentTarget)
  }

  markActivePage(pageEl) {
    this.activePageElement = pageEl
    this.pageTargets.forEach((el) => el.classList.toggle("page--active", el === pageEl))
  }

  addPanel(event) {
    const pageEl = this.targetPageElement
    if (!pageEl) return

    const documentStore = this.documentStoreControllerFor(pageEl)
    const { width, height } = this.pageDimensions(pageEl)

    const size = Math.min(width, height) * 0.35
    const existingCount = documentStore.store.getState().panels.length
    const offset = (existingCount % ADD_PANEL_OFFSET_CYCLE) * ADD_PANEL_OFFSET_STEP
    const x = (width - size) / 2 + offset
    const y = (height - size) / 2 + offset

    documentStore.store.mutate((state) => {
      state.panels.push(newPanel(event.params.shape, x, y, size, size))
    })

    this.hideEmptyHint()
  }

  applyPreset(event) {
    const pageEl = this.targetPageElement
    if (!pageEl) return

    const documentStore = this.documentStoreControllerFor(pageEl)

    if (this.formatValue === "webtoon") {
      this.applyWebtoonPreset(documentStore, event.params.preset)
    } else {
      const { width, height } = this.pageDimensions(pageEl)
      const panels = generatePreset(this.formatValue, event.params.preset, width, height, newPanel)
      documentStore.store.mutate((state) => {
        state.panels = panels
      })
    }

    this.hideEmptyHint()
  }

  // Webtoon's page has no fixed height — it grows in whole units (see
  // Page#height) and never gets page seams. Presets are authored per
  // single unit (pageUnitHeightValue), so applying one always fits that
  // one unit rather than stretching to however tall the page currently is
  // (which would balloon a preset across any extra length the user had
  // already grown). And since the page is one continuous document rather
  // than a series of independent pages, applying a preset appends a new
  // section after the existing content instead of replacing it — growing
  // the page destroys nothing that was already there.
  applyWebtoonPreset(documentStore, presetName) {
    const existingPanels = documentStore.store.getState().panels
    const startY = existingPanels.length
      ? Math.max(...existingPanels.map((panel) => boundingBox(panel.pts).maxY)) + GUTTER
      : 0

    const panels = generatePreset(this.formatValue, presetName, this.pageWidth, this.pageUnitHeightValue, newPanel)
    const offsetPanels = panels.map((panel) => ({ ...panel, pts: translatePoints(panel.pts, 0, startY) }))

    documentStore.store.mutate((state) => {
      state.panels = [ ...state.panels, ...offsetPanels ]
    })
  }

  hideEmptyHint() {
    if (this.hasEmptyHintTarget) this.emptyHintTarget.hidden = true
  }

  get targetPageElement() {
    return this.activePageElement || this.newestPageElement
  }

  get newestPageElement() {
    const pages = this.element.querySelectorAll('[data-controller~="document-store"]')
    return pages.length ? pages[pages.length - 1] : null
  }

  documentStoreControllerFor(pageEl) {
    return this.application.getControllerForElementAndIdentifier(pageEl, "document-store")
  }

  pageDimensions(pageEl) {
    const svg = pageEl.querySelector("svg.page-canvas")
    return { width: svg.viewBox.baseVal.width, height: svg.viewBox.baseVal.height }
  }

  get pageWidth() {
    return this.pageDimensions(this.targetPageElement).width
  }
}
