import { Controller } from "@hotwired/stimulus"
import {
  clampTextWidth,
  clampTextHeight,
  clampFontSize,
  rotateStep,
  speechBubblePath,
  shoutStarPath,
  tailedShapeBounds,
  tailShaftMidpoint,
  fontFamilyCss,
  FONT_SIZE_STEP,
  FONT_CHOICES,
  SFX_COLORS
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

// Renders Letter mode's text elements (Speech/Caption/Narration/Shout/SFX
// — Think is a later PR) as an HTML overlay, not SVG: see
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
    // Whether the floating bar is currently open for the selected text —
    // starts (and resets to) false: it's opened explicitly via the small
    // toggle icon on the selected box (see renderSelectionControls),
    // rather than automatically whenever something is selected.
    this.floatingBarVisible = false
    // Two independent reasons the whole layer can be hidden — Draw mode's
    // panel-zoom (see hide/show) and Layout mode's own "see the panels
    // plainly" toggle (see setForceHidden) — tracked separately so one
    // doesn't clobber the other (see updateLayerVisibility).
    this.focusHidden = false
    this.forceHidden = false
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

    // Capture phase (the `true` below), not bubble: a panel sitting under
    // a text element stops propagation as the very first thing its own
    // pointerdown handler does (see panel_controller.js#
    // handlePanelPointerDown), so a bubble-phase listener here would
    // never even see a click that lands on a panel underneath a text box
    // — which was the bug this fixes (deselecting text required clicking
    // truly empty page background, not just "anywhere outside the text").
    // Capture listeners run top-down before any descendant gets a chance
    // to stop propagation, so this always sees the click regardless of
    // what's underneath it.
    this.boundHandlePointerDownCapture = this.handlePointerDownCapture.bind(this)
    this.element.addEventListener("pointerdown", this.boundHandlePointerDownCapture, true)

    this.updateTransform()
    this.renderAll(this.currentTexts)
  }

  disconnect() {
    this.resizeObserver?.disconnect()
    document.removeEventListener("keydown", this.boundHandleKeydown)
    this.element.removeEventListener("pointerdown", this.boundHandlePointerDownCapture, true)
  }

  // Any pointerdown, anywhere on the page, that isn't on a text box or one
  // of its own controls (handles, floating bar, its toggle) deselects the
  // current text — including one that a panel/photo/ink handler elsewhere
  // goes on to stop propagation of and handle in its own way, since this
  // runs first (see the capture-phase registration in connect()).
  handlePointerDownCapture(event) {
    if (event.target.closest(".text-box, .text-handle, .text-tail-handle, .text-tail-shaft-handle, .text-bar-toggle, .text-floating-bar")) {
      return
    }
    this.deselect()
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
    this.focusHidden = true
    this.updateLayerVisibility()
  }

  show() {
    this.focusHidden = false
    this.updateLayerVisibility()
    this.updateTransform()
  }

  // Layout mode's "Hide text"/"Show text" toggle (see editor_controller.js
  // #toggleTextsVisibility) — independent of hide()/show() above, so
  // toggling this doesn't fight with Draw mode's own focus-driven hiding.
  setForceHidden(hidden) {
    this.forceHidden = hidden
    this.updateLayerVisibility()
  }

  updateLayerVisibility() {
    this.layerTarget.hidden = this.focusHidden || this.forceHidden
  }

  // Called by editor_controller.js's switchMode whenever any mode switch
  // happens (mirroring panelController's own deselect there) so a
  // selection (and its resize handle) doesn't linger visible after
  // leaving Letter mode.
  deselect() {
    // Otherwise this method's own renderAll below destroys the currently-
    // editing box's contenteditable div before the browser gets a chance
    // to fire its blur (see startEditing's blur listener, which is what
    // normally commits it) — silently discarding whatever was just typed.
    // This was a real bug: clicking away from a speech bubble mid-edit
    // lost the text entirely rather than saving it.
    this.commitPendingEdit()

    if (!this.selectedTextId) return
    this.selectedTextId = null
    this.floatingBarVisible = false
    this.renderAll(this.currentTexts)
    this.dispatch("selectionChanged", { bubbles: true })
  }

  // Reads whatever's currently typed in the box being edited (if any) and
  // saves it immediately, rather than relying solely on that box's own
  // blur event — needed anywhere a re-render might tear down the
  // in-progress edit's DOM node before blur would otherwise fire (see
  // deselect above).
  commitPendingEdit() {
    if (!this.editingTextId) return
    const textId = this.editingTextId
    const content = this.layerTarget.querySelector(`.text-box[data-text-id="${textId}"] .text-box-content`)
    if (content) this.commitEditing(textId, content.textContent)
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
      // The bubble/star shape is appended *before* the box so it paints
      // behind it — the box's own content div sits transparent on top of
      // it (see renderText), which would be backwards the other way
      // around (an opaque shape fill painting over the text).
      this.renderPathShape(text)
      this.renderText(text)
      if (text.id === this.selectedTextId) {
        this.renderTailHandle(text)
        this.renderTailShaftHandle(text)
      }
    }
    this.renderFloatingBar(this.floatingBarVisible ? texts.find((t) => t.id === this.selectedTextId) : null)
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

    if (text.id === this.selectedTextId) this.appendSelectionControls(box, text.id)

    box.addEventListener("pointerdown", (event) => this.startMove(event, text.id))
    box.addEventListener("dblclick", (event) => this.startEditing(event, text.id))

    this.layerTarget.appendChild(box)
  }

  // The resize handle and the floating-bar toggle icon both live as
  // children of the box itself (rather than layer-level siblings, like
  // the tail handles) so they move for free with it during a drag,
  // without any extra positioning logic.
  appendSelectionControls(box, textId) {
    const resizeHandle = document.createElement("div")
    resizeHandle.className = "text-handle"
    resizeHandle.addEventListener("pointerdown", (event) => this.startResize(event, textId))
    box.appendChild(resizeHandle)

    const barToggle = document.createElement("button")
    barToggle.type = "button"
    barToggle.className = "text-bar-toggle"
    barToggle.textContent = "⋯"
    barToggle.setAttribute("aria-label", "Toggle style toolbar")
    barToggle.addEventListener("pointerdown", (event) => event.stopPropagation())
    barToggle.addEventListener("click", (event) => {
      event.stopPropagation()
      this.toggleFloatingBar(textId)
    })
    box.appendChild(barToggle)
  }

  toggleFloatingBar(textId) {
    if (this.selectedTextId !== textId) return
    this.floatingBarVisible = !this.floatingBarVisible
    this.updateSelectionUI()
  }

  // Speech's combined bubble+tail outline (kapow/text.js#speechBubblePath)
  // or Shout's combined star+tail outline (#shoutStarPath) — a no-op for
  // every other kind, which has no body shape of its own and renders as a
  // plain CSS box instead (see .text-box--caption/--narration/--sfx).
  pathDataFor(text) {
    if (text.kind === "speech") return speechBubblePath(text)
    if (text.kind === "shout") return shoutStarPath(text)
    return null
  }

  renderPathShape(text) {
    const pathData = this.pathDataFor(text)
    if (!pathData) return

    const { minX, minY, maxX, maxY } = tailedShapeBounds(text)
    const svg = document.createElementNS(SVG_NS, "svg")
    svg.setAttribute("class", `text-shape text-shape--${text.kind}`)
    svg.dataset.textId = text.id
    svg.style.left = `${minX}px`
    svg.style.top = `${minY}px`
    svg.setAttribute("width", maxX - minX)
    svg.setAttribute("height", maxY - minY)
    svg.setAttribute("viewBox", `${minX} ${minY} ${maxX - minX} ${maxY - minY}`)

    const path = document.createElementNS(SVG_NS, "path")
    path.setAttribute("d", pathData)
    svg.appendChild(path)

    this.layerTarget.appendChild(svg)
  }

  // Live-updates the shape mid-gesture (move/resize/tail-drag) by
  // recomputing it from `overrides` merged onto the text's last-known
  // state, rather than hiding it for the gesture's duration the way the
  // small handles/floating bar are (see hideAuxiliaryElements) — a single
  // path recompute is cheap, and seeing the shape (the visually
  // important part) track the drag live matters more here than it did
  // for 8 separate photo-resize handles.
  updatePathShapePreview(textId, overrides) {
    const text = this.currentTexts.find((t) => t.id === textId)
    if (!text) return
    const merged = { ...text, ...overrides }
    if (!this.pathDataFor(merged)) return

    this.layerTarget.querySelector(`.text-shape[data-text-id="${textId}"]`)?.remove()
    this.renderPathShape(merged)
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

  // The "move both together" handle (see startBothDrag) — a diamond dot
  // roughly midway along the tail's own shaft, visually distinct from the
  // round tail-tip dot and the square resize handle.
  renderTailShaftHandle(text) {
    const midpoint = tailShaftMidpoint(text)
    if (!midpoint) return

    const [ mx, my ] = midpoint
    const handle = document.createElement("div")
    handle.className = "text-tail-shaft-handle"
    handle.dataset.textId = text.id
    handle.style.left = `${mx}px`
    handle.style.top = `${my}px`
    handle.addEventListener("pointerdown", (event) => this.startBothDrag(event, text.id))

    this.layerTarget.appendChild(handle)
  }

  // Rebuilds the floating bar (A-/A+, rotate, delete, font/bold/italic,
  // plus an SFX-only color row) for whichever text is currently selected,
  // or removes it if nothing is selected (or the bar's been toggled
  // closed — see toggleFloatingBar).
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

    // SFX only: a 7-swatch color row recoloring the outlined display text
    // (see the doc) — no other kind lets the user pick its color at all.
    if (text.kind === "sfx") {
      const row3 = document.createElement("div")
      row3.className = "text-floating-bar-row"
      SFX_COLORS.forEach((hex) => {
        const swatch = this.colorSwatchButton(hex, text.id)
        swatch.classList.toggle("floating-bar-swatch--active", text.color === hex)
        row3.appendChild(swatch)
      })
      bar.appendChild(row3)
    }

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

  colorSwatchButton(hex, textId) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "floating-bar-swatch"
    button.style.backgroundColor = hex
    button.setAttribute("aria-label", `Color ${hex}`)
    button.addEventListener("pointerdown", (event) => event.stopPropagation())
    button.addEventListener("click", (event) => {
      event.stopPropagation()
      this.handleFloatingBarAction(`color:${hex}`, textId)
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
    if (action.startsWith("color:")) return this.mutateText(textId, (t) => ({ ...t, color: action.slice(6) }))
  }

  mutateText(textId, computeNewText) {
    this.documentStoreController.store.mutate((state) => {
      const index = state.texts.findIndex((t) => t.id === textId)
      if (index !== -1) state.texts[index] = computeNewText(state.texts[index])
    })
  }

  deleteText(textId) {
    this.selectedTextId = null
    this.floatingBarVisible = false
    this.documentStoreController.store.mutate((state) => {
      state.texts = state.texts.filter((t) => t.id !== textId)
    })
    this.dispatch("selectionChanged", { bubbles: true })
  }

  // Same z-order model as panel_controller.js's bringToFront/sendToBack:
  // stacking is just the texts array's own order (later paints on top),
  // so "layer" actions just move the selected text to the other end of
  // that array. Called from editor_controller.js's Letter-tray button
  // (per the doc's layering feature living in the tool panel, not a
  // per-text floating-bar button).
  toggleLayerPosition() {
    if (!this.selectedTextId) return
    const textId = this.selectedTextId

    this.documentStoreController.store.mutate((state) => {
      const index = state.texts.findIndex((t) => t.id === textId)
      if (index === -1) return
      const [ text ] = state.texts.splice(index, 1)
      if (index === state.texts.length) {
        state.texts.unshift(text)
      } else {
        state.texts.push(text)
      }
    })
  }

  get isSelectedTextFrontmost() {
    const texts = this.currentTexts
    return texts.length > 0 && texts[texts.length - 1].id === this.selectedTextId
  }

  // Toggles selected/handle state on the existing box elements in place,
  // without tearing any of them down — see startMove's tap branch for why
  // that matters for double-click. Everything else selection-dependent
  // (tail handles, floating bar) is simply rebuilt — none of it is a
  // child of the box, so nothing here risks orphaning a live gesture.
  updateSelectionUI() {
    this.layerTarget.querySelectorAll(".text-box").forEach((box) => {
      const isSelected = box.dataset.textId === this.selectedTextId
      box.classList.toggle("text-box--selected", isSelected)
      const hasControls = !!box.querySelector(".text-handle")
      if (isSelected && !hasControls) {
        this.appendSelectionControls(box, box.dataset.textId)
      } else if (!isSelected && hasControls) {
        box.querySelector(".text-handle")?.remove()
        box.querySelector(".text-bar-toggle")?.remove()
      }
    })

    const texts = this.currentTexts
    this.layerTarget.querySelectorAll(".text-tail-handle, .text-tail-shaft-handle").forEach((el) => el.remove())
    const selectedText = texts.find((t) => t.id === this.selectedTextId)
    if (selectedText) {
      this.renderTailHandle(selectedText)
      this.renderTailShaftHandle(selectedText)
    }
    this.renderFloatingBar(this.floatingBarVisible ? selectedText : null)
  }

  startMove(event, textId) {
    if (this.currentMode !== "letter") return
    if (this.editingTextId === textId) return // let contenteditable handle its own clicks/caret placement
    event.stopPropagation()

    const text = this.currentTexts.find((t) => t.id === textId)
    if (!text) return

    // The floating bar and tail handles aren't children of the box, so
    // they'd otherwise go stale mid-drag — simplest to hide them for the
    // gesture's duration (same tradeoff as panel_controller.js's
    // photo-pan handles) and let them reappear, freshly positioned, once
    // the drag/tap settles below. The bubble shape itself (the visually
    // important part) live-updates instead — see updatePathShapePreview.
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
      // Bubble-only move: the tail's own tip stays exactly where it was
      // (text.tail is untouched here), so the bubble visually pivots/
      // stretches away from its still-anchored tail — see the feedback
      // this was built from: "keep the end of the tail in one spot and
      // move just the bubble."
      this.updatePathShapePreview(textId, { x: lastX, y: lastY })
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
        // Any plain tap-select/deselect closes the bar — it's only opened
        // back up explicitly via the toggle icon (see toggleFloatingBar).
        this.floatingBarVisible = false
        // Not a full renderAll: a native double-click is two constituent
        // clicks (each landing here, since pointerdown/pointerup is what
        // registers a tap) followed by a dblclick — rebuilding every box
        // from scratch on each of those two taps would leave the second
        // tap's own dblclick target a detached, about-to-be-replaced node,
        // silently swallowing the double-click. Updating the existing
        // nodes in place keeps them live across the whole gesture.
        this.updateSelectionUI()
        this.dispatch("selectionChanged", { bubbles: true })
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
      this.updatePathShapePreview(textId, { w: lastW, h: lastH })
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
      .querySelectorAll(`.text-tail-handle[data-text-id="${textId}"], .text-tail-shaft-handle[data-text-id="${textId}"]`)
      .forEach((el) => { el.style.display = "none" })
    this.layerTarget.querySelector(".text-floating-bar")?.style.setProperty("display", "none")
  }

  // Tail-only move: drags just the tail tip, leaving the bubble itself in
  // place (text.x/y untouched).
  startTailDrag(event, textId) {
    event.stopPropagation()
    event.preventDefault()

    const text = this.currentTexts.find((t) => t.id === textId)
    if (!text?.tail) return

    const shaftHandle = this.layerTarget.querySelector(`.text-tail-shaft-handle[data-text-id="${textId}"]`)
    const startClientX = event.clientX
    const startClientY = event.clientY
    const [ originalTx, originalTy ] = text.tail
    let lastTx = originalTx
    let lastTy = originalTy

    const onMove = (moveEvent) => {
      lastTx = originalTx + (moveEvent.clientX - startClientX) / this.scaleX
      lastTy = originalTy + (moveEvent.clientY - startClientY) / this.scaleY
      this.updatePathShapePreview(textId, { tail: [ lastTx, lastTy ] })

      const handle = this.layerTarget.querySelector(`.text-tail-handle[data-text-id="${textId}"]`)
      if (handle) {
        handle.style.left = `${lastTx}px`
        handle.style.top = `${lastTy}px`
      }
      if (shaftHandle) {
        const midpoint = tailShaftMidpoint({ ...text, tail: [ lastTx, lastTy ] })
        if (midpoint) {
          shaftHandle.style.left = `${midpoint[0]}px`
          shaftHandle.style.top = `${midpoint[1]}px`
        }
      }
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

  // Bubble+tail together: drags both by the same delta, keeping their
  // relative offset — the third gesture the feedback asked for, alongside
  // startMove's "bubble only" and startTailDrag's "tail only".
  startBothDrag(event, textId) {
    event.stopPropagation()
    event.preventDefault()

    const text = this.currentTexts.find((t) => t.id === textId)
    if (!text?.tail) return

    this.layerTarget.querySelector(".text-floating-bar")?.style.setProperty("display", "none")

    const box = this.layerTarget.querySelector(`.text-box[data-text-id="${textId}"]`)
    const tipHandle = this.layerTarget.querySelector(`.text-tail-handle[data-text-id="${textId}"]`)
    const shaftHandle = this.layerTarget.querySelector(`.text-tail-shaft-handle[data-text-id="${textId}"]`)
    const startClientX = event.clientX
    const startClientY = event.clientY
    const originalX = text.x
    const originalY = text.y
    const [ originalTx, originalTy ] = text.tail
    let lastX = originalX
    let lastY = originalY
    let lastTx = originalTx
    let lastTy = originalTy

    const onMove = (moveEvent) => {
      const dx = (moveEvent.clientX - startClientX) / this.scaleX
      const dy = (moveEvent.clientY - startClientY) / this.scaleY
      lastX = originalX + dx
      lastY = originalY + dy
      lastTx = originalTx + dx
      lastTy = originalTy + dy

      if (box) {
        box.style.left = `${lastX}px`
        box.style.top = `${lastY}px`
      }
      if (tipHandle) {
        tipHandle.style.left = `${lastTx}px`
        tipHandle.style.top = `${lastTy}px`
      }
      const preview = { ...text, x: lastX, y: lastY, tail: [ lastTx, lastTy ] }
      if (shaftHandle) {
        const midpoint = tailShaftMidpoint(preview)
        if (midpoint) {
          shaftHandle.style.left = `${midpoint[0]}px`
          shaftHandle.style.top = `${midpoint[1]}px`
        }
      }
      this.updatePathShapePreview(textId, { x: lastX, y: lastY, tail: [ lastTx, lastTy ] })
    }

    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      this.documentStoreController.store.mutate((state) => {
        const target = state.texts.find((t) => t.id === textId)
        if (target) {
          target.x = lastX
          target.y = lastY
          target.tail = [ lastTx, lastTy ]
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
    if (this.selectedTextId !== textId) this.floatingBarVisible = false
    this.selectedTextId = textId
    this.renderAll(this.currentTexts)
    this.dispatch("selectionChanged", { bubbles: true })

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
