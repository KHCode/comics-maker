import { Controller } from "@hotwired/stimulus"
import { panelToRenderData, pointsToAttr, pointsToPathD, clipPathId } from "kapow/panel_render"
import { generateId } from "kapow/panel_shapes"
import {
  boundingBox,
  translatePoints,
  scaleFromCornerDrag,
  cornerScaleFactors,
  scalePointsFromAnchor,
  updateVertex,
  insertMidpointVertex,
  removeVertex
} from "kapow/panel_geometry"
import { INK_TOOLS, INK_SIZES, INK_COLORS, pressureOrDefault, strokeWidth, eraseStrokes } from "kapow/ink"

const SVG_NS = "http://www.w3.org/2000/svg"
const HANDLE_SIZE = 24 // page units, not screen pixels
const VERTEX_HANDLE_RADIUS = 12
const MIDPOINT_HANDLE_SIZE = 16
const CORNERS = [ "nw", "ne", "se", "sw" ]

const BAR_BUTTON_SIZE = 44
const BAR_BUTTON_GAP = 8
const BAR_MARGIN_ABOVE = 12
const DUPLICATE_OFFSET = 24

// How much margin (as a fraction of the focused panel's own width/height)
// stays visible around it when zoomed in — just enough to see past its
// edge into the dimmed context, not a large buffer that eats into how big
// the panel itself renders.
const FOCUS_MARGIN_RATIO = 0.04

// The eraser's hit-test radius (page units) is a multiple of the current
// brush size's base width — bigger than the equivalent pen/marker stroke
// so it's actually usable as an eraser rather than requiring pixel-precise
// passes over thin ink lines.
const ERASER_RADIUS_MULTIPLIER = 1.5

// Renders panels as SVG shapes with matching clip-paths (see
// kapow/panel_render.js), and handles selecting, dragging (move),
// corner-handle scaling, the floating bar (shape/duplicate/delete), and
// per-vertex shape editing. Live-drags update the DOM directly for
// immediate feedback and only commit through the document store — the
// single mutation path (see kapow/document_store.js) — once, on release
// (or immediately, for one-shot actions like duplicate/delete/insert/
// remove vertex). That avoids tearing down and rebuilding the dragged
// element on every pointermove, which would otherwise fight the drag
// gesture itself.
export default class extends Controller {
  static targets = ["canvas"]

  connect() {
    if (!this.documentStoreController) {
      console.error("panel_controller: no document-store controller found on this element")
      return
    }

    this.selectedPanelId = null
    this.shapeMode = false
    this.focusedPanelId = null
    this.originalViewBox = this.canvasTarget.getAttribute("viewBox")
    this.boundHandleKeydown = this.handleKeydown.bind(this)
    document.addEventListener("keydown", this.boundHandleKeydown)
    this.renderAll(this.currentPanels)
  }

  disconnect() {
    document.removeEventListener("keydown", this.boundHandleKeydown)
  }

  refresh(event) {
    this.renderAll(event.detail.state.panels)
  }

  deselectOnBackgroundPointerDown(event) {
    if (event.target !== this.canvasTarget) return

    if (this.focusedPanelId) {
      this.exitFocus()
    } else {
      this.deselect()
    }
  }

  handleKeydown(event) {
    if (!this.selectedPanelId) return
    if (event.key !== "Delete" && event.key !== "Backspace") return
    if (this.isEditableTarget(event.target)) return

    event.preventDefault()
    this.deleteSelected()
  }

  isEditableTarget(target) {
    return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable
  }

  renderAll(panels) {
    this.clear()
    // Sibling panels are left out entirely while focused, not just dimmed —
    // their strokes would otherwise show through the (translucent) focus
    // overlay, made worse by stroke-width scaling up along with the zoom.
    const panelsToRender = this.focusedPanelId
      ? panels.filter((panel) => panel.id === this.focusedPanelId)
      : panels
    for (const panel of panelsToRender) this.renderPanel(panel)
    this.renderSelectionUI(panels)
    this.renderFocusOverlay(panels)
  }

  clear() {
    this.canvasTarget.querySelectorAll(":scope > polygon.panel-outline, :scope > .panel-background, :scope > .panel-handle, :scope > .panel-floating-bar, :scope > .panel-focus-dim, :scope > .panel-ink, :scope > defs").forEach((el) => el.remove())
    this._defs = null
    this._floatingBar = null
  }

