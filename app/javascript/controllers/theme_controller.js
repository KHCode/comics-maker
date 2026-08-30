import { Controller } from "@hotwired/stimulus"

// Dark mode toggle. The explicit choice ("light"/"dark") is persisted in
// localStorage as a data-theme attribute on <html>; with nothing set, the
// app follows the OS-level prefers-color-scheme (see application.css).
export default class extends Controller {
  toggle() {
    const root = document.documentElement
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    const currentlyDark = root.dataset.theme ? root.dataset.theme === "dark" : prefersDark
    const next = currentlyDark ? "light" : "dark"

    root.dataset.theme = next
    localStorage.setItem("kapow.theme", next)
  }
}
