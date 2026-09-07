import { Controller } from "@hotwired/stimulus"
import { panelToRenderData } from "kapow/panel_render"

const SVG_NS = "http://www.w3.org/2000/svg"

// Renders whatever panels exist in this page's DocumentStore as SVG
// shapes with matching clip-paths (see kapow/panel_render.js for the pure
// points/id computation). Read-only for now — no drag/resize yet.
//
// Renders once on connect, then again whenever the document store fires
// its "change" event (wire `data-action="document-store:change->panel#refresh"`
// on the same element) — e.g. after the Layout tray adds a panel or
// applies a preset.
export default class extends Controller {
  static targets = ["canvas"]

  connect() {
    const documentStore = this.documentStoreController

    if (!documentStore) {
      console.error("panel_controller: no document-store controller found on this element")
      return
    }

    this.renderAll(documentStore.store.getState().panels)
  }

  refresh(event) {
    this.renderAll(event.detail.state.panels)
  }

  renderAll(panels) {
    this.clear()
    for (const panel of panels) {
      this.renderPanel(panel)
    }
  }

  clear() {
    this.canvasTarget.querySelectorAll(":scope > polygon.panel-outline, :scope > defs").forEach((el) => el.remove())
    this._defs = null
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