  renderPanel(panel) {
    const { clipPathId: clipId, pointsAttr } = panelToRenderData(panel)

    const clipPath = document.createElementNS(SVG_NS, "clipPath")
    clipPath.setAttribute("id", clipId)
    const clipPolygon = document.createElementNS(SVG_NS, "polygon")
    clipPolygon.setAttribute("points", pointsAttr)
    clipPath.appendChild(clipPolygon)
    this.defs.appendChild(clipPath)

    // An opaque backing shape, painted before anything else this panel
    // owns, so an overlapping panel earlier in the array (rendered
    // earlier, and therefore visually beneath this one — see
    // bringToFront/sendToBack) has its ink and outline actually hidden by
    // this one rather than showing through a transparent panel interior.
    const background = document.createElementNS(SVG_NS, "polygon")
    background.setAttribute("points", pointsAttr)
    background.setAttribute("class", "panel-background")
    background.dataset.panelId = panel.id
    this.canvasTarget.appendChild(background)

    // Ink is appended (and clipped to the panel's own shape) before the
    // outline polygon below, so the panel's border always renders crisp on
    // top of any ink that reaches its edge, rather than being painted over.
    const inkGroup = document.createElementNS(SVG_NS, "g")
    inkGroup.setAttribute("class", "panel-ink")
    inkGroup.setAttribute("clip-path", `url(#${clipId})`)
    inkGroup.dataset.panelId = panel.id
    this.canvasTarget.appendChild(inkGroup)
    this.renderInkGroup(panel.id, panel.strokes)

    const polygon = document.createElementNS(SVG_NS, "polygon")
    polygon.setAttribute("points", pointsAttr)
    polygon.setAttribute("class", panel.id === this.selectedPanelId ? "panel-outline panel-outline--selected" : "panel-outline")
    polygon.setAttribute("clip-path", `url(#${clipId})`)
    polygon.dataset.panelId = panel.id
    polygon.addEventListener("pointerdown", (event) => this.handlePanelPointerDown(event, panel.id))
    this.canvasTarget.appendChild(polygon)
  }

  // Rebuilds one panel's ink strokes as <polyline> elements — used both for
  // the initial render and for the eraser's live preview (see
  // startErasing), where the number of surviving segments changes on every
  // move as strokes get split/removed, so patching individual elements in
  // place isn't an option the way a plain pen stroke's live redraw is.
  renderInkGroup(panelId, strokes) {
    const group = this.canvasTarget.querySelector(`.panel-ink[data-panel-id="${panelId}"]`)
    if (!group) return

    group.replaceChildren(...strokes.map((stroke) => this.buildInkPolyline(stroke)))
  }

  buildInkPolyline(stroke) {
    const polyline = document.createElementNS(SVG_NS, "polyline")
    polyline.setAttribute("points", pointsToAttr(stroke.pts))
    polyline.setAttribute("fill", "none")
    polyline.setAttribute("stroke", stroke.color)
    polyline.setAttribute("stroke-width", stroke.w)
    polyline.setAttribute("stroke-opacity", stroke.op)
    polyline.setAttribute("stroke-linecap", "round")
    polyline.setAttribute("stroke-linejoin", "round")
    return polyline
  }

  // Draw mode's zoomed-in focus view: a dark overlay covering the whole
  // (already-zoomed, see updateFocusViewBox) visible area with the
  // focused panel's own shape cut out of it via fill-rule: evenodd —
  // "dimming the rest of the page" without needing a second element per
  // panel or a <mask>.
  renderFocusOverlay(panels) {
    if (!this.focusedPanelId) return
    const panel = panels.find((p) => p.id === this.focusedPanelId)
    if (!panel) return

    const viewBox = this.canvasTarget.viewBox.baseVal
    const outerPts = [
      [ viewBox.x, viewBox.y ],
      [ viewBox.x + viewBox.width, viewBox.y ],
      [ viewBox.x + viewBox.width, viewBox.y + viewBox.height ],
      [ viewBox.x, viewBox.y + viewBox.height ]
    ]

    const overlay = document.createElementNS(SVG_NS, "path")
    overlay.setAttribute("class", "panel-focus-dim")
    overlay.setAttribute("fill-rule", "evenodd")
    overlay.setAttribute("d", `${pointsToPathD(outerPts)} ${pointsToPathD(panel.pts)}`)
    overlay.addEventListener("pointerdown", (event) => {
      event.stopPropagation()
      this.exitFocus()
    })
    this.canvasTarget.appendChild(overlay)
  }

  renderSelectionUI(panels) {
    if (!this.selectedPanelId) return
    const panel = panels.find((p) => p.id === this.selectedPanelId)
    if (!panel) return

    if (this.shapeMode) {
      this.renderVertexHandles(panel.pts)
    } else {
      this.renderCornerHandles(panel.pts)
    }
    this.renderFloatingBar(panel.pts)
  }

