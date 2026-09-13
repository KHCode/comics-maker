import { Controller } from "@hotwired/stimulus"
import { newPanel } from "kapow/panel_shapes"
import { generatePreset, GUTTER } from "kapow/panel_layouts"
import { boundingBox, translatePoints } from "kapow/panel_geometry"
import { INK_COLORS } from "kapow/ink"
import { defaultText } from "kapow/text"
import { exportFilename, exportPdfFilename } from "kapow/export"
import { buildPdfBytes } from "kapow/pdf"

const SVG_NS = "http://www.w3.org/2000/svg"
const EXPORT_MIME = "image/png"
// The PDF export path rasterizes each page as JPEG instead (see
// renderPageToBlob/exportPdf) so its bytes can be embedded directly via
// /DCTDecode — see kapow/pdf.js's own header comment for why.
const EXPORT_PDF_PAGE_MIME = "image/jpeg"
const EXPORT_PDF_PAGE_QUALITY = 0.92

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

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
    "photoBright", "photoContrast", "photoHue", "photoSat", "photoLook",
    "hideTextsButton", "textLayerButton",
    "undoButton", "redoButton",
    "exportButton", "exportPdfButton"
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
    // Undo/redo (see undo/redo below) act on whichever page's store was
    // most recently mutated, not merely the most recently clicked one
    // (see targetPageElement/activePageElement above) — those can differ,
    // e.g. after editing page 2 and then just tapping over to page 1
    // without changing anything there.
    this.lastMutatedPageElement = null
    this.textsHidden = false
    this.markActivePage(this.newestPageElement)
    this.updateDrawToolUI()
    this.updateDrawColorUI()
    this.updateDrawSizeUI()
    this.updateDrawLayerUI()
    this.updatePhotoSubTabUI()
    this.syncPhotoControls()
    this.syncTextLayerButton()
    this.syncUndoRedoButtons()
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

    // "Hide text" (see toggleTextsVisibility) only persists until the
    // user explicitly toggles it back on *or* switches modes — whichever
    // comes first — so any mode switch resets it back to visible.
    if (this.textsHidden) this.toggleTextsVisibility()

    this.syncTextLayerButton()
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

  // Layout tray's "Hide text"/"Show text" toggle — lets the user see the
  // panel layout with no lettering in the way. Persists until either this
  // same button is pressed again, or the mode changes (see switchMode),
  // per the feedback this was built from.
  toggleTextsVisibility() {
    this.textsHidden = !this.textsHidden
    this.pageTargets.forEach((pageEl) => this.textControllerFor(pageEl)?.setForceHidden(this.textsHidden))

    if (this.hasHideTextsButtonTarget) {
      this.hideTextsButtonTarget.textContent = this.textsHidden ? "Show text" : "Hide text"
      this.hideTextsButtonTarget.classList.toggle("ink-tool--active", this.textsHidden)
    }
  }

  // Letter tray's layer button — bring-to-front/send-to-back for whichever
  // text is currently selected, living in the tool panel rather than a
  // per-text floating-bar button (same z-order model as panels; see
  // text_controller.js#toggleLayerPosition).
  toggleTextLayer() {
    this.selectedTextController?.toggleLayerPosition()
  }

  // Keeps the Letter tray's layer button reflecting whichever text (if
  // any) is currently selected, across pages — called on selection change
  // and after any document mutation (reordering can happen without a
  // selection change), same pattern as syncPhotoControls.
  syncTextLayerButton() {
    if (!this.hasTextLayerButtonTarget) return

    const controller = this.selectedTextController
    const hasSelection = !!controller?.selectedTextId
    this.textLayerButtonTarget.disabled = !hasSelection
    this.textLayerButtonTarget.textContent = hasSelection && controller.isSelectedTextFrontmost
      ? "⬇ Send to back"
      : "⬆ Bring to front"
  }

  get selectedTextController() {
    return this.pageTargets.map((pageEl) => this.textControllerFor(pageEl)).find((tc) => tc?.selectedTextId)
  }

  // Every page's document-store dispatches this on every mutation
  // (including undo()/redo() themselves — see kapow/document_store.js),
  // so this both tracks which page undo/redo should act on next and keeps
  // the header buttons' enabled state in sync as history grows/shrinks.
  handleDocumentChange(event) {
    this.lastMutatedPageElement = event.target
    this.syncUndoRedoButtons()
  }

  undo() {
    this.documentStoreControllerFor(this.undoRedoTargetPageElement)?.store.undo()
  }

  redo() {
    this.documentStoreControllerFor(this.undoRedoTargetPageElement)?.store.redo()
  }

  syncUndoRedoButtons() {
    const store = this.documentStoreControllerFor(this.undoRedoTargetPageElement)?.store
    if (this.hasUndoButtonTarget) this.undoButtonTarget.disabled = !store?.canUndo
    if (this.hasRedoButtonTarget) this.redoButtonTarget.disabled = !store?.canRedo
  }

  get undoRedoTargetPageElement() {
    return this.lastMutatedPageElement || this.targetPageElement
  }

  // Per-page PNG export (see the plan's Phase 9) — rasterizes whichever
  // page Add-panel/Undo/etc. would currently target. See exportPdf below
  // for the whole-project, every-page PDF export.
  exportPage() {
    const pageEl = this.targetPageElement
    if (!pageEl) return

    // A clean, non-editing snapshot — otherwise resize handles, tail
    // handles, floating bars, and dashed selection outlines would bake
    // into the exported image. Mirrors exactly what switchMode already
    // does when leaving a mode, just triggered by Export instead.
    this.panelControllerFor(pageEl)?.deselect()
    this.panelControllerFor(pageEl)?.exitFocus()
    this.textControllerFor(pageEl)?.deselect()

    if (this.hasExportButtonTarget) this.exportButtonTarget.disabled = true

    this.renderPageToBlob(pageEl)
      .then((blob) => this.downloadBlob(blob, exportFilename(this.projectNameText, this.pageNameText(pageEl))))
      .catch((error) => {
        console.error("Kapow: export failed", error)
        alert("Sorry, exporting this page failed. Please try again.")
      })
      .finally(() => {
        if (this.hasExportButtonTarget) this.exportButtonTarget.disabled = false
      })
  }

  // Whole-project PDF export (see the plan's Phase 9) — every page, in page
  // order, assembled into one PDF file. Reuses exportPage's own per-page
  // rasterization pipeline (buildExportSvgMarkup/inlinePhotoImages/
  // inlineCssFontUrls all apply just the same to each page in turn) rather
  // than duplicating it; only the final "one PNG download" step differs.
  exportPdf() {
    if (!this.pageTargets.length) return

    this.pageTargets.forEach((pageEl) => {
      this.panelControllerFor(pageEl)?.deselect()
      this.panelControllerFor(pageEl)?.exitFocus()
      this.textControllerFor(pageEl)?.deselect()
    })

    if (this.hasExportPdfButtonTarget) this.exportPdfButtonTarget.disabled = true

    Promise.all(this.pageTargets.map(async (pageEl) => {
      const { width, height } = this.pageDimensions(pageEl)
      const blob = await this.renderPageToBlob(pageEl, {
        mimeType: EXPORT_PDF_PAGE_MIME,
        quality: EXPORT_PDF_PAGE_QUALITY
      })
      const jpegBytes = new Uint8Array(await blob.arrayBuffer())
      return { jpegBytes, width, height }
    }))
      .then((pages) => {
        const pdfBytes = buildPdfBytes(pages)
        const blob = new Blob([ pdfBytes ], { type: "application/pdf" })
        this.downloadBlob(blob, exportPdfFilename(this.projectNameText))
      })
      .catch((error) => {
        console.error("Kapow: PDF export failed", error)
        alert("Sorry, exporting this comic failed. Please try again.")
      })
      .finally(() => {
        if (this.hasExportPdfButtonTarget) this.exportPdfButtonTarget.disabled = false
      })
  }

  get projectNameText() {
    return this.element.querySelector(".editor-project-name")?.textContent
  }

  pageNameText(pageEl) {
    return pageEl.querySelector(".page-label")?.textContent
  }

  // Builds a standalone SVG combining the page's own SVG content (panels/
  // ink/photos) with its HTML text overlay (Speech/Caption/etc. — kept as
  // HTML rather than SVG for the reasons text_controller.js documents)
  // via a <foreignObject>, so the whole page can be rasterized as one
  // flat image below. A <canvas> can't draw arbitrary HTML directly,
  // which is what makes this combining step necessary in the first place.
  //
  // This only has to render correctly once, statically — not
  // interactively — so foreignObject's known Safari contenteditable/caret
  // bugs (the reason the live editor avoids it) don't apply here.
  //
  // Async: each photo's own bytes get fetched and inlined as a data: URI
  // (see inlinePhotoImages) before this resolves, rather than leaving its
  // original URL in place for the browser to fetch later while
  // rasterizing — see inlinePhotoImages' own comment for why that
  // matters.
  async buildExportSvgMarkup(pageEl) {
    const svg = pageEl.querySelector("svg.page-canvas")
    const textLayer = pageEl.querySelector(".page-text-layer")
    const { width, height } = this.pageDimensions(pageEl)

    const exportSvg = svg.cloneNode(true)
    // .page-canvas's own border/border-radius/background (see editor.css)
    // are CSS box-model properties on the *live* <svg> element itself —
    // real UI chrome (showing where the page sits on the desk), not part
    // of the actual page content. A standalone rasterized SVG still
    // renders them around its own viewport the same way, so keeping this
    // class here baked that border (and its rounded corner) right into
    // the exported image, offsetting everything inward by its width —
    // confirmed by a user screenshot showing exactly that in one corner.
    exportSvg.removeAttribute("class")
    exportSvg.setAttribute("width", width)
    exportSvg.setAttribute("height", height)
    exportSvg.setAttribute("xmlns", SVG_NS)

    // Every same-origin stylesheet's actual rules, inlined — a standalone
    // serialized SVG doesn't automatically inherit the host page's <link>
    // stylesheets, so without this neither the panel outline/background
    // classes nor any of the text boxes' kind-specific styling (fonts,
    // colors, the speech/shout/think shapes' fill/stroke, SFX's
    // ink-outline text...) would render.
    const style = document.createElementNS(SVG_NS, "style")
    style.textContent = await this.inlineCssFontUrls(this.collectStylesheetText())
    exportSvg.insertBefore(style, exportSvg.firstChild)

    await this.inlinePhotoImages(exportSvg)

    const textClone = textLayer.cloneNode(true)
    // The live layer's own transform maps page units into the SVG's
    // actual on-screen CSS pixel size (see text_controller.js#
    // updateTransform) — inside this foreignObject, already sized in the
    // same page-unit coordinate space as the rest of the SVG, that
    // transform would double-apply and throw every text box's position
    // off. Its children's own inline left/top/width/height are already
    // in plain page units, needing no transform of their own here.
    textClone.style.transform = "none"
    textClone.hidden = false // Layout mode's "Hide text" may have this hidden

    const foreignObject = document.createElementNS(SVG_NS, "foreignObject")
    foreignObject.setAttribute("x", "0")
    foreignObject.setAttribute("y", "0")
    foreignObject.setAttribute("width", String(width))
    foreignObject.setAttribute("height", String(height))
    foreignObject.appendChild(textClone)
    exportSvg.appendChild(foreignObject)

    return new XMLSerializer().serializeToString(exportSvg)
  }

  // Fetches each photo <image>'s own bytes and replaces its href with a
  // data: URI holding them, rather than leaving the original blob-
  // redirect URL in place for the browser to fetch once rasterization
  // starts. That turned out to be necessary, not just tidy: the outer
  // SVG's own "loaded" event (see renderPageToBlob) fires once the SVG
  // document itself is parsed, with no guarantee every nested <image>'s
  // own separate network fetch has *also* finished by then — in testing,
  // photos were silently missing from the exported PNG even though the
  // same URL loaded instantly on its own, a classic race rather than a
  // permissions problem. Inlining the bytes upfront means there's no
  // further fetch left for that race to lose.
  //
  // This fetch is itself the thing that actually needs CORS (a plain
  // <img crossorigin> attribute doesn't help once the image is inlined
  // as a data: URI) — see the plan's own note that this needs S3's
  // bucket to be CORS-enabled (PR15) once photos live there in
  // production; same-origin dev/test photos need no such thing.
  async inlinePhotoImages(exportSvg) {
    const images = Array.from(exportSvg.querySelectorAll("image"))

    await Promise.all(images.map(async (image) => {
      const href = image.getAttribute("href")
      if (!href) return

      const absoluteHref = new URL(href, window.location.href).href

      try {
        const response = await fetch(absoluteHref, { mode: "cors" })
        if (!response.ok) throw new Error(`photo fetch failed with status ${response.status}`)
        const blob = await response.blob()
        image.setAttribute("href", await blobToDataUrl(blob))
      } catch (error) {
        console.error("Kapow: failed to inline a photo for export, leaving it as a plain (best-effort) URL", error)
        // Falls back to the plain absolute URL — imperfect (still subject
        // to the race/CORS issues above), but better than aborting the
        // whole export over one photo.
        image.setAttribute("href", absoluteHref)
        image.setAttribute("crossorigin", "anonymous")
      }
    }))
  }

  collectStylesheetText() {
    const cssText = Array.from(document.styleSheets)
      .map((sheet) => {
        try {
          return Array.from(sheet.cssRules).map((rule) => rule.cssText).join("\n")
        } catch {
          // Only reachable for a cross-origin stylesheet, which this app
          // doesn't have (fonts are self-hosted, not a Google Fonts
          // <link> — see the plan's Phase 1 branding PR).
          return ""
        }
      })
      .join("\n")

    // The vendored fonts' own @font-face rules point at root-relative
    // URLs (e.g. url("/assets/bangers-regular-<digest>.woff2")) — like
    // photoUrl()'s href (see inlinePhotoImages), these can't resolve once
    // this whole stylesheet is embedded in an SVG loaded from a data:
    // URI, which has no meaningful base URL of its own. Without this,
    // Comic Neue/Bangers/etc. silently fail to load and every text box
    // falls back to a generic font instead.
    return cssText.replace(/url\((['"]?)([^'")]+)\1\)/g, (match, quote, url) => {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) return match // already absolute
      return `url(${quote}${new URL(url, window.location.href).href}${quote})`
    })
  }

  // Replaces every http(s) url(...) reference in the collected stylesheet
  // text (in practice, just the vendored fonts' own @font-face src) with
  // a data: URI holding the actual font bytes — the same "inline it,
  // don't leave it as a URL for the browser to fetch later" fix as
  // inlinePhotoImages, and for the same underlying reason: the outer
  // SVG's own load event doesn't wait for @font-face resources referenced
  // from an embedded <style> to actually finish downloading, so without
  // this every text box in the exported image silently rendered in a
  // fallback font instead of Comic Neue/Bangers/etc — confirmed by
  // rendering an actual export and inspecting it, not just assumed.
  async inlineCssFontUrls(cssText) {
    const urls = [ ...new Set(Array.from(cssText.matchAll(/url\(['"]?(https?:\/\/[^'")]+)['"]?\)/g), (m) => m[1])) ]

    const dataUrls = await Promise.all(urls.map(async (url) => {
      try {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`font fetch failed with status ${response.status}`)
        return [ url, await blobToDataUrl(await response.blob()) ]
      } catch (error) {
        console.error(`Kapow: failed to inline font asset ${url} for export, leaving it as a plain URL`, error)
        return [ url, null ]
      }
    }))

    let result = cssText
    for (const [ url, dataUrl ] of dataUrls) {
      if (dataUrl) result = result.split(url).join(dataUrl)
    }
    return result
  }

  // mimeType/quality let exportPdf reuse this for JPEG-encoded pages (see
  // EXPORT_PDF_PAGE_MIME) instead of PNG export's default; both need the
  // exact same SVG-building/rasterization steps ahead of that, just a
  // different final canvas.toBlob encoding.
  async renderPageToBlob(pageEl, { mimeType = EXPORT_MIME, quality } = {}) {
    const { width, height } = this.pageDimensions(pageEl)
    const svgMarkup = await this.buildExportSvgMarkup(pageEl)
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`

    return new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => {
        const canvas = document.createElement("canvas")
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext("2d")
        // The comic page itself always stays white (see the doc), which
        // used to come for free from .page-canvas's own CSS background —
        // now stripped from the exported SVG along with its border (see
        // buildExportSvgMarkup), so it needs to be filled in explicitly
        // instead of leaving a transparent PNG background. JPEG has no
        // alpha channel at all, so this matters even more there.
        ctx.fillStyle = "#fff"
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(image, 0, 0, width, height)
        canvas.toBlob((blob) => {
          if (blob) resolve(blob)
          else reject(new Error("canvas.toBlob returned null"))
        }, mimeType, quality)
      }
      image.onerror = () => reject(new Error("Failed to load the page's SVG for export"))
      image.src = dataUrl
    })
  }

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
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
