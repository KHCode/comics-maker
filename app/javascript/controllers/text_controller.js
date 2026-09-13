import { Controller } from "@hotwired/stimulus"
import {
  clampTextWidth,
  clampTextHeight,
  clampFontSize,
  rotateStep,
  tailTriangle,
  fontFamilyCss,
  FONT_SIZE_STEP,
  FONT_CHOICES
} from "kapow/text"

const SVG_NS = "http://www.w3.org/2000/svg"

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

// Floating bar layout — matches panel_controller.js's own BAR_BUTTON_SIZE/
// GAP/MARGIN_ABOVE for visual consistency (Letter mode never zooms the
// page the way Draw mode's panel-focus does, so a plain page-unit size
// looks right here for the same reason it does for panel's own bar).
const BAR_BUTTON_SIZE = 44
const BAR_ROW_GAP = 6
// Rough two-row height, used only to keep the bar from floating off the
// top of the page for a very-high text element — not pixel-exact (an HTML
// flex row's real width/height isn't known until it's actually laid out,
// unlike panel's fixed-width SVG rects), and doesn't need to be.
const BAR_ESTIMATED_HEIGHT = BAR_BUTTON_SIZE * 2 + BAR_ROW_GAP
const BAR_MARGIN_ABOVE = 12

const TAIL_HANDLE_SIZE = 18

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

    this.boundHandleKeydown = this.handleKeydown.bind(this)
    document.addEventListener("keydown", this.boundHandleKeydown)

    this.updateTransform()
    this.renderAll(this.currentTexts)
  }

  disconnect() {
    this.resizeObserver?.disconnect()
    document.removeEventListener("keydown", this.boundHandleKeydown)
  }

  // Mirrors panel_controller.js's identical Delete/Backspace handling.
  handleKeydown(event) {
    if (this.currentMode !== "letter") return
    if (!this.selectedTextId) return
    if (event.key !== "Delete" && event.key !== "Backspace") return
    if (this.isEditableTarget(event.target)) return

    event.preventDefault()
    this.deleteText(this.selectedTextId)
  }

  isEditableTarget(target) {
    return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable
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
    for (const text of texts) {
      this.renderText(text)
      this.renderTailShape(text)
      if (text.id === this.selectedTextId) this.renderTailHandle(text)
    }
    this.renderFloatingBar(texts.find((t) => t.id === this.selectedTextId))
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

  // The pointed tail (Speech only, for now) is part of the bubble's
  // permanent rendering, not selection-dependent — only its draggable
  // handle dot (see renderTailHandle) is selection-gated, same as the
  // resize handle.
  renderTailShape(text) {
    const points = tailTriangle(text)
    if (!points) return

    const xs = points.map(([ x ]) => x)
    const ys = points.map(([ , y ]) => y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)

    const svg = document.createElementNS(SVG_NS, "svg")
    svg.setAttribute("class", "text-tail-shape")
    svg.dataset.textId = text.id
    svg.style.left = `${minX}px`
    svg.style.top = `${minY}px`
    svg.setAttribute("width", Math.max(...xs) - minX)
    svg.setAttribute("height", Math.max(...ys) - minY)

    const polygon = document.createElementNS(SVG_NS, "polygon")
    polygon.setAttribute("points", points.map(([ x, y ]) => `${x - minX},${y - minY}`).join(" "))
    svg.appendChild(polygon)

    this.layerTarget.appendChild(svg)
  }

  renderTailHandle(text) {
    if (!text.tail) return

    const [ tx, ty ] = text.tail
    const handle = document.createElement("div")
    handle.className = "text-tail-handle"
    handle.dataset.textId = text.id
    handle.style.left = `${tx}px`
    handle.style.top = `${ty}px`
    handle.addEventListener("pointerdown", (event) => this.startTailDrag(event, text.id))

    this.layerTarget.appendChild(handle)
  }

  // Rebuilds the floating bar (A-/A+, rotate, delete, font/bold/italic)
  // for whichever text is currently selected, or removes it if nothing is.
  renderFloatingBar(text) {
    this.layerTarget.querySelector(".text-floating-bar")?.remove()
    if (!text) return

    const bar = document.createElement("div")
    bar.className = "text-floating-bar"

    const row1 = document.createElement("div")
    row1.className = "text-floating-bar-row"
    ;[
      [ "decreaseFontSize", "A−" ],
      [ "increaseFontSize", "A+" ],
      [ "rotateCCW", "↺" ],
      [ "rotateCW", "↻" ],
      [ "delete", "🗑" ]
    ].forEach(([ action, label ]) => row1.appendChild(this.floatingBarButton(action, label, text.id)))
    bar.appendChild(row1)

    const row2 = document.createElement("div")
    row2.className = "text-floating-bar-row"
    FONT_CHOICES.forEach((font) => {
      const button = this.floatingBarButton(`font:${font}`, font[0].toUpperCase() + font.slice(1), text.id)
      button.classList.toggle("floating-bar-button--active", text.font === font)
      row2.appendChild(button)
    })
    const boldButton = this.floatingBarButton("bold", "B", text.id)
    boldButton.classList.toggle("floating-bar-button--active", !!text.bold)
    row2.appendChild(boldButton)
    const italicButton = this.floatingBarButton("italic", "I", text.id)
    italicButton.classList.toggle("floating-bar-button--active", !!text.italic)
    row2.appendChild(italicButton)
    bar.appendChild(row2)

    this.layerTarget.appendChild(bar)
    this.positionFloatingBar(bar, text)
  }

  floatingBarButton(action, label, textId) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "floating-bar-button"
    button.textContent = label
    // Buttons live inside the same overlay as the draggable box — without
    // this, a pointerdown on a button would also be seen by the box
    // underneath as the start of a move gesture.
    button.addEventListener("pointerdown", (event) => event.stopPropagation())
    button.addEventListener("click", (event) => {
      event.stopPropagation()
      this.handleFloatingBarAction(action, textId)
    })
    return button
  }

  positionFloatingBar(bar, text) {
    const centerX = text.x + text.w / 2
    const top = Math.max(text.y - BAR_MARGIN_ABOVE - BAR_ESTIMATED_HEIGHT, 0)
    bar.style.left = `${centerX}px`
    bar.style.top = `${top}px`
  }

  handleFloatingBarAction(action, textId) {
    if (action === "delete") return this.deleteText(textId)
    if (action === "decreaseFontSize") return this.mutateText(textId, (t) => ({ ...t, fs: clampFontSize(t.fs - FONT_SIZE_STEP) }))
    if (action === "increaseFontSize") return this.mutateText(textId, (t) => ({ ...t, fs: clampFontSize(t.fs + FONT_SIZE_STEP) }))
    if (action === "rotateCCW") return this.mutateText(textId, (t) => ({ ...t, rot: rotateStep(t.rot, -1) }))
    if (action === "rotateCW") return this.mutateText(textId, (t) => ({ ...t, rot: rotateStep(t.rot, 1) }))
    if (action === "bold") return this.mutateText(textId, (t) => ({ ...t, bold: !t.bold }))
    if (action === "italic") return this.mutateText(textId, (t) => ({ ...t, italic: !t.italic }))
    if (action.startsWith("font:")) return this.mutateText(textId, (t) => ({ ...t, font: action.slice(5) }))
  }

  mutateText(textId, computeNewText) {
    this.documentStoreController.store.mutate((state) => {
      const index = state.texts.findIndex((t) => t.id === textId)
      if (index !== -1) state.texts[index] = computeNewText(state.texts[index])
    })
  }

  deleteText(textId) {
    this.selectedTextId = null
    this.documentStoreController.store.mutate((state) => {
      state.texts = state.texts.filter((t) => t.id !== textId)
    })
  }

  // Toggles selected/handle state on the existing box elements in place,
  // without tearing any of them down — see startMove's tap branch for why
  // that matters for double-click. The floating bar and tail handle (both
  // cheap, detached from the box elements themselves) are simply rebuilt.
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

    // Rebuilt rather than merely toggled visible: startMove/startResize
    // hide these (see hideAuxiliaryElements) rather than remove them, so a
    // tap that turns out to be a no-op drag still needs them replaced,
    // not just un-hidden.
    const texts = this.currentTexts
    this.layerTarget.querySelectorAll(".text-tail-shape").forEach((el) => el.remove())
    texts.forEach((text) => this.renderTailShape(text))

    this.layerTarget.querySelector(".text-tail-handle")?.remove()
    const selectedText = texts.find((t) => t.id === this.selectedTextId)
    if (selectedText?.tail) this.renderTailHandle(selectedText)
    this.renderFloatingBar(selectedText)
  }

  startMove(event, textId) {
    if (this.currentMode !== "letter") return
    if (this.editingTextId === textId) return // let contenteditable handle its own clicks/caret placement
    event.stopPropagation()

    const text = this.currentTexts.find((t) => t.id === textId)
    if (!text) return

    // The tail's own base is anchored to this box's bottom-center (see
    // kapow/text.js#tailTriangle) and the floating bar to its top, so
    // either would need repositioning on every move frame too — simplest
    // to just hide them for the gesture's duration (same tradeoff as
    // panel_controller.js's photo-pan handles) and let them reappear,
    // freshly positioned, once the drag/tap settles below.
    this.hideAuxiliaryElements(textId)

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

    this.hideAuxiliaryElements(textId)

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

  hideAuxiliaryElements(textId) {
    this.layerTarget
      .querySelectorAll(`.text-tail-shape[data-text-id="${textId}"], .text-tail-handle[data-text-id="${textId}"]`)
      .forEach((el) => { el.style.display = "none" })
    this.layerTarget.querySelector(".text-floating-bar")?.style.setProperty("display", "none")
  }

  // The tail dot's own drag doesn't need to hide anything else — unlike
  // move/resize, dragging the tail only ever affects the tail shape
  // itself, so it can live-update in place every frame instead.
  startTailDrag(event, textId) {
    event.stopPropagation()
    event.preventDefault()

    const text = this.currentTexts.find((t) => t.id === textId)
    if (!text?.tail) return

    const startClientX = event.clientX
    const startClientY = event.clientY
    const [ originalTx, originalTy ] = text.tail
    let lastTx = originalTx
    let lastTy = originalTy

    const onMove = (moveEvent) => {
      lastTx = originalTx + (moveEvent.clientX - startClientX) / this.scaleX
      lastTy = originalTy + (moveEvent.clientY - startClientY) / this.scaleY
      this.updateTailPreview(textId, lastTx, lastTy)
    }

    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      this.documentStoreController.store.mutate((state) => {
        const target = state.texts.find((t) => t.id === textId)
        if (target) target.tail = [ lastTx, lastTy ]
      })
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  updateTailPreview(textId, tx, ty) {
    const text = this.currentTexts.find((t) => t.id === textId)
    if (!text) return

    this.layerTarget.querySelector(`.text-tail-shape[data-text-id="${textId}"]`)?.remove()
    this.renderTailShape({ ...text, tail: [ tx, ty ] })

    const handle = this.layerTarget.querySelector(`.text-tail-handle[data-text-id="${textId}"]`)
    if (handle) {
      handle.style.left = `${tx}px`
      handle.style.top = `${ty}px`
    }
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