  renderCornerHandles(pts) {
    const box = boundingBox(pts)
    for (const corner of CORNERS) {
      const [ cx, cy ] = this.cornerPosition(box, corner)
      const handle = document.createElementNS(SVG_NS, "rect")
      handle.setAttribute("class", "panel-handle")
      handle.dataset.corner = corner
      handle.setAttribute("x", cx - HANDLE_SIZE / 2)
      handle.setAttribute("y", cy - HANDLE_SIZE / 2)
      handle.setAttribute("width", HANDLE_SIZE)
      handle.setAttribute("height", HANDLE_SIZE)
      handle.addEventListener("pointerdown", (event) => this.startScale(event, this.selectedPanelId, corner))
      this.canvasTarget.appendChild(handle)
    }
  }

  // ✎ shape mode: a draggable circle at every vertex, plus a smaller ◆
  // (diamond) at every edge midpoint to insert a new vertex there.
  // Double-tapping a vertex removes it (minimum 3 kept, see removeVertex).
  renderVertexHandles(pts) {
    pts.forEach((point, index) => {
      const [ x, y ] = point
      const handle = document.createElementNS(SVG_NS, "circle")
      handle.setAttribute("class", "panel-handle panel-handle--vertex")
      handle.dataset.vertexIndex = index
      handle.setAttribute("cx", x)
      handle.setAttribute("cy", y)
      handle.setAttribute("r", VERTEX_HANDLE_RADIUS)
      handle.addEventListener("pointerdown", (event) => this.startVertexDrag(event, this.selectedPanelId, index))
      handle.addEventListener("dblclick", (event) => this.removeVertexAt(event, this.selectedPanelId, index))
      this.canvasTarget.appendChild(handle)
    })

    pts.forEach((point, index) => {
      const [ mx, my ] = this.midpoint(pts, index)
      const handle = document.createElementNS(SVG_NS, "rect")
      handle.setAttribute("class", "panel-handle panel-handle--midpoint")
      handle.dataset.edgeIndex = index
      handle.setAttribute("width", MIDPOINT_HANDLE_SIZE)
      handle.setAttribute("height", MIDPOINT_HANDLE_SIZE)
      handle.setAttribute("x", mx - MIDPOINT_HANDLE_SIZE / 2)
      handle.setAttribute("y", my - MIDPOINT_HANDLE_SIZE / 2)
      handle.setAttribute("transform", `rotate(45 ${mx} ${my})`)
      handle.addEventListener("pointerdown", (event) => this.insertVertexAt(event, this.selectedPanelId, index))
      this.canvasTarget.appendChild(handle)
    })
  }

  midpoint(pts, index) {
    const [ ax, ay ] = pts[index]
    const [ bx, by ] = pts[(index + 1) % pts.length]
    return [ (ax + bx) / 2, (ay + by) / 2 ]
  }

  cornerPosition(box, corner) {
    const x = corner === "nw" || corner === "sw" ? box.minX : box.maxX
    const y = corner === "nw" || corner === "ne" ? box.minY : box.maxY
    return [ x, y ]
  }

  // The floating bar (✎ shape / ⧉ duplicate / 🗑 delete) is drawn once as a
  // <g> and repositioned via its transform during drags, rather than
  // rebuilt — see updateFloatingBarPosition.
  renderFloatingBar(pts) {
    const bar = document.createElementNS(SVG_NS, "g")
    bar.setAttribute("class", "panel-floating-bar")

    this.floatingBarButtons.forEach((button, index) => {
      const group = document.createElementNS(SVG_NS, "g")
      group.setAttribute("class", `floating-bar-button${button.active ? " floating-bar-button--active" : ""}`)
      group.setAttribute("transform", `translate(${index * (BAR_BUTTON_SIZE + BAR_BUTTON_GAP)}, 0)`)
      group.dataset.barAction = button.action

      const rect = document.createElementNS(SVG_NS, "rect")
      rect.setAttribute("width", BAR_BUTTON_SIZE)
      rect.setAttribute("height", BAR_BUTTON_SIZE)
      rect.setAttribute("rx", 8)
      group.appendChild(rect)

      const label = document.createElementNS(SVG_NS, "text")
      label.setAttribute("x", BAR_BUTTON_SIZE / 2)
      label.setAttribute("y", BAR_BUTTON_SIZE / 2)
      label.textContent = button.label
      group.appendChild(label)

      group.addEventListener("pointerdown", (event) => event.stopPropagation())
      group.addEventListener("click", (event) => {
        event.stopPropagation()
        this.handleFloatingBarAction(button.action)
      })

      bar.appendChild(group)
    })

    this.canvasTarget.appendChild(bar)
    this._floatingBar = bar
    this.positionFloatingBar(bar, pts)
  }

