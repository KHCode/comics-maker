import { Controller } from "@hotwired/stimulus"

// Editor shell: switches which mode tab is active and which contextual
// tray is shown. No editing behavior yet — that arrives with Layout/Draw/
// Letter mode in later PRs.
export default class extends Controller {
  static targets = ["tab", "tray"]

  switchMode(event) {
    const mode = event.currentTarget.dataset.mode

    this.tabTargets.forEach((tab) => {
      tab.classList.toggle("mode-tab--active", tab.dataset.mode === mode)
    })

    this.trayTargets.forEach((tray) => {
      tray.hidden = tray.dataset.mode !== mode
    })
  }
}
