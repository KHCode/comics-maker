import { Controller } from "@hotwired/stimulus"
import { DocumentStore } from "kapow/document_store"

// DOM/network glue for one page's DocumentStore (see
// app/javascript/kapow/document_store.js for the actual mutation/debounce/
// save logic, which has no DOM or Stimulus dependency of its own).
//
// Future Layout/Draw/Letter mode controllers reach this page's store via
// `this.application.getControllerForElementAndIdentifier(pageEl, "document-store").store`
// and call `.mutate(...)` on it — this controller doesn't need to know
// anything about what a panel or text is.
export default class extends Controller {
  static values = {
    projectId: Number,
    pageId: Number,
    initialData: Object
  }

  connect() {
    this.store = new DocumentStore(this.initialDataValue, {
      persist: (state) => this._persist(state)
    })
  }

  disconnect() {
    // Save any pending debounced changes rather than losing them if this
    // page's element leaves the DOM (e.g. a Turbo navigation).
    this.store.flush()
  }

  _persist(state) {
    return fetch(`/projects/${this.projectIdValue}/pages/${this.pageIdValue}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]').content
      },
      body: JSON.stringify({ page: { panels: state.panels, texts: state.texts } })
    }).then((response) => {
      if (!response.ok) throw new Error(`Save failed with status ${response.status}`)
      return response
    })
  }
}