  // One button whose meaning flips with the selected panel's own stacking
  // position: raised to "send to back" once it's already the topmost
  // panel, "bring to front" otherwise — rather than two separate buttons
  // for a state that's only ever relevant in one direction at a time.
  get floatingBarButtons() {
    const isFrontmost = this.isPanelFrontmost(this.selectedPanelId)
    return [
      { action: "shape", label: "✎", active: this.shapeMode },
      { action: "layer", label: isFrontmost ? "⬇" : "⬆" },
      { action: "duplicate", label: "⧉" },
      { action: "delete", label: "🗑" }
    ]
  }

  positionFloatingBar(bar, pts) {
    const box = boundingBox(pts)
    const count = this.floatingBarButtons.length
    const totalWidth = count * BAR_BUTTON_SIZE + (count - 1) * BAR_BUTTON_GAP
    const barX = (box.minX + box.maxX) / 2 - totalWidth / 2
    const barY = Math.max(box.minY - BAR_MARGIN_ABOVE - BAR_BUTTON_SIZE, BAR_MARGIN_ABOVE)
    bar.setAttribute("transform", `translate(${barX}, ${barY})`)
  }

  handleFloatingBarAction(action) {
    if (action === "shape") this.toggleShapeMode()
    else if (action === "layer") this.toggleLayerPosition()
    else if (action === "duplicate") this.duplicateSelected()
    else if (action === "delete") this.deleteSelected()
  }

  // Stacking order is just the panels array's own order — later elements
  // paint later, and therefore sit visually on top (see renderAll/
  // renderPanel) — so there's no separate z-index field to maintain; a
  // newly added panel already lands on top for free, since every add
  // (addPanel/applyPreset/duplicateSelected) appends to the end of the
  // array. "Send to back"/"bring to front" just move the selected panel to
  // the other end of that same array.
  toggleLayerPosition() {
    if (!this.selectedPanelId) return

    if (this.isPanelFrontmost(this.selectedPanelId)) {
      this.sendToBack(this.selectedPanelId)
    } else {
      this.bringToFront(this.selectedPanelId)
    }
  }

  isPanelFrontmost(panelId) {
    const panels = this.currentPanels
    return panels.length > 0 && panels[panels.length - 1].id === panelId
  }

  bringToFront(panelId) {
    this.documentStoreController.store.mutate((state) => {
      const index = state.panels.findIndex((p) => p.id === panelId)
      if (index === -1) return
      const [ panel ] = state.panels.splice(index, 1)
      state.panels.push(panel)
    })
  }

  sendToBack(panelId) {
    this.documentStoreController.store.mutate((state) => {
      const index = state.panels.findIndex((p) => p.id === panelId)
      if (index === -1) return
      const [ panel ] = state.panels.splice(index, 1)
      state.panels.unshift(panel)
    })
  }

  toggleShapeMode() {
    if (!this.selectedPanelId) return
    this.shapeMode = !this.shapeMode
    this.renderAll(this.currentPanels)
  }

  duplicateSelected() {
    if (!this.selectedPanelId) return
    const store = this.documentStoreController.store
    const panel = store.getState().panels.find((p) => p.id === this.selectedPanelId)
    if (!panel) return

    const duplicate = {
      id: generateId(),
      pts: translatePoints(panel.pts, DUPLICATE_OFFSET, DUPLICATE_OFFSET),
      strokes: panel.strokes.map((stroke) => ({ ...stroke, pts: stroke.pts.map(([ x, y ]) => [ x, y ]) })),
      photo: panel.photo ? { ...panel.photo } : null
    }

    store.mutate((state) => {
      state.panels.push(duplicate)
    })

    this.select(duplicate.id)
  }

  deleteSelected() {
    if (!this.selectedPanelId) return
    const panelId = this.selectedPanelId

    // Clear selection state before mutating: the store's onChange callback
    // fires refresh() synchronously (see document_store_controller.js), so
    // this must already be up to date by the time that render happens.
    this.selectedPanelId = null
    this.shapeMode = false

    this.documentStoreController.store.mutate((state) => {
      state.panels = state.panels.filter((p) => p.id !== panelId)
    })
  }

