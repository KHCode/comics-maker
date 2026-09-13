// Run with: node test/javascript/export.test.mjs

import test from "node:test"
import assert from "node:assert/strict"
import { sanitizeFilenameSegment, exportFilename } from "../../app/javascript/kapow/export.js"

test("sanitizeFilenameSegment replaces runs of non-alphanumeric characters with a single hyphen", () => {
  assert.equal(sanitizeFilenameSegment("My Cool Comic!!"), "My-Cool-Comic")
  assert.equal(sanitizeFilenameSegment("Page 1"), "Page-1")
})

test("sanitizeFilenameSegment trims leading/trailing hyphens left by stripped punctuation", () => {
  assert.equal(sanitizeFilenameSegment("  ~Weird Name~  "), "Weird-Name")
})

test("sanitizeFilenameSegment falls back to 'untitled' for empty/blank/fully-stripped input", () => {
  assert.equal(sanitizeFilenameSegment(""), "untitled")
  assert.equal(sanitizeFilenameSegment("   "), "untitled")
  assert.equal(sanitizeFilenameSegment("!!!"), "untitled")
  assert.equal(sanitizeFilenameSegment(undefined), "untitled")
  assert.equal(sanitizeFilenameSegment(null), "untitled")
})

test("exportFilename joins the sanitized project and page names with a .png extension", () => {
  assert.equal(exportFilename("My Comic", "Page 1"), "My-Comic-Page-1.png")
})

test("exportFilename tolerates missing project/page names", () => {
  assert.equal(exportFilename(undefined, undefined), "untitled-untitled.png")
})
