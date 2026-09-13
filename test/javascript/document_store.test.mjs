// Unit tests for the framework-agnostic DocumentStore module. Run with:
//   node test/javascript/document_store.test.mjs
// (Node's built-in test runner — no npm dependency needed, matching this
// app's no-build-step importmap setup.)

import test from "node:test"
import assert from "node:assert/strict"
import { DocumentStore } from "../../app/javascript/kapow/document_store.js"

test("seeds state from the given initial panels/texts", () => {
  const store = new DocumentStore(
    { panels: [ { id: "p1" } ], texts: [ { id: "t1" } ] },
    { persist: () => {} }
  )

  assert.deepEqual(store.getState(), { panels: [ { id: "p1" } ], texts: [ { id: "t1" } ] })
})

test("defaults panels/texts to empty arrays when omitted", () => {
  const store = new DocumentStore({}, { persist: () => {} })

  assert.deepEqual(store.getState(), { panels: [], texts: [] })
})

test("requires a persist function", () => {
  assert.throws(() => new DocumentStore({}, {}), /requires a persist/)
})

test("mutate applies the mutator to state", () => {
  const store = new DocumentStore({}, { persist: () => {} })

  store.mutate((state) => state.panels.push({ id: "p1" }))

  assert.deepEqual(store.getState().panels, [ { id: "p1" } ])
})

test("mutate notifies onChange synchronously, independent of the save debounce", () => {
  const changes = []
  const store = new DocumentStore({}, { persist: () => {}, onChange: (state) => changes.push(state.panels.length), debounceMs: 1000 })

  store.mutate((state) => state.panels.push({ id: "p1" }))
  store.mutate((state) => state.panels.push({ id: "p2" }))

  assert.deepEqual(changes, [ 1, 2 ])
})

test("onChange is optional", () => {
  const store = new DocumentStore({}, { persist: () => {} })
  assert.doesNotThrow(() => store.mutate((state) => state.panels.push({ id: "p1" })))
})

test("mutate schedules a debounced save rather than persisting immediately", () => {
  let calls = 0
  const store = new DocumentStore({}, { persist: () => calls++, debounceMs: 50 })

  store.mutate((state) => state.panels.push({ id: "p1" }))

  assert.equal(calls, 0, "should not have persisted yet")
})

test("rapid mutations within the debounce window coalesce into a single save", async () => {
  let calls = 0
  const store = new DocumentStore({}, { persist: () => calls++, debounceMs: 20 })

  store.mutate((state) => state.panels.push({ id: "p1" }))
  store.mutate((state) => state.panels.push({ id: "p2" }))
  store.mutate((state) => state.panels.push({ id: "p3" }))

  await new Promise((resolve) => setTimeout(resolve, 40))

  assert.equal(calls, 1)
})

test("flush saves immediately and cancels the pending debounce", async () => {
  let calls = 0
  const store = new DocumentStore({}, { persist: () => calls++, debounceMs: 1000 })

  store.mutate((state) => state.panels.push({ id: "p1" }))
  await store.flush()

  assert.equal(calls, 1)

  // The debounce timer scheduled by mutate() should have been cancelled by
  // flush(), so waiting past its original delay must not trigger a second save.
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(calls, 1)
})

test("persist receives the current state", async () => {
  let received = null
  const store = new DocumentStore({}, { persist: (state) => { received = state } })

  store.mutate((state) => state.texts.push({ id: "t1" }))
  await store.flush()

  assert.deepEqual(received, { panels: [], texts: [ { id: "t1" } ] })
})

test("whenSaved resolves once a flush settles", async () => {
  const store = new DocumentStore({}, { persist: () => new Promise((r) => setTimeout(r, 10)) })

  store.mutate((state) => state.panels.push({ id: "p1" }))
  const flushPromise = store.flush()

  await store.whenSaved()
  await flushPromise // should already be settled
})

test("whenSaved resolves immediately if nothing has been saved yet", async () => {
  const store = new DocumentStore({}, { persist: () => {} })
  await store.whenSaved()
})

test("a persist rejection is logged and re-thrown, not swallowed", async () => {
  const store = new DocumentStore({}, { persist: () => Promise.reject(new Error("network down")) })

  store.mutate((state) => state.panels.push({ id: "p1" }))

  await assert.rejects(() => store.flush(), /network down/)
})

test("canUndo/canRedo are false on a fresh store", () => {
  const store = new DocumentStore({}, { persist: () => {} })
  assert.equal(store.canUndo, false)
  assert.equal(store.canRedo, false)
})