  insertVertexAt(event, panelId, edgeIndex) {
    event.stopPropagation()
    event.preventDefault()

    this.documentStoreController.store.mutate((state) => {
      const panel = state.panels.find((p) => p.id === panelId)
      if (panel) panel.pts = insertMidpointVertex(panel.pts, edgeIndex)
    })
  }

  removeVertexAt(event, panelId, index) {
    event.stopPropagation()
    event.preventDefault()

    const store = this.documentStoreController.store
    const panel = store.getState().panels.find((p) => p.id === panelId)
    if (!panel || panel.pts.length <= 3) return

    store.mutate((state) => {
      const target = state.panels.find((p) => p.id === panelId)
      target.pts = removeVertex(target.pts, index)
    })
  }

  select(panelId) {
    if (this.selectedPanelId === panelId) return
    this.selectedPanelId = panelId
    this.shapeMode = false
    this.renderAll(this.currentPanels)
  }

  deselect() {
    if (!this.selectedPanelId) return
    this.selectedPanelId = null
    this.shapeMode = false
    this.renderAll(this.currentPanels)
  }

  // Layout mode taps a panel to select/drag it; Draw mode's first tap on a
  // panel zooms into it (see focusPanel), and — since focusPanel is then a
  // no-op for the already-focused panel — a subsequent tap/drag on that
  // same (now zoomed-in) panel draws or erases instead. Letter mode
  // doesn't act on a panel tap at all (text elements are their own future
  // layer).
  handlePanelPointerDown(event, panelId) {
    event.stopPropagation()
    event.preventDefault()

    if (this.currentMode === "draw") {
      if (this.focusedPanelId === panelId) {
        this.startInkGesture(event, panelId)
      } else {
        this.focusPanel(panelId)
      }
      return
    }
    if (this.currentMode !== "layout") return

    // A bubbling Stimulus event rather than relying on the native
    // pointerdown/click bubbling up to the page: this pointerdown already
    // calls stopPropagation (and Chrome drops the compatibility "click"
    // entirely once pointerdown's preventDefault is called), so an
    // ancestor listening for either would never see this interaction.
    this.dispatch("selected", { bubbles: true })
    this.select(panelId)

    const startPoint = this.svgPoint(event)
    // Ink (and, later, photo) moves with the panel — see the doc: "drag to
    // move (strokes and photo move with it)" — so the same translation
    // applied to the panel's pts is applied to every stroke's pts too.
    this.beginDrag(
      panelId,
      (originalPts, current) => translatePoints(originalPts, current.x - startPoint.x, current.y - startPoint.y),
      (originalStrokes, current) => originalStrokes.map((stroke) => ({
        ...stroke,
        pts: translatePoints(stroke.pts, current.x - startPoint.x, current.y - startPoint.y)
      }))
    )
  }

  // Draw mode's actual drawing gesture, captured once a panel is already
  // zoomed into — Pen/Marker append a new stroke; Eraser instead
  // splits/removes segments of existing strokes it passes over (see
  // startErasing / kapow/ink.js#eraseStrokes).
  startInkGesture(event, panelId) {
    if (this.currentDrawTool === "eraser") {
      this.startErasing(event, panelId)
    } else {
      this.startStroke(event, panelId)
    }
  }

  startStroke(event, panelId) {
    const store = this.documentStoreController.store
    const tool = this.currentDrawTool
    const color = this.currentDrawColor
    const size = this.currentDrawSize

    const startPoint = this.svgPoint(event)
    const pts = [ [ startPoint.x, startPoint.y ] ]
    const pressures = [ pressureOrDefault(event.pressure) ]

    const group = this.canvasTarget.querySelector(`.panel-ink[data-panel-id="${panelId}"]`)
    const polyline = this.buildInkPolyline({ color, w: strokeWidth(size, tool), op: INK_TOOLS[tool]?.opacity ?? 1, pts })
    group?.appendChild(polyline)

    const onMove = (moveEvent) => {
      const point = this.svgPoint(moveEvent)
      pts.push([ point.x, point.y ])
      pressures.push(pressureOrDefault(moveEvent.pressure))
      polyline.setAttribute("points", pointsToAttr(pts))
    }

    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)

      // A tap with no drag never became a real line — drop the preview
      // rather than persisting a zero-length stroke.
      if (pts.length < 2) {
        polyline.remove()
        return
      }

      const avgPressure = pressures.reduce((sum, p) => sum + p, 0) / pressures.length
      const stroke = { tool, color, w: strokeWidth(size, tool, avgPressure), op: INK_TOOLS[tool]?.opacity ?? 1, pts }

