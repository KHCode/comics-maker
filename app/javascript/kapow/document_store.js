const DEFAULT_DEBOUNCE_MS = 800

// 60-step, session-only undo/redo (see the plan's Phase 8) — never
// persisted, so a reload always starts with a clean history.
const MAX_HISTORY = 60

// Consecutive mutate() calls that pass the same coalesceKey within this
// long of each other collapse into a single undo step, rather than one
// step per call. Every drag-style gesture in the app (panel/text move,
// resize, rotate, tail-drag...) already calls mutate() only once, on
// pointerup, via the live-preview-then-commit-once pattern — so it
// already produces exactly one undo step for free. The one exception is
// the Photo Adjust/Fit tab's sliders, whose `input` event fires on every
// tick of a drag (see panel_controller.js#updateFocusedPhoto's
// coalesceKey) — without this, dragging a brightness slider once would
// push dozens of undo steps, one per tick. A real second, separate drag
// on the same slider always leaves a much bigger gap than this between
// its first tick and the previous drag's last one.
const DEFAULT_COALESCE_WINDOW_MS = 500

function cloneState(state) {
  return JSON.parse(JSON.stringify(state))
}

function pushBounded(stack, snapshot) {
  stack.push(snapshot)
  if (stack.length > MAX_HISTORY) stack.shift()
}

// The single mutation path for a page's editing content. Every mode
// (Layout/Draw/Letter) changes panels/texts by calling mutate() here,
// rather than writing to state or calling the server directly — that way
// persistence and undo/redo (both in this file) only need to hook into
// mutations once, in one place.
//
// Framework-agnostic on purpose: no DOM/Stimulus/fetch references, so it
// can be unit tested directly (see test/javascript) and reused regardless
// of how a page's data ends up wired to the rest of the app.
export class DocumentStore {
  constructor(initialState = {}, { persist, debounceMs = DEFAULT_DEBOUNCE_MS, onChange, coalesceWindowMs = DEFAULT_COALESCE_WINDOW_MS } = {}) {
    if (typeof persist !== "function") {
      throw new Error("DocumentStore requires a persist(state) function")
    }

    this.state = {
      panels: initialState.panels ?? [],
      texts: initialState.texts ?? []
    }
    this.persist = persist
    this.debounceMs = debounceMs
    this.onChange = onChange
    this.coalesceWindowMs = coalesceWindowMs
    this._timer = null
    this._pendingSave = null

    this._undoStack = []
    this._redoStack = []
    this._lastCoalesceKey = null
    this._lastMutateAt = 0
  }

  getState() {
    return this.state
  }

  // Applies `mutator(state)` and schedules a debounced save. `mutator` may
  // mutate the given state object in place (e.g. `state.panels.push(...)`).
  // Notifies `onChange` synchronously so renderers (panel/draw/text
  // controllers) can update immediately, independent of the save debounce.
  //
  // `coalesceKey`, when given, merges this call into the previous undo
  // step instead of starting a new one, as long as the previous mutate()
  // call passed the same key within coalesceWindowMs (see above) — for
  // continuous, many-calls-per-gesture mutations like a slider drag.
  // Passing no key (the default) always starts a fresh undo step.
  mutate(mutator, { coalesceKey } = {}) {
    const now = Date.now()
    const coalescing = coalesceKey != null
      && coalesceKey === this._lastCoalesceKey
      && now - this._lastMutateAt < this.coalesceWindowMs

    if (!coalescing) {
      pushBounded(this._undoStack, cloneState(this.state))
      this._redoStack = []
    }

    mutator(this.state)
    this._lastCoalesceKey = coalesceKey ?? null
    this._lastMutateAt = now
    this.onChange?.(this.state)
    this._scheduleSave()
    return this.state
  }

  get canUndo() {
    return this._undoStack.length > 0
  }

  get canRedo() {
    return this._redoStack.length > 0
  }

  // Undo/redo replace the whole state wholesale from a snapshot, rather
  // than computing/applying an inverse of whatever mutate() call it's
  // undoing — far simpler and less error-prone than deriving and
  // maintaining a correct inverse for every one of the app's many distinct
  // mutation call sites (panel move/resize/vertex-edit, ink strokes and
  // erasing, photo pan/adjust, text move/resize/tail-drag/edit,
  // layering...). The memory cost of a snapshot per step is negligible
  // here: a page's whole panels+texts JSON is small even with many
  // strokes (a photo is just a blob signed_id string, never embedded
  // pixel data), so 60 of them is nowhere near a real concern.
  undo() {
    if (!this.canUndo) return

    pushBounded(this._redoStack, cloneState(this.state))
    this.state = this._undoStack.pop()
    this._lastCoalesceKey = null
    this.onChange?.(this.state)
    this._scheduleSave()
  }

  redo() {
    if (!this.canRedo) return

    pushBounded(this._undoStack, cloneState(this.state))
    this.state = this._redoStack.pop()
    this._lastCoalesceKey = null
    this.onChange?.(this.state)
    this._scheduleSave()
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
