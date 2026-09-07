import { Controller } from "@hotwired/stimulus"

// Generic modal wrapper around the native <dialog> element, reusable
// anywhere a trigger + dialog need open/close wiring:
//
//   <div data-controller="modal">
//     <button data-action="modal#open">Open</button>
//     <dialog data-modal-target="dialog" data-action="click->modal#closeOnBackdrop">
//       ...
//       <button type="button" data-action="modal#close">Cancel</button>
//     </dialog>
//   </div>
//
// Pass data-modal-open-value="true" to have it open itself on connect —
// e.g. after the server re-renders the page with validation errors and
// the dialog needs to reappear already open.
export default class extends Controller {
  static targets = ["dialog"]
  static values = { open: Boolean }

  connect() {
    if (this.openValue) this.open()
  }

  open() {
    if (!this.dialogTarget.open) this.dialogTarget.showModal()
  }

  close() {
    if (this.dialogTarget.open) this.dialogTarget.close()
  }

  // Close when the backdrop itself (not its content) is clicked. A native
  // <dialog>'s backdrop isn't a real child element, so a click landing on
  // it reports event.target as the dialog itself.
  closeOnBackdrop(event) {
    if (event.target === this.dialogTarget) this.close()
  }
}
