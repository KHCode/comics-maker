const DEFAULT_DEBOUNCE_MS = 800

// The single mutation path for a page's editing content. Every future mode
// (Layout/Draw/Letter) changes panels/texts by calling mutate() here,
// rather than writing to state or calling the server directly — that way
// persistence (this file) and, later, undo/redo (Phase 8) each only need
// to hook into mutations once, in one place.
//
// Framework-agnostic on purpose: no DOM/Stimulus/fetch references, so it
// can be unit tested directly (see test/javascript) and reused regardless
// of how a page's data ends up wired to the rest of the app.
export class DocumentStore {
  constructor(initialState = {}, { persist, debounceMs = DEFAULT_DEBOUNCE_MS } = {}) {
    if (typeof persist !== "function") {
      throw new Error("DocumentStore requires a persist(state) function")
    }

    this.state = {
      panels: initialState.panels ?? [],
      texts: initialState.texts ?? []
    }
    this.persist = persist
    this.debounceMs = debounceMs
    this._timer = null
    this._pendingSave = null
  }

  getState() {
    return this.state
  }

  // Applies `mutator(state)` and schedules a debounced save. `mutator` may
  // mutate the given state object in place (e.g. `state.panels.push(...)`).
  mutate(mutator) {
    mutator(this.state)
    this._scheduleSave()
    return this.state
  }

  _scheduleSave() {
    if (this._timer) clearTimeout(this._timer)
    this._timer = setTimeout(() => this.flush(), this.debounceMs)
  }

  // Saves immediately, bypassing any pending debounce — e.g. before leaving
  // the editor, so unsaved work isn't lost to a still-pending debounce.
  flush() {
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }

    this._pendingSave = Promise.resolve(this.persist(this.state)).catch((error) => {
      console.error("Kapow: failed to save page", error)
      throw error
    })

    return this._pendingSave
  }

  // Resolves once any in-flight or pending save settles. Callers that need
  // to guarantee a save has landed (e.g. before navigating away) should
  // call flush() first, then await this.
  whenSaved() {
    return this._pendingSave ?? Promise.resolve()
  }
}
