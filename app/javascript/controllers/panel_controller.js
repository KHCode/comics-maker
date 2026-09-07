import { Controller } from "@hotwired/stimulus"
import { panelToRenderData } from "kapow/panel_render"

const SVG_NS = "http://www.w3.org/2000/svg"

// Renders whatever panels exist in this page's DocumentStore as SVG
// shapes with matching clip-paths (see kapow/panel_render.js for the pure
// points/id computation). Read-only for now — no add/drag/resize yet;
// later Phase 3 PRs mutate through the same store and re-render.
export default class extends Controller {
  static targets = ["canvas"]

  connect() {
    const documentStore = this.application.getControllerForElementAndIdentifier(this.element, "document-store")

    if (!documentStore) {
      console.error("panel_controller: no document-store controller found on this element")
      return
    }

    this.renderPanels(documentStore.store.getState().panels)
  }

  renderPanels(panels) {
    for (const panel of panels) {
      this.renderPanel(panel)
    }
  }

  renderPanel(panel) {
    const { clipPathId, pointsAttr } = panelToRenderData(panel)

    const clipPath = document.createElementNS(SVG_NS, "clipPath")
    clipPath.setAttribute("id", clipPathId)
    const clipPolygon = document.createElementNS(SVG_NS, "polygon")
    clipPolygon.setAttribute("points", pointsAttr)
    clipPath.appendChild(clipPolygon)
    this.defs.appendChild(clipPath)

    const polygon = document.createElementNS(SVG_NS, "polygon")
    polygon.setAttribute("points", pointsAttr)
    polygon.setAttribute("class", "panel-outline")
    polygon.setAttribute("clip-path", `url(#${clipPathId})`)
    polygon.dataset.panelId = panel.id
    this.canvasTarget.appendChild(polygon)
  }

  get defs() {
    if (!this._defs) {
      this._defs = document.createElementNS(SVG_NS, "defs")
      this.canvasTarget.prepend(this._defs)
    }
    return this._defs
  }
}
