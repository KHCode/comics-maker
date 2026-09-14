import { Controller } from "@hotwired/stimulus"
import { DirectUpload } from "@rails/activestorage"

// Generates a small snapshot of the first page and attaches it to the
// project as its thumbnail (see Project#thumbnail) whenever Save/Save As
// is actually submitted — not on every autosave PATCH (document_store.js
// already debounces those continuously; snapshotting on every one of them
// would be both wasteful and a poor match for "what did this comic look
// like as of my last deliberate save"). Reuses the editor's own per-page
// rasterization pipeline (see editor_controller.js#renderThumbnailBlob)
// rather than duplicating any of that SVG-building logic here.
export default class extends Controller {
  static targets = [ "form", "thumbnailField" ]

  connect() {
    this.submitting = false
  }

  // Intercepts the form's first submit to render+upload a thumbnail, then
  // resubmits programmatically once that's done (or has failed) — the
  // `submitting` guard lets that resubmission's own "submit" event through
  // instead of intercepting itself again.
  submit(event) {
    if (this.submitting) return

    event.preventDefault()
    this.submitting = true
    this.generateThumbnailAndSubmit(event.submitter)
  }

  async generateThumbnailAndSubmit(submitter) {
    try {
      const blob = await this.editorController?.renderThumbnailBlob()
      if (blob) await this.uploadThumbnail(blob)
    } catch (error) {
      // A slow or failed thumbnail render/upload should never block an
      // actual Save — the project just keeps whatever thumbnail (or lack
      // of one) it already had.
      console.error("Kapow: thumbnail generation failed, saving without updating it", error)
    }
    this.formTarget.requestSubmit(submitter)
  }

  uploadThumbnail(blob) {
    // DirectUpload reads its filename straight off the given object's own
    // `.name` — a plain Blob (what canvas.toBlob produces) has none, which
    // otherwise reaches the server as a literal missing/undefined filename
    // and blows up in ActiveStorage::Blob.create_before_direct_upload!.
    const file = new File([ blob ], "thumbnail.jpg", { type: blob.type })

    return new Promise((resolve) => {
      const upload = new DirectUpload(file, this.editorController.directUploadUrl)
      upload.create((error, uploadedBlob) => {
        if (error) {
          console.error("Kapow: thumbnail upload failed", error)
        } else {
          this.thumbnailFieldTarget.value = uploadedBlob.signed_id
        }
        resolve()
      })
    })
  }

  get editorController() {
    const editorElement = this.element.closest('[data-controller~="editor"]')
    return editorElement && this.application.getControllerForElementAndIdentifier(editorElement, "editor")
  }
}
