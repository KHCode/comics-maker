import { Controller } from "@hotwired/stimulus"
import { newPanel } from "kapow/panel_shapes"
import { generatePreset, GUTTER } from "kapow/panel_layouts"
import { boundingBox, translatePoints } from "kapow/panel_geometry"
import { INK_COLORS } from "kapow/ink"
import { defaultText } from "kapow/text"

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
  static targets = [
    "tab", "tray", "emptyHint", "page",
    "drawTool", "drawColor", "drawSize",
    "drawLayerTab", "drawLayerPanel",
    "photoFileInput", "cameraFileInput", "photoInsert", "photoFit",
    "photoScale", "photoRotate", "photoFlip", "photoCover",
    "photoSubTab", "photoSubPanel",
    "photoBright", "photoContrast", "photoHue", "photoSat", "photoLook"
  ]
  static values = {
    format: String,
    pageUnitHeight: Number,
    mode: String,
    drawTool: { type: String, default: "pen" },
    drawColor: { type: String, default: INK_COLORS[0] },
    drawSize: { type: String, default: "m" },
    drawLayer: { type: String, default: "ink" },
    photoSubTab: { type: String, default: "fit" }
  }

  connect() {
    this.activePageElement = null
    this.markActivePage(this.newestPageElement)
    this.updateDrawToolUI()
    this.updateDrawColorUI()
    this.updateDrawSizeUI()
    this.updateDrawLayerUI()
    this.updatePhotoSubTabUI()
    this.syncPhotoControls()
  }

  switchMode(event) {
    const mode = event.currentTarget.dataset.mode
    this.modeValue = mode

    this.tabTargets.forEach((tab) => {
      tab.classList.toggle("mode-tab--active", tab.dataset.mode === mode)
    })

    this.trayTargets.forEach((tray) => {
      tray.hidden = tray.dataset.mode !== mode
    })

    // Layout's selection UI, Draw's zoomed-in focus, and Letter's own
    // text selection are all mode-specific — leaving a mode resets it,
    // rather than letting it linger and resurface (still selected/still
    // zoomed) if the user tabs back.
    this.pageTargets.forEach((pageEl) => {
      const panelController = this.panelControllerFor(pageEl)
      panelController?.deselect()
      panelController?.exitFocus()
      this.textControllerFor(pageEl)?.deselect()
    })
  }

  // Draw tray's tool/color/size buttons — panel_controller.js reads these
  // straight off this element's own data attributes (see its
  // currentDrawTool/currentDrawColor/currentDrawSize getters) rather than
  // through an event, the same pattern currentMode already uses, since the
  // setting applies to whichever panel gets drawn on next rather than to
  // any one page.
  selectDrawTool(event) {
    this.drawToolValue = event.currentTarget.dataset.tool
    this.updateDrawToolUI()
  }

  selectDrawColor(event) {
    this.drawColorValue = event.currentTarget.dataset.color
    this.updateDrawColorUI()
  }

  selectDrawSize(event) {
    this.drawSizeValue = event.currentTarget.dataset.size
    this.updateDrawSizeUI()
  }

  updateDrawToolUI() {
    this.drawToolTargets.forEach((button) => {
      button.classList.toggle("ink-tool--active", button.dataset.tool === this.drawToolValue)
    })
  }

  updateDrawColorUI() {
    this.drawColorTargets.forEach((button) => {
      button.classList.toggle("ink-color--active", button.dataset.color === this.drawColorValue)
    })
  }

  updateDrawSizeUI() {
    this.drawSizeTargets.forEach((button) => {
      button.classList.toggle("ink-size--active", button.dataset.size === this.drawSizeValue)
    })
  }

  // Draw mode's Ink/Photo sub-tabs — which of the two tool panels the tray
  // shows underneath the mode tabs. panel_controller.js reads the current
  // value the same way it reads currentDrawTool/Color/Size.
  selectDrawLayer(event) {
    this.drawLayerValue = event.currentTarget.dataset.layer
    this.updateDrawLayerUI()
  }

  updateDrawLayerUI() {
    this.drawLayerTabTargets.forEach((tab) => {
      tab.classList.toggle("draw-layer-tab--active", tab.dataset.layer === this.drawLayerValue)
    })
    this.drawLayerPanelTargets.forEach((panel) => {
      panel.hidden = panel.dataset.layer !== this.drawLayerValue
    })
  }

  // Photo insert buttons just proxy to their own (hidden) file input —
  // "Camera" is the same upload pipeline as "Photos", just a second input
  // with a `capture` attribute so mobile browsers offer the camera instead
  // of a file browser (inert on desktop, where this test suite runs).
  choosePhoto() {
    this.photoFileInputTarget.click()
  }

  capturePhoto() {
    this.cameraFileInputTarget.click()
  }

  uploadPhoto(event) {
    const file = event.target.files[0]
    event.target.value = "" // allow choosing the same file again later
    if (!file) return

    this.focusedPanelController?.insertPhotoFile(file)
  }

  updatePhotoScale(event) {
    this.focusedPanelController?.setPhotoScale(Number(event.target.value))
  }

  updatePhotoRotate(event) {
    this.focusedPanelController?.setPhotoRotate(Number(event.target.value))
  }

  flipPhoto() {
    this.focusedPanelController?.flipPhoto()
  }

  togglePhotoCover() {
    this.focusedPanelController?.togglePhotoCover()
  }

  removePhoto() {
    this.focusedPanelController?.removePhoto()
  }

  // Fit/Adjust sub-tabs within the Photo layer — which of the two control
  // panels shows underneath the Insert/Fit-or-Adjust split, same
  // tab/panel-toggle pattern as selectDrawLayer/updateDrawLayerUI above.
  selectPhotoSubTab(event) {
    this.photoSubTabValue = event.currentTarget.dataset.subtab
    this.updatePhotoSubTabUI()
  }

  updatePhotoSubTabUI() {
    this.photoSubTabTargets.forEach((tab) => {
      tab.classList.toggle("draw-layer-tab--active", tab.dataset.subtab === this.photoSubTabValue)
    })
    this.photoSubPanelTargets.forEach((panel) => {
      panel.hidden = panel.dataset.subtab !== this.photoSubTabValue
    })
  }

  updatePhotoBright(event) {
    this.focusedPanelController?.setPhotoBright(Number(event.target.value))
  }

  updatePhotoContrast(event) {
    this.focusedPanelController?.setPhotoContrast(Number(event.target.value))
  }

  updatePhotoHue(event) {
    this.focusedPanelController?.setPhotoHue(Number(event.target.value))
  }

  updatePhotoSat(event) {
    this.focusedPanelController?.setPhotoSat(Number(event.target.value))
  }

  selectPhotoLook(event) {
    this.focusedPanelController?.setPhotoLook(event.currentTarget.dataset.look)
  }

  // Keeps the Fit/Adjust tabs' sliders/toggles reflecting whichever panel
  // is actually focused (rather than whatever the last-focused panel's
  // photo happened to be set to) — called whenever focus changes and after
  // any document mutation, since panning/inserting/removing/adjusting a
  // photo all need the same resync.
  syncPhotoControls() {
    const photo = this.focusedPanelController?.focusedPanelPhoto ?? null

    if (this.hasPhotoInsertTarget) this.photoInsertTarget.hidden = !!photo
    if (this.hasPhotoFitTarget) this.photoFitTarget.hidden = !photo
    if (this.hasPhotoScaleTarget) this.photoScaleTarget.value = photo?.pct ?? 100
    if (this.hasPhotoRotateTarget) this.photoRotateTarget.value = photo?.rot ?? 0
    if (this.hasPhotoFlipTarget) this.photoFlipTarget.classList.toggle("ink-tool--active", !!photo?.flip)
    if (this.hasPhotoCoverTarget) this.photoCoverTarget.classList.toggle("ink-tool--active", !!photo?.cover)
    if (this.hasPhotoBrightTarget) this.photoBrightTarget.value = photo?.bright ?? 0
    if (this.hasPhotoContrastTarget) this.photoContrastTarget.value = photo?.contrast ?? 0
    if (this.hasPhotoHueTarget) this.photoHueTarget.value = photo?.hue ?? 0
    if (this.hasPhotoSatTarget) this.photoSatTarget.value = photo?.sat ?? 0
    this.photoLookTargets.forEach((button) => {
      button.classList.toggle("ink-tool--active", button.dataset.look === (photo?.look ?? "none"))
    })
  }

  get focusedPanelController() {
    return this.pageTargets.map((pageEl) => this.panelControllerFor(pageEl)).find((pc) => pc?.focusedPanelId)
  }

  // Draw tray's "Whole page" button and the header's ✕ (see
  // updateFocusIndicator) — panel_controller reads the current mode
  // straight off this element's data-editor-mode-value attribute (see
  // panel_controller.js#currentMode), so exiting focus doesn't need its
  // own mode check here.
  exitFocus() {
    this.pageTargets.forEach((pageEl) => this.panelControllerFor(pageEl)?.exitFocus())
  }

  // Shows/hides the header's ✕ exit button (see panel_controller.js's
  // "focused"/"unfocused" dispatches) — re-derived from actual state
  // rather than a simple counter, so it stays correct even in the
  // (currently unreachable in the UI, but not actually prevented)
  // edge case of more than one page being focused at once.
  updateFocusIndicator() {
    const anyFocused = this.pageTargets.some((pageEl) => this.panelControllerFor(pageEl)?.focusedPanelId)
    this.element.classList.toggle("editor--focused", anyFocused)
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

  // Letter tray's "Add" buttons — same center-of-page, cycled-offset drop
  // point as addPanel above (so several adds in a row don't stack exactly
  // on top of each other), just targeting state.texts instead of
  // state.panels.
  addText(event) {
    const pageEl = this.targetPageElement
    if (!pageEl) return

    const documentStore = this.documentStoreControllerFor(pageEl)
    const { width, height } = this.pageDimensions(pageEl)

    const existingCount = documentStore.store.getState().texts.length
    const offset = (existingCount % ADD_PANEL_OFFSET_CYCLE) * ADD_PANEL_OFFSET_STEP

    documentStore.store.mutate((state) => {
      state.texts.push(defaultText(event.params.kind, width / 2 + offset, height / 2 + offset))
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

  panelControllerFor(pageEl) {
    return this.application.getControllerForElementAndIdentifier(pageEl, "panel")
  }

  textControllerFor(pageEl) {
    return this.application.getControllerForElementAndIdentifier(pageEl, "text")
  }

  pageDimensions(pageEl) {
    const svg = pageEl.querySelector("svg.page-canvas")
    return { width: svg.viewBox.baseVal.width, height: svg.viewBox.baseVal.height }
  }

  get pageWidth() {
    return this.pageDimensions(this.targetPageElement).width
  }
}
