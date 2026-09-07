import { Controller } from "@hotwired/stimulus"
import { newPanel } from "kapow/panel_shapes"
import { generatePreset } from "kapow/panel_layouts"

// New single-panel adds are dropped near page center, offset a bit further
// each time so several adds in a row don't stack exactly on top of each
// other. Cycles rather than drifting off-page indefinitely.
const ADD_PANEL_OFFSET_STEP = 30
const ADD_PANEL_OFFSET_CYCLE = 5

// Editor shell: mode-tab switching, plus the Layout tray's "add panel" and
// "apply preset" buttons. Panels always target the newest page — matching
// the doc ("New panels drop near page center of the newest page" /
// "Applying a preset replaces panels on the newest page only"), regardless
// of which page is currently scrolled into view.
export default class extends Controller {
  static targets = ["tab", "tray", "emptyHint"]
  static values = { format: String }

  switchMode(event) {
    const mode = event.currentTarget.dataset.mode

    this.tabTargets.forEach((tab) => {
      tab.classList.toggle("mode-tab--active", tab.dataset.mode === mode)
    })

    this.trayTargets.forEach((tray) => {
      tray.hidden = tray.dataset.mode !== mode
    })
  }

  addPanel(event) {
    const pageEl = this.newestPageElement
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
    const pageEl = this.newestPageElement
    if (!pageEl) return

    const documentStore = this.documentStoreControllerFor(pageEl)
    const { width, height } = this.pageDimensions(pageEl)
    const panels = generatePreset(this.formatValue, event.params.preset, width, height, newPanel)

    documentStore.store.mutate((state) => {
      state.panels = panels
    })

    this.hideEmptyHint()
  }

  hideEmptyHint() {
    if (this.hasEmptyHintTarget) this.emptyHintTarget.hidden = true
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
}
