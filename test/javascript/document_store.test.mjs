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
