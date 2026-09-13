// Pure helpers for Phase 9's per-page PNG export. The actual rasterization
// (cloning the page's SVG + HTML text overlay, embedding styles, drawing
// through an off-screen <canvas>) is inherently DOM/browser-API-bound —
// see editor_controller.js#exportPage — so it isn't a good fit for this
// framework-agnostic module the way kapow/text.js's geometry is. This one
// just covers the bit that's plain string logic and worth unit testing on
// its own: turning a project/page name into a safe download filename.

export function sanitizeFilenameSegment(name) {
  const cleaned = (name ?? "").trim().replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return cleaned || "untitled"
}

export function exportFilename(projectName, pageName) {
  return `${sanitizeFilenameSegment(projectName)}-${sanitizeFilenameSegment(pageName)}.png`
}