      store.mutate((state) => {
        const panel = state.panels.find((p) => p.id === panelId)
        if (panel) panel.strokes.push(stroke)
      })
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  startErasing(event, panelId) {
    const store = this.documentStoreController.store
    const panel = store.getState().panels.find((p) => p.id === panelId)
    if (!panel) return

    const originalStrokes = panel.strokes.map((stroke) => ({ ...stroke, pts: stroke.pts.map(([ x, y ]) => [ x, y ]) }))
    const radius = (INK_SIZES[this.currentDrawSize] ?? INK_SIZES.m) * ERASER_RADIUS_MULTIPLIER
    const eraserPts = []
    let currentStrokes = originalStrokes

    const applyErase = (point) => {
      eraserPts.push([ point.x, point.y ])
      currentStrokes = eraseStrokes(originalStrokes, eraserPts, radius)
      this.renderInkGroup(panelId, currentStrokes)
    }

    applyErase(this.svgPoint(event))
    const onMove = (moveEvent) => applyErase(this.svgPoint(moveEvent))

    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)

      store.mutate((state) => {
        const target = state.panels.find((p) => p.id === panelId)
        if (target) target.strokes = currentStrokes
      })
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  // Draw tray's tool/color/size buttons live in editor_controller.js (they
  // apply to whichever panel is drawn on next, not to any one page), so —
  // like currentMode — these read the current value straight off the
  // editor element's own data attributes rather than needing their own
  // event wiring.
  get currentDrawTool() {
    return this.editorElement?.dataset.editorDrawToolValue || "pen"
  }

  get currentDrawColor() {
    return this.editorElement?.dataset.editorDrawColorValue || INK_COLORS[0]
  }

  get currentDrawSize() {
    return this.editorElement?.dataset.editorDrawSizeValue || "m"
  }

  focusPanel(panelId) {
    if (this.focusedPanelId === panelId) return
    this.focusedPanelId = panelId
    // .page--focused (see editor.css) is what actually makes the panel
    // grow to fill the canvas area — the viewBox change alone only
    // re-crops the SVG's own internal camera, it doesn't touch the
    // fixed-size box that SVG sits in. The scroll-canvas is locked
    // alongside it so the (now-hidden) page list can't be scrolled out
    // from under the user while they're focused on a panel.
    this.element.classList.add("page--focused")
    this.editorCanvasElement?.classList.add("editor-canvas--locked")
    // Only the overlay's own position/size depends on the viewport (the
    // viewBox margin is purely a function of the panel's own bounding
    // box — see updateFocusViewBox), so a resize only needs to re-measure
    // .editor-canvas, not recompute the viewBox.
    this.boundPositionFocusOverlay ||= () => this.positionFocusOverlay()
    window.addEventListener("resize", this.boundPositionFocusOverlay)
    this.positionFocusOverlay()
    // Removing the container's own padding (see .page--focused in
    // editor.css) means the panel can grow right up to the container's
    // edges on whichever axis its own aspect ratio allows — but the other
    // axis still letterboxes onto the container's own background, outside
    // the SVG entirely. Exiting on a tap there needs its own listener; the
    // dim overlay's tap-to-exit (see renderFocusOverlay) only covers the
    // margin *inside* the SVG's viewBox.
    this.boundExitFocusOnBackgroundClick ||= (event) => {
      if (event.target === this.element) this.exitFocus()
    }
    this.element.addEventListener("pointerdown", this.boundExitFocusOnBackgroundClick)
    this.updateFocusViewBox()
    this.renderAll(this.currentPanels)
    // Lets editor_controller.js show/hide the header's exit button (see
    // updateFocusIndicator) without polling every page's panel controller
    // itself — panels now zoom in close enough to the edges (a minimal
    // margin, by design) that a corner button floating over the canvas
    // risks covering part of the panel, so the exit affordance lives in
    // the header instead, safely outside the canvas entirely.
    this.dispatch("focused", { bubbles: true })
  }

  exitFocus() {
    if (!this.focusedPanelId) return
    this.focusedPanelId = null
    this.element.classList.remove("page--focused")
    this.editorCanvasElement?.classList.remove("editor-canvas--locked")
    if (this.boundPositionFocusOverlay) window.removeEventListener("resize", this.boundPositionFocusOverlay)
    if (this.boundExitFocusOnBackgroundClick) this.element.removeEventListener("pointerdown", this.boundExitFocusOnBackgroundClick)
    this.element.style.removeProperty("top")
    this.element.style.removeProperty("left")
    this.element.style.removeProperty("width")
    this.element.style.removeProperty("height")
    this.canvasTarget.setAttribute("viewBox", this.originalViewBox)
    this.renderAll(this.currentPanels)
    this.dispatch("unfocused", { bubbles: true })
  }

