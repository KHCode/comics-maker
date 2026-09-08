import { Controller } from "@hotwired/stimulus"
import { panelToRenderData, pointsToAttr, clipPathId } from "kapow/panel_render"
import { generateId } from "kapow/panel_shapes"
import {
  boundingBox,
  translatePoints,
  scaleFromCornerDrag,
  updateVertex,
  insertMidpointVertex,
  removeVertex
} from "kapow/panel_geometry"

const SVG_NS = "http://www.w3.org/2000/svg"
const HANDLE_SIZE = 24 // page units, not screen pixels
const VERTEX_HANDLE_RADIUS = 12
const MIDPOINT_HANDLE_SIZE = 16
const CORNERS = [ "nw", "ne", "se", "sw" ]

const BAR_BUTTON_SIZE = 44
const BAR_BUTTON_GAP = 8
const BAR_MARGIN_ABOVE = 12
const DUPLICATE_OFFSET = 24

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
    if (event.target === this.canvasTarget) this.deselect()
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
    for (const panel of panels) this.renderPanel(panel)
    this.renderSelectionUI(panels)
  }

  clear() {
    this.canvasTarget.querySelectorAll(":scope > polygon.panel-outline, :scope > .panel-handle, :scope > .panel-floating-bar, :scope > defs").forEach((el) => el.remove())
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

    const polygon = document.createElementNS(SVG_NS, "polygon")
    polygon.setAttribute("points", pointsAttr)
    polygon.setAttribute("class", panel.id === this.selectedPanelId ? "panel-outline panel-outline--selected" : "panel-outline")
    polygon.setAttribute("clip-path", `url(#${clipId})`)
    polygon.dataset.panelId = panel.id
    polygon.addEventListener("pointerdown", (event) => this.startMove(event, panel.id))
    this.canvasTarget.appendChild(polygon)
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

  get floatingBarButtons() {
    return [
      { action: "shape", label: "✎", active: this.shapeMode },
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
    else if (action === "duplicate") this.duplicateSelected()
    else if (action === "delete") this.deleteSelected()
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

  startMove(event, panelId) {
    event.stopPropagation()
    event.preventDefault()

    this.select(panelId)

    const startPoint = this.svgPoint(event)
    this.beginDrag(panelId, (originalPts, current) =>
      translatePoints(originalPts, current.x - startPoint.x, current.y - startPoint.y)
    )
  }

  startScale(event, panelId, corner) {
    event.stopPropagation()
    event.preventDefault()

    this.beginDrag(panelId, (originalPts, current) => scaleFromCornerDrag(originalPts, corner, current.x, current.y))
  }

  startVertexDrag(event, panelId, index) {
    event.stopPropagation()
    event.preventDefault()

    this.beginDrag(panelId, (originalPts, current) => updateVertex(originalPts, index, current.x, current.y))
  }

  // Shared drag machinery for move/scale/vertex-drag: tracks pointermove
  // against the panel's original (pre-drag) points, updates the DOM live,
  // and commits the final result through the document store on release.
  beginDrag(panelId, computeNewPts) {
    const store = this.documentStoreController.store
    const panel = store.getState().panels.find((p) => p.id === panelId)
    if (!panel) return

    const originalPts = panel.pts.map(([ x, y ]) => [ x, y ])
    let lastPts = null

    const onMove = (moveEvent) => {
      const current = this.svgPoint(moveEvent)
      lastPts = computeNewPts(originalPts, current)
      this.updatePanelDom(panelId, lastPts)
    }

    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)

      if (lastPts) {
        store.mutate((state) => {
          const target = state.panels.find((p) => p.id === panelId)
          if (target) target.pts = lastPts
        })
      }
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  // Updates the live DOM during a drag without a full clear/rebuild, so
  // the dragged element itself is never torn down mid-gesture.
  updatePanelDom(panelId, pts) {
    const pointsAttr = pointsToAttr(pts)

    const polygon = this.canvasTarget.querySelector(`polygon.panel-outline[data-panel-id="${panelId}"]`)
    if (polygon) polygon.setAttribute("points", pointsAttr)

    const clipPolygon = this.canvasTarget.querySelector(`#${clipPathId(panelId)} polygon`)
    if (clipPolygon) clipPolygon.setAttribute("points", pointsAttr)

    if (this.selectedPanelId === panelId) {
      if (this.shapeMode) {
        this.updateVertexHandlePositions(pts)
      } else {
        this.updateCornerHandlePositions(pts)
      }
      if (this._floatingBar) this.positionFloatingBar(this._floatingBar, pts)
    }
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
