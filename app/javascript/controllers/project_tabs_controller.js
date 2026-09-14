import { Controller } from "@hotwired/stimulus"

// "My Comics" + one tab per folder on the Projects screen (see
// projects/index.html.erb) — every folder and its contents are pre-
// rendered right here, so switching tabs never leaves the page. Same
// plain show/hide toggle idiom as the editor's own mode-tabs
// (editor_controller.js#switchMode), just standalone.
export default class extends Controller {
  static targets = [ "tab", "panel" ]

  select(event) {
    this.show(event.currentTarget.dataset.tab)
  }

  show(tabName) {
    this.tabTargets.forEach((tab) => {
      tab.classList.toggle("project-tab--active", tab.dataset.tab === tabName)
    })
    this.panelTargets.forEach((panel) => {
      panel.hidden = panel.dataset.tab !== tabName
    })
  }
}