  // .page--focused is `position: fixed` so it's immune to .editor-canvas's
  // own scrolling (see the class's comment in editor.css), but that means
  // plain `inset: 0` would center it on the *whole* viewport rather than
  // just the visible gap between header and footer — and since those
  // aren't the same height, "centered in the viewport" isn't the same
  // point as "centered in the gap" (it wrongly favors whichever of the
  // two is shorter). Measuring .editor-canvas's own rect and pinning the
  // overlay to exactly that gets both: scroll-immune, and actually
  // centered where the page list would otherwise be.
  positionFocusOverlay() {
    const canvasRect = this.editorCanvasElement?.getBoundingClientRect()
    if (!canvasRect) return

    this.element.style.top = `${canvasRect.top}px`
    this.element.style.left = `${canvasRect.left}px`
    this.element.style.width = `${canvasRect.width}px`
    this.element.style.height = `${canvasRect.height}px`
  }

  updateFocusViewBox() {
    const panel = this.currentPanels.find((p) => p.id === this.focusedPanelId)
    if (!panel) return

    const box = boundingBox(panel.pts)
    const width = box.maxX - box.minX
    const height = box.maxY - box.minY
    const marginX = Math.max(width, 1) * FOCUS_MARGIN_RATIO
    const marginY = Math.max(height, 1) * FOCUS_MARGIN_RATIO

    // Deliberately not stretched to match the container's own aspect
    // ratio: doing that (an earlier version of this method did) grows
    // whichever axis is needed to eliminate letterboxing entirely, but
    // "however much the aspect ratio needs" has no relation to "a small,
    // consistent margin" — for a square panel in a wide window it ballooned
    // the side margins far past a thin sliver of context. A plain margin
    // on the panel's own bounding box keeps that margin minimal and
    // predictable; the tradeoff is that .page-canvas's max-width/
    // max-height (editor.css) may still letterbox onto .page--focused's
    // own (plain, undimmed) background when the panel's aspect ratio
    // doesn't happen to match the container's.
    const viewBox = [
      box.minX - marginX,
      box.minY - marginY,
      width + marginX * 2,
      height + marginY * 2
    ].join(" ")
    this.canvasTarget.setAttribute("viewBox", viewBox)
  }

  get currentMode() {
    return this.editorElement?.dataset.editorModeValue || "layout"
  }

  get editorElement() {
    if (!this._editorElement) {
      this._editorElement = this.element.closest('[data-controller~="editor"]')
    }
    return this._editorElement
  }

  get editorCanvasElement() {
    if (!this._editorCanvasElement) {
      this._editorCanvasElement = this.element.closest(".editor-canvas")
    }
    return this._editorCanvasElement
  }

  startScale(event, panelId, corner) {
    event.stopPropagation()
    event.preventDefault()

    // Corner handles "proportionally scale ink" (per the doc) alongside
    // the panel itself — the same anchor/scale factors the panel's own
    // pts use (see cornerScaleFactors) are applied to every stroke's pts,
    // and to each stroke's width, so ink drawn near an edge shrinks/grows
    // with the panel rather than staying a fixed page-unit thickness.
    this.beginDrag(
      panelId,
      (originalPts, current) => scaleFromCornerDrag(originalPts, corner, current.x, current.y),
      (originalStrokes, current, originalPts) => {
        const { anchorX, anchorY, scaleX, scaleY } = cornerScaleFactors(originalPts, corner, current.x, current.y)
        const widthScale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2
        return originalStrokes.map((stroke) => ({
          ...stroke,
          pts: scalePointsFromAnchor(stroke.pts, anchorX, anchorY, scaleX, scaleY),
          w: Math.max(stroke.w * widthScale, 0.5)
        }))
      }
    )
  }

  startVertexDrag(event, panelId, index) {
    event.stopPropagation()
    event.preventDefault()

    this.beginDrag(panelId, (originalPts, current) => updateVertex(originalPts, index, current.x, current.y))
  }

