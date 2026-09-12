import { Controller } from "@hotwired/stimulus"
import { DocumentStore } from "kapow/document_store"

// DOM/network glue for one page's DocumentStore (see
// app/javascript/kapow/document_store.js for the actual mutation/debounce/
// save logic, which has no DOM or Stimulus dependency of its own).
//
// Future Layout/Draw/Letter mode controllers reach this page's store via
// `this.application.getControllerForElementAndIdentifier(pageEl, "document-store").store`
// and call `.mutate(...)` on it — this controller doesn't need to know
// anything about what a panel or text is. After each mutation it dispatches
// a "document-store:change" event on this element so renderer controllers
// (panel_controller, and later draw/text controllers) can re-render,
// without document_store_controller needing to know about any of them.
export default class extends Controller {
  static values = {
    projectId: Number,
    pageId: Number,
    initialData: Object
  }

  connect() {
    this.store = new DocumentStore(this.initialDataValue, {
      persist: (state) => this._persist(state),
      onChange: (state) => this.dispatch("change", { detail: { state } })
    })
  }

  disconnect() {
    // Save any pending debounced changes rather than losing them if this
    // page's element leaves the DOM (e.g. a Turbo navigation).
    this.store.flush()
  }

  _persist(state) {
    const headers = { "Content-Type": "application/json", "Accept": "application/json" }
    // Absent when forgery protection is off (e.g. the test environment) —
    // the server doesn't require the header in that case either.
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken

    // Every panel currently referencing a photo (see panel.photo.src, a
    // blob signed_id) is resent on every save — cheaper than tracking
    // "just uploaded" as its own event, and the server only attaches
    // whichever of these aren't already attached to the page (see
    // PagesController#attach_new_photos), so resending ones already
    // attached is a no-op.
    const photoSignedIds = state.panels.map((panel) => panel.photo?.src).filter(Boolean)

    return fetch(`/projects/${this.projectIdValue}/pages/${this.pageIdValue}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ page: { panels: state.panels, texts: state.texts, photo_signed_ids: photoSignedIds } })
    }).then((response) => {
      if (!response.ok) throw new Error(`Save failed with status ${response.status}`)
      return response
    })
  }
}