test("undo reverts the last mutation, and redo brings it back", () => {
  const store = new DocumentStore({}, { persist: () => {} })

  store.mutate((state) => state.panels.push({ id: "p1" }))
  store.mutate((state) => state.panels.push({ id: "p2" }))
  assert.deepEqual(store.getState().panels.map((p) => p.id), [ "p1", "p2" ])

  store.undo()
  assert.deepEqual(store.getState().panels.map((p) => p.id), [ "p1" ])

  store.undo()
  assert.deepEqual(store.getState().panels, [])
  assert.equal(store.canUndo, false)

  store.redo()
  assert.deepEqual(store.getState().panels.map((p) => p.id), [ "p1" ])

  store.redo()
  assert.deepEqual(store.getState().panels.map((p) => p.id), [ "p1", "p2" ])
  assert.equal(store.canRedo, false)
})

test("undo/redo are no-ops with nothing to undo/redo", () => {
  const store = new DocumentStore({}, { persist: () => {} })
  assert.doesNotThrow(() => store.undo())
  assert.doesNotThrow(() => store.redo())
  assert.deepEqual(store.getState(), { panels: [], texts: [] })
})

test("a new mutation after undo discards the redo stack (real history branches, not a linear tape)", () => {
  const store = new DocumentStore({}, { persist: () => {} })

  store.mutate((state) => state.panels.push({ id: "p1" }))
  store.mutate((state) => state.panels.push({ id: "p2" }))
  store.undo()
  assert.equal(store.canRedo, true)

  store.mutate((state) => state.panels.push({ id: "p3" }))
  assert.equal(store.canRedo, false)
  assert.deepEqual(store.getState().panels.map((p) => p.id), [ "p1", "p3" ])
})

test("undo/redo notify onChange and schedule a save, just like a mutation", () => {
  let changeCount = 0
  let persistCount = 0
  const store = new DocumentStore({}, {
    persist: () => persistCount++,
    onChange: () => changeCount++,
    debounceMs: 5
  })

  store.mutate((state) => state.panels.push({ id: "p1" }))
  store.undo()
  store.redo()

  assert.equal(changeCount, 3)
})

test("undo history is bounded to 60 steps", () => {
  const store = new DocumentStore({}, { persist: () => {} })

  for (let i = 0; i < 65; i++) {
    store.mutate((state) => state.panels.push({ id: `p${i}` }))
  }

  for (let i = 0; i < 65; i++) store.undo()

  // Only the last 60 mutations could be undone, so 5 of them survive.
  assert.equal(store.getState().panels.length, 5)
  assert.equal(store.canUndo, false)
})

test("mutations sharing a coalesceKey within the coalesce window collapse into one undo step", () => {
  const store = new DocumentStore({}, { persist: () => {}, coalesceWindowMs: 10000 })

  store.mutate((state) => { state.panels.push({ id: "p1", val: 0 }) })
  store.mutate((state) => { state.panels[0].val = 1 }, { coalesceKey: "drag" })
  store.mutate((state) => { state.panels[0].val = 2 }, { coalesceKey: "drag" })
  store.mutate((state) => { state.panels[0].val = 3 }, { coalesceKey: "drag" })

  assert.equal(store.getState().panels[0].val, 3)

  store.undo() // undoes the whole coalesced "drag" in one step
  assert.deepEqual(store.getState().panels, [ { id: "p1", val: 0 } ])

  store.undo() // undoes the original push
  assert.deepEqual(store.getState().panels, [])
  assert.equal(store.canUndo, false)
})

test("mutations with a different coalesceKey each start their own undo step", () => {
  const store = new DocumentStore({}, { persist: () => {}, coalesceWindowMs: 10000 })

  store.mutate((state) => { state.panels.push({ id: "p1", bright: 0, contrast: 0 }) })
  store.mutate((state) => { state.panels[0].bright = 5 }, { coalesceKey: "bright" })
  store.mutate((state) => { state.panels[0].contrast = 7 }, { coalesceKey: "contrast" })

  store.undo()
  assert.equal(store.getState().panels[0].contrast, 0)
  assert.equal(store.getState().panels[0].bright, 5, "the earlier bright-slider step is untouched")

  store.undo()
  assert.equal(store.getState().panels[0].bright, 0)
})

test("a coalesceKey does not merge once the coalesce window has elapsed", async () => {
  const store = new DocumentStore({}, { persist: () => {}, coalesceWindowMs: 10 })

  store.mutate((state) => { state.panels.push({ id: "p1", val: 0 }) })
  store.mutate((state) => { state.panels[0].val = 1 }, { coalesceKey: "drag" })

  await new Promise((resolve) => setTimeout(resolve, 20))
  store.mutate((state) => { state.panels[0].val = 2 }, { coalesceKey: "drag" })

  store.undo() // only the second, post-gap "drag" mutation undoes
  assert.equal(store.getState().panels[0].val, 1)
})

test("undo/redo history is independent per store instance (session-only, never persisted)", () => {
  const storeA = new DocumentStore({}, { persist: () => {} })
  storeA.mutate((state) => state.panels.push({ id: "p1" }))

  const storeB = new DocumentStore(storeA.getState(), { persist: () => {} })
  assert.equal(storeB.canUndo, false)
})