  // Shared drag machinery for move/scale/vertex-drag: tracks pointermove
  // against the panel's original (pre-drag) points, updates the DOM live,
  // and commits the final result through the document store on release.
  // `computeNewStrokes` defaults to leaving strokes untouched (vertex/shape
  // editing reshapes only the panel's own border — the doc doesn't call
  // for ink to follow a non-uniform per-vertex edit the way it does a
  // plain move or corner-scale).
  beginDrag(panelId, computeNewPts, computeNewStrokes = (strokes) => strokes) {
    const store = this.documentStoreController.store
    const panel = store.getState().panels.find((p) => p.id === panelId)
    if (!panel) return

    const originalPts = panel.pts.map(([ x, y ]) => [ x, y ])
    const originalStrokes = panel.strokes.map((stroke) => ({ ...stroke, pts: stroke.pts.map(([ x, y ]) => [ x, y ]) }))
    let lastPts = null
    let lastStrokes = null

    const onMove = (moveEvent) => {
      const current = this.svgPoint(moveEvent)
      lastPts = computeNewPts(originalPts, current)
      lastStrokes = computeNewStrokes(originalStrokes, current, originalPts)
      this.updatePanelDom(panelId, lastPts, lastStrokes)
    }

    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)

      if (lastPts) {
        store.mutate((state) => {
          const target = state.panels.find((p) => p.id === panelId)
          if (!target) return
          target.pts = lastPts
          if (lastStrokes) target.strokes = lastStrokes
        })
      }
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  // Updates the live DOM during a drag without a full clear/rebuild, so
  // the dragged element itself is never torn down mid-gesture.
  updatePanelDom(panelId, pts, strokes = null) {
    const pointsAttr = pointsToAttr(pts)

    const polygon = this.canvasTarget.querySelector(`polygon.panel-outline[data-panel-id="${panelId}"]`)
    if (polygon) polygon.setAttribute("points", pointsAttr)

    const background = this.canvasTarget.querySelector(`.panel-background[data-panel-id="${panelId}"]`)
    if (background) background.setAttribute("points", pointsAttr)

    const clipPolygon = this.canvasTarget.querySelector(`#${clipPathId(panelId)} polygon`)
    if (clipPolygon) clipPolygon.setAttribute("points", pointsAttr)

    if (strokes) this.updateInkDom(panelId, strokes)

    if (this.selectedPanelId === panelId) {
      if (this.shapeMode) {
        this.updateVertexHandlePositions(pts)
      } else {
        this.updateCornerHandlePositions(pts)
      }
      if (this._floatingBar) this.positionFloatingBar(this._floatingBar, pts)
    }
  }

  // Patches each ink polyline's own points/width in place, matched to
  // `strokes` by index — cheaper than renderInkGroup's full rebuild, and
  // safe here since a move/scale drag only transforms existing strokes in
  // place, never changes how many there are (contrast the eraser, which
  // does change the segment count and uses renderInkGroup instead).
  updateInkDom(panelId, strokes) {
    const group = this.canvasTarget.querySelector(`.panel-ink[data-panel-id="${panelId}"]`)
    if (!group) return

    const polylines = group.children
    strokes.forEach((stroke, index) => {
      const polyline = polylines[index]
      if (!polyline) return
      polyline.setAttribute("points", pointsToAttr(stroke.pts))
      polyline.setAttribute("stroke-width", stroke.w)
    })
  }

  updateCornerHandlePositions(pts) {
    const box = boundingBox(pts)
    this.canvasTarget.querySelectorAll(".panel-handle[data-corner]").forEach((handle) => {
      const [ cx, cy ] = this.cornerPosition(box, handle.dataset.corner)
      handle.setAttribute("x", cx - HANDLE_SIZE / 2)
      handle.setAttribute("y", cy - HANDLE_SIZE / 2)
    })
  }

  updateVertexHandlePositions(pts) {
    this.canvasTarget.querySelectorAll(".panel-handle--vertex").forEach((handle) => {
      const [ x, y ] = pts[Number(handle.dataset.vertexIndex)]
      handle.setAttribute("cx", x)
      handle.setAttribute("cy", y)
    })

    this.canvasTarget.querySelectorAll(".panel-handle--midpoint").forEach((handle) => {
      const [ mx, my ] = this.midpoint(pts, Number(handle.dataset.edgeIndex))
      handle.setAttribute("x", mx - MIDPOINT_HANDLE_SIZE / 2)
      handle.setAttribute("y", my - MIDPOINT_HANDLE_SIZE / 2)
      handle.setAttribute("transform", `rotate(45 ${mx} ${my})`)
    })
  }

  svgPoint(event) {
    const point = this.canvasTarget.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    return point.matrixTransform(this.canvasTarget.getScreenCTM().inverse())
  }

  get currentPanels() {
    return this.documentStoreController.store.getState().panels
  }

  get documentStoreController() {
    return this.application.getControllerForElementAndIdentifier(this.element, "document-store")
  }

  get defs() {
    if (!this._defs) {
      this._defs = document.createElementNS(SVG_NS, "defs")
      this.canvasTarget.prepend(this._defs)
    }
    return this._defs
  }
}
