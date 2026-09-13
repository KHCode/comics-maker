import { Controller } from "@hotwired/stimulus"
import { clampTextWidth, clampTextHeight, fontFamilyCss } from "kapow/text"

// How far (screen pixels — see panel_controller.js's identical PHOTO_TAP_
// THRESHOLD_PX for why this is screen-space, not page units) a pointer has
// to move during a text box's drag before it counts as an actual move
// rather than a tap that just selects it.
const TAP_THRESHOLD_PX = 6

// A text box's own skew (Narration only — see the doc: "Skewed white
// box") is a fixed per-kind constant, not a stored field, so it's applied
// here rather than in kapow/text.js alongside the stored, user-adjustable
// `rot`.
const NARRATION_SKEW_DEG = -6

// Renders Letter mode's text elements (Speech/Caption/Narration in this
// PR — Shout/SFX/Think are a later PR) as an HTML overlay, not SVG: see
// the plan's own open question on this (foreignObject's Safari
// contenteditable bugs). The overlay div (see the `layer` target) is
// positioned/scaled to sit exactly over the page's own SVG canvas via a
// single CSS transform (see updateTransform) — every text box underneath
// it is then laid out using its stored x/y/w/h/fs numbers as plain
// pixels, and that one transform converts "page units" into real screen
// pixels uniformly, the same way the SVG's own viewBox does for its
// content. That means this controller never needs to re-derive per-box
// pixel positions on resize, only the one shared transform.
//
// Like panel_controller.js's photo pan/scale gestures, drags here
// live-update the DOM directly and only commit through the document store
// (the single mutation path) on release.
export default class extends Controller {
  static targets = [ "canvas", "layer" ]

  connect() {
    if (!this.documentStoreController) {
      console.error("text_controller: no document-store controller found on this element")
      return
    }

    this.selectedTextId = null
    this.editingTextId = null
    this.scaleX = 1
    this.scaleY = 1

    // The layer's transform only needs recomputing when the SVG's own
    // rendered box actually changes size — a plain resize, or Draw mode's
    // focus zoom growing/shrinking it (see panel_controller.js#focusPanel/
    // exitFocus) — not on every scroll (the layer scrolls for free as an
    // absolutely-positioned child of this same, non-fixed .page element).
    this.resizeObserver = new ResizeObserver(() => this.updateTransform())
    this.resizeObserver.observe(this.canvasTarget)

    this.updateTransform()
    this.renderAll(this.currentTexts)
  }

  disconnect() {
    this.resizeObserver?.disconnect()
  }

  refresh(event) {
    this.renderAll(event.detail.state.texts)
  }

  // Draw mode's zoomed-in focus view repurposes the SVG's own rendered box
  // for a single panel (see panel_controller.js), which this layer's
  // transform isn't tracking (Letter mode has no such focus concept of its
  // own) — simplest to just hide the whole layer for the duration rather
  // than have it show stale/misplaced text boxes over the zoomed panel.
  hide() {
    this.layerTarget.hidden = true
  }

  show() {
    this.layerTarget.hidden = false
    this.updateTransform()
  }

  // Called by editor_controller.js's switchMode whenever any mode switch
  // happens (mirroring panelController's own deselect there) so a
  // selection (and its resize handle) doesn't linger visible after
  // leaving Letter mode.
  deselect() {
    if (!this.selectedTextId) return
    this.selectedTextId = null
    this.renderAll(this.currentTexts)
  }

  // Clicking the empty page background (not any text box) deselects —
  // wired alongside panel_controller's own identical check on the same
  // pointerdown (see the canvas element's data-action list).
  deselectOnBackgroundPointerDown(event) {
    if (event.target !== this.canvasTarget) return
    this.deselect()
  }

