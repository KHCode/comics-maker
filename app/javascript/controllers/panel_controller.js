import { Controller } from "@hotwired/stimulus"
import { panelToRenderData, pointsToAttr, clipPathId } from "kapow/panel_render"
import { boundingBox, translatePoints, scaleFromCornerDrag } from "kapow/panel_geometry"

const SVG_NS = "http://www.w3.org/2000/svg"
const HANDLE_SIZE = 24 // page units, not screen pixels
const CORNERS = [ "nw", "ne", "se", "sw" ]

// Renders panels as SVG shapes with matching clip-paths (see
// kapow/panel_render.js), and handles selecting, dragging (move), and
// corner-handle scaling. Live-drags update the DOM directly for immediate
// feedback and only commit through the document store — the single
// mutation path (see kapow/document_store.js) — once, on release. That
// avoids tearing down and rebuilding the dragged element on every
// pointermove, which would otherwise fight the drag gesture itself.
export default class extends Controller {
  static targets = ["canvas"]

  connect() {
    if (!this.documentStoreController) {
      console.error("panel_controller: no document-store controller found on this element")
      return
    }

    this.selectedPanelId = null
    this.renderAll(this.currentPanels)
  }

  refresh(event) {
    this.renderAll(event.detail.state.panels)
  }

  deselectOnBackgroundPointerDown(event) {
    if (event.target === this.canvasTarget) this.deselect()
  }

  renderAll(panels) {
    this.clear()
    for (const panel of panels) this.renderPanel(panel)
    this.renderHandles()
  }

  clear() {
    this.canvasTarget.querySelectorAll(":scope > polygon.panel-outline, :scope > .panel-handle, :scope > defs").forEach((el) => el.remove())
    this._defs = null
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

  renderHandles() {
    if (!this.selectedPanelId) return
    const panel = this.currentPanels.find((p) => p.id === this.selectedPanelId)
    if (!panel) return

    const box = boundingBox(panel.pts)
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

  cornerPosition(box, corner) {
    const x = corner === "nw" || corner === "sw" ? box.minX : box.maxX
    const y = corner === "nw" || corner === "ne" ? box.minY : box.maxY
    return [ x, y ]
  }

  select(panelId) {
    if (this.selectedPanelId === panelId) return
    this.selectedPanelId = panelId
    this.renderAll(this.currentPanels)
  }

  deselect() {
    if (!this.selectedPanelId) return
    this.selectedPanelId = null
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

  // Shared drag machinery for both move and scale: tracks pointermove
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

    if (this.selectedPanelId === panelId) this.updateHandlePositions(pts)
  }

  updateHandlePositions(pts) {
    const box = boundingBox(pts)
    this.canvasTarget.querySelectorAll(".panel-handle").forEach((handle) => {
      const [ cx, cy ] = this.cornerPosition(box, handle.dataset.corner)
      handle.setAttribute("x", cx - HANDLE_SIZE / 2)
      handle.setAttribute("y", cy - HANDLE_SIZE / 2)
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