  updateTransform() {
    const svgRect = this.canvasTarget.getBoundingClientRect()
    const pageRect = this.element.getBoundingClientRect()
    const viewBox = this.canvasTarget.viewBox.baseVal
    if (!svgRect.width || !svgRect.height || !viewBox.width || !viewBox.height) return

    this.scaleX = svgRect.width / viewBox.width
    this.scaleY = svgRect.height / viewBox.height
    const offsetX = svgRect.left - pageRect.left
    const offsetY = svgRect.top - pageRect.top

    this.layerTarget.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${this.scaleX}, ${this.scaleY})`
  }

  renderAll(texts) {
    this.layerTarget.replaceChildren()
    for (const text of texts) this.renderText(text)
  }

  renderText(text) {
    const box = document.createElement("div")
    box.className = `text-box text-box--${text.kind}`
    box.classList.toggle("text-box--selected", text.id === this.selectedTextId)
    box.dataset.textId = text.id
    box.style.left = `${text.x}px`
    box.style.top = `${text.y}px`
    box.style.width = `${text.w}px`
    box.style.height = `${text.h}px`
    box.style.fontSize = `${text.fs}px`
    box.style.fontFamily = fontFamilyCss(text.font)
    box.style.fontWeight = text.bold ? "700" : "400"
    box.style.fontStyle = text.italic ? "italic" : "normal"
    if (text.color) box.style.color = text.color

    const skew = text.kind === "narration" ? `skewX(${NARRATION_SKEW_DEG}deg)` : ""
    const rotate = text.rot ? `rotate(${text.rot}deg)` : ""
    box.style.transform = [ rotate, skew ].filter(Boolean).join(" ")

    const content = document.createElement("div")
    content.className = "text-box-content"
    content.textContent = text.text
    content.contentEditable = text.id === this.editingTextId ? "true" : "false"
    if (text.kind === "narration") content.style.transform = `skewX(${-NARRATION_SKEW_DEG}deg)`
    box.appendChild(content)

    if (text.id === this.selectedTextId) {
      const handle = document.createElement("div")
      handle.className = "text-handle"
      handle.addEventListener("pointerdown", (event) => this.startResize(event, text.id))
      box.appendChild(handle)
    }

    box.addEventListener("pointerdown", (event) => this.startMove(event, text.id))
    box.addEventListener("dblclick", (event) => this.startEditing(event, text.id))

    this.layerTarget.appendChild(box)
  }

  // Toggles selected/handle state on the existing box elements in place,
  // without tearing any of them down — see startMove's tap branch for why
  // that matters for double-click.
  updateSelectionUI() {
    this.layerTarget.querySelectorAll(".text-box").forEach((box) => {
      const isSelected = box.dataset.textId === this.selectedTextId
      box.classList.toggle("text-box--selected", isSelected)
      const existingHandle = box.querySelector(".text-handle")
      if (isSelected && !existingHandle) {
        const handle = document.createElement("div")
        handle.className = "text-handle"
        handle.addEventListener("pointerdown", (event) => this.startResize(event, box.dataset.textId))
        box.appendChild(handle)
      } else if (!isSelected && existingHandle) {
        existingHandle.remove()
      }
    })
  }

  startMove(event, textId) {
    if (this.currentMode !== "letter") return
    if (this.editingTextId === textId) return // let contenteditable handle its own clicks/caret placement
    event.stopPropagation()

    const text = this.currentTexts.find((t) => t.id === textId)
    if (!text) return

    const box = this.layerTarget.querySelector(`.text-box[data-text-id="${textId}"]`)
    const startClientX = event.clientX
    const startClientY = event.clientY
    const originalX = text.x
    const originalY = text.y
    let lastX = originalX
    let lastY = originalY
    let moved = false

    const onMove = (moveEvent) => {
      if (Math.hypot(moveEvent.clientX - startClientX, moveEvent.clientY - startClientY) > TAP_THRESHOLD_PX) {
        moved = true
      }
      lastX = originalX + (moveEvent.clientX - startClientX) / this.scaleX
      lastY = originalY + (moveEvent.clientY - startClientY) / this.scaleY
      if (box) {
        box.style.left = `${lastX}px`
        box.style.top = `${lastY}px`
      }
    }

    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      if (moved) {
        this.documentStoreController.store.mutate((state) => {
          const target = state.texts.find((t) => t.id === textId)
          if (target) {
            target.x = lastX
            target.y = lastY
          }
        })
      } else {
        this.selectedTextId = this.selectedTextId === textId ? null : textId
        // Not a full renderAll: a native double-click is two constituent
        // clicks (each landing here, since pointerdown/pointerup is what
        // registers a tap) followed by a dblclick — rebuilding every box
        // from scratch on each of those two taps would leave the second
        // tap's own dblclick target a detached, about-to-be-replaced node,
        // silently swallowing the double-click. Updating the existing
        // nodes in place keeps them live across the whole gesture.
        this.updateSelectionUI()
      }
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  // The one resize handle (bottom-right corner — see kapow/text.js's
  // resizedSize) only ever shows on the selected box, so this can't fire
  // outside Letter mode: selection itself is only reachable from
  // startMove, which already gates on currentMode.
  startResize(event, textId) {
    event.stopPropagation()
    event.preventDefault()

    const text = this.currentTexts.find((t) => t.id === textId)
    if (!text) return

    const box = this.layerTarget.querySelector(`.text-box[data-text-id="${textId}"]`)
    const startClientX = event.clientX
    const startClientY = event.clientY
    const originalW = text.w
    const originalH = text.h
    let lastW = originalW
    let lastH = originalH

    const onMove = (moveEvent) => {
      const dx = (moveEvent.clientX - startClientX) / this.scaleX
      const dy = (moveEvent.clientY - startClientY) / this.scaleY
      lastW = clampTextWidth(originalW + dx)
      lastH = clampTextHeight(originalH + dy)
      if (box) {
        box.style.width = `${lastW}px`
        box.style.height = `${lastH}px`
      }
    }

    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      this.documentStoreController.store.mutate((state) => {
        const target = state.texts.find((t) => t.id === textId)
        if (target) {
          target.w = lastW
          target.h = lastH
        }
      })
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  startEditing(event, textId) {
    if (this.currentMode !== "letter") return
    event.stopPropagation()

    this.editingTextId = textId
    this.selectedTextId = textId
    this.renderAll(this.currentTexts)

    const content = this.layerTarget.querySelector(`.text-box[data-text-id="${textId}"] .text-box-content`)
    if (!content) return

    content.focus()
    const range = document.createRange()
    range.selectNodeContents(content)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)

    content.addEventListener("blur", () => this.commitEditing(textId, content.textContent), { once: true })
  }

  commitEditing(textId, newText) {
    this.editingTextId = null
    this.documentStoreController.store.mutate((state) => {
      const target = state.texts.find((t) => t.id === textId)
      if (target) target.text = newText
    })
  }

  get currentMode() {
    return this.editorElement?.dataset.editorModeValue || "layout"
  }

  get editorElement() {
    if (!this._editorElement) {
      this._editorElement = this.element.closest('[data-controller~="editor"]')
    }
    return this._editorElement
  }

  get currentTexts() {
    return this.documentStoreController.store.getState().texts
  }

  get documentStoreController() {
    return this.application.getControllerForElementAndIdentifier(this.element, "document-store")
  }
}
