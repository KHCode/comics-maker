require "application_system_test_case"

class TextTest < ApplicationSystemTestCase
  def sign_in(user)
    visit new_session_path
    fill_in "Email", with: user.email
    fill_in "Password", with: "password123"
    click_button "Sign in"
    assert_text "Signed in as #{user.name}"
  end

  def create_blank_project(user)
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1, "panels" => [], "texts" => []
    })
    project
  end

  # A single panel covering nearly the whole page, so a click far from the
  # text box (but still within the page) inevitably lands on the panel
  # rather than the bare page background.
  def create_project_with_full_page_panel(user)
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [ { "id" => "p1", "pts" => [ [ 10, 10 ], [ 600, 10 ], [ 600, 900 ], [ 10, 900 ] ], "strokes" => [], "photo" => nil } ],
      "texts" => []
    })
    project
  end

  def switch_to_letter_mode
    within(".mode-tabs") { click_button "Letter" }
  end

  def switch_to_layout_mode
    within(".mode-tabs") { click_button "Layout" }
  end

  def add_text(kind_label)
    within(".contextual-tray[data-mode='letter']") { click_button kind_label }
  end

  def text_box(kind)
    find(".text-box--#{kind}")
  end

  # Selects the box (tap 1) and opens its floating bar via the toggle icon
  # (tap 2) — the bar no longer opens automatically on selection.
  def select_and_open_bar(kind)
    text_box(kind).click
    find(".text-box--#{kind} .text-bar-toggle").click
  end

  def drag_element_by(element, dx, dy)
    page.driver.browser.action
      .move_to(element.native)
      .pointer_down
      .move_by(dx, dy)
      .pointer_up
      .perform
  end

  def stored_texts
    page.evaluate_script(<<~JS)
      (() => {
        const pageEl = document.querySelector('[data-controller~="document-store"]')
        const controller = window.Stimulus.getControllerForElementAndIdentifier(pageEl, "document-store")
        return controller.store.getState().texts
      })()
    JS
  end

  test "adding Speech/Caption/Narration drops each with its own per-kind defaults" do
    user = User.create!(name: "Letterer", email: "letter1@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode

    add_text("Speech")
    add_text("Caption")
    add_text("Narration")

    texts = stored_texts
    assert_equal 3, texts.length
    kinds = texts.map { |t| t["kind"] }
    assert_equal %w[speech caption narration], kinds

    speech = texts.find { |t| t["kind"] == "speech" }
    assert_equal "comic", speech["font"]
    assert_equal true, speech["bold"]
    assert_equal false, speech["italic"]
    refute_nil speech["tail"]

    caption = texts.find { |t| t["kind"] == "caption" }
    assert_equal true, caption["bold"]
    assert_nil caption["tail"]

    narration = texts.find { |t| t["kind"] == "narration" }
    assert_equal true, narration["bold"]
    assert_equal true, narration["italic"]
    assert_nil narration["tail"]

    assert_selector ".text-box--speech"
    assert_selector ".text-box--caption"
    assert_selector ".text-box--narration"
  end

  test "clicking a text box selects it (showing its resize handle); clicking again deselects" do
    user = User.create!(name: "Letterer", email: "letter2@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    add_text("Caption")

    assert_no_selector ".text-handle"

    text_box("caption").click
    assert_selector ".text-box--caption.text-box--selected"
    assert_selector ".text-handle"

    text_box("caption").click
    assert_no_selector ".text-box--selected"
    assert_no_selector ".text-handle"
  end

  test "dragging a text box moves it" do
    user = User.create!(name: "Letterer", email: "letter3@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    add_text("Caption")

    before = stored_texts.first
    drag_element_by(text_box("caption"), 40, 25)
    after = stored_texts.first

    assert after["x"] > before["x"]
    assert after["y"] > before["y"]
  end

  test "dragging the resize handle grows the text box" do
    user = User.create!(name: "Letterer", email: "letter4@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    add_text("Caption")
    text_box("caption").click

    before = stored_texts.first
    handle = find(".text-handle")
    drag_element_by(handle, 40, 30)
    after = stored_texts.first

    assert after["w"] > before["w"]
    assert after["h"] > before["h"]
    # The box grows from its own top-left — x/y (unlike a panel's
    # corner-anchor scale) never move.
    assert_equal before["x"], after["x"]
    assert_equal before["y"], after["y"]
  end

  test "double-clicking a text box edits its text inline, committed on blur" do
    user = User.create!(name: "Letterer", email: "letter5@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    add_text("Speech")

    find(".text-box--speech .text-box-content").double_click
    # Entering edit mode re-renders the box (see text_controller.js#
    # startEditing), so the pre-double-click node reference is now stale —
    # re-find it fresh rather than reuse it.
    content = find(".text-box--speech .text-box-content")
    assert_equal "true", content["contenteditable"]

    content.send_keys("Kapow!")
    find("body").click # blur

    assert_equal "Kapow!", stored_texts.first["text"]
    assert_equal "false", find(".text-box--speech .text-box-content")["contenteditable"]
  end

  test "typing in a speech bubble then clicking the empty page background saves the text (regression)" do
    user = User.create!(name: "Letterer", email: "letter19@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    add_text("Speech")

    find(".text-box--speech .text-box-content").double_click
    content = find(".text-box--speech .text-box-content")
    content.send_keys("Kapow!")

    # Clicking the empty canvas background (not another element) is what
    # deselects — this used to tear down the editing box's DOM before its
    # own blur event could commit the typed text, silently discarding it.
    find(".page-canvas").click(x: 10, y: 10)

    assert_equal "Kapow!", stored_texts.first["text"]
    assert_equal "Kapow!", find(".text-box--speech .text-box-content").text
  end

  test "clicking a panel underneath a text box still deselects the text (regression)" do
    user = User.create!(name: "Letterer", email: "letter20@kapow.test", password: "password123")
    project = create_project_with_full_page_panel(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    add_text("Caption")

    text_box("caption").click
    assert_selector ".text-box--caption.text-box--selected"

    # The panel spans almost the entire page, so this lands on the panel
    # itself, not bare page background — a panel's own pointerdown handler
    # stops propagation as its very first step, so this used to never
    # reach the text controller's deselect check at all.
    find("polygon.panel-outline[data-panel-id='p1']").click(x: 5, y: 5)

    assert_no_selector ".text-box--selected"
  end

  test "text boxes aren't draggable outside Letter mode" do
    user = User.create!(name: "Letterer", email: "letter6@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    add_text("Caption")
    switch_to_layout_mode

    before = stored_texts.first
    drag_element_by(text_box("caption"), 40, 25)
    after = stored_texts.first

    assert_equal before["x"], after["x"]
    assert_equal before["y"], after["y"]
  end

  test "selecting a text box does not show its floating bar; the toggle icon opens/closes it" do
    user = User.create!(name: "Letterer", email: "letter7@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    add_text("Caption")

    assert_no_selector ".text-floating-bar"

    text_box("caption").click
    assert_selector ".text-box--caption.text-box--selected"
    assert_no_selector ".text-floating-bar"

    find(".text-box--caption .text-bar-toggle").click
    assert_selector ".text-floating-bar"

    find(".text-box--caption .text-bar-toggle").click
    assert_no_selector ".text-floating-bar"
  end

  test "deselecting a text closes its floating bar, and reselecting it starts closed again" do
    user = User.create!(name: "Letterer", email: "letter14@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    add_text("Caption")
    select_and_open_bar("caption")
    assert_selector ".text-floating-bar"

    text_box("caption").click # deselect
    assert_no_selector ".text-floating-bar"

    text_box("caption").click # reselect
    assert_no_selector ".text-floating-bar"
  end

  test "the floating bar's A-/A+ buttons change the font size, clamped to the min/max" do
    user = User.create!(name: "Letterer", email: "letter8@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    add_text("Caption")
    select_and_open_bar("caption")

    before_fs = stored_texts.first["fs"]
    within(".text-floating-bar") { click_button "A+" }
    assert_equal before_fs + 4, stored_texts.first["fs"]

    within(".text-floating-bar") { click_button "A−" }
    within(".text-floating-bar") { click_button "A−" }
    assert_equal before_fs - 4, stored_texts.first["fs"]
  end

  test "the floating bar's rotate buttons step by 8 degrees in either direction" do
    user = User.create!(name: "Letterer", email: "letter9@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    add_text("Caption")
    select_and_open_bar("caption")

    within(".text-floating-bar") { click_button "↻" }
    assert_equal 8, stored_texts.first["rot"]

    within(".text-floating-bar") { click_button "↺" }
    assert_equal 0, stored_texts.first["rot"]
  end

  test "the floating bar's font/bold/italic buttons update the text's styling" do
    user = User.create!(name: "Letterer", email: "letter10@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    add_text("Caption")
    select_and_open_bar("caption")

    within(".text-floating-bar") { click_button "Loud" }
    assert_equal "loud", stored_texts.first["font"]

    within(".text-floating-bar") { click_button "B" } # bold starts true (Caption's default) — toggles off
    assert_equal false, stored_texts.first["bold"]

    within(".text-floating-bar") { click_button "I" }
    assert_equal true, stored_texts.first["italic"]
  end

  test "the floating bar's delete button removes the text" do
    user = User.create!(name: "Letterer", email: "letter11@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    add_text("Caption")
    select_and_open_bar("caption")

    within(".text-floating-bar") { click_button "🗑" }

    assert_equal 0, stored_texts.length
    assert_no_selector ".text-box--caption"
    assert_no_selector ".text-floating-bar"
  end

  test "pressing Delete/Backspace with a text selected deletes it, but not while editing its text" do
    user = User.create!(name: "Letterer", email: "letter12@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    add_text("Caption")

    # While editing, Backspace should edit the text, not delete the box.
    find(".text-box--caption .text-box-content").double_click
    find(".text-box--caption .text-box-content").send_keys("x")
    find(".text-box--caption .text-box-content").send_keys(:backspace)
    find("body").click # blur, committing whatever's left
    assert_equal 1, stored_texts.length

    # Editing already left the box selected (see text_controller.js#
    # startEditing) — no extra click needed, and clicking again here would
    # just toggle selection back off.
    page.driver.browser.action.send_keys(:delete).perform
    assert_equal 0, stored_texts.length
  end

  test "dragging a speech bubble's tail handle moves its tail point" do
    user = User.create!(name: "Letterer", email: "letter13@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    add_text("Speech")
    text_box("speech").click

    assert_selector ".text-tail-handle"
    before = stored_texts.first["tail"]

    drag_element_by(find(".text-tail-handle"), 60, 40)
    after = stored_texts.first["tail"]

    assert after[0] > before[0]
    assert after[1] > before[1]
  end

  test "a speech bubble renders as one seamless shape, not a separately bordered bubble and tail" do
    user = User.create!(name: "Letterer", email: "letter15@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    add_text("Speech")

    # Exactly one combined path (bubble + tail), and the box itself has no
    # visible border/background of its own (see text_controller.js#
    # renderSpeechShape / editor.css's .text-box--speech).
    assert_selector ".text-speech-shape path", count: 1
    assert_equal "rgba(0, 0, 0, 0)", text_box("speech").native.css_value("background-color")
  end

  test "dragging a speech bubble's shaft handle moves the bubble and its tail together" do
    user = User.create!(name: "Letterer", email: "letter16@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    add_text("Speech")
    text_box("speech").click

    assert_selector ".text-tail-shaft-handle"
    before_text = stored_texts.first
    before_x = before_text["x"]
    before_tail = before_text["tail"]

    drag_element_by(find(".text-tail-shaft-handle"), 50, 30)
    after_text = stored_texts.first

    assert after_text["x"] > before_x
    assert after_text["tail"][0] > before_tail[0]
    assert after_text["tail"][1] > before_tail[1]
    # Both moved by the same delta, so their relative offset is unchanged.
    assert_in_delta before_text["tail"][0] - before_x, after_text["tail"][0] - after_text["x"], 0.01
  end

  test "the Letter tray's Layer button brings the selected text to front/sends it to back" do
    user = User.create!(name: "Letterer", email: "letter17@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    add_text("Caption")
    add_text("Narration")
    # Both drop near the same spot (just a small cycled offset apart) —
    # move narration well clear so it can't intercept a click meant for
    # the caption underneath it.
    drag_element_by(text_box("narration"), 150, 150)

    layer_button = find("button[data-editor-target='textLayerButton']")
    assert layer_button.disabled?

    text_box("caption").click # the back-most of the two
    assert_not layer_button.disabled?
    assert_equal "⬆ Bring to front", layer_button.text

    layer_button.click
    assert_equal "caption", stored_texts.last["kind"]

    assert_equal "⬇ Send to back", layer_button.text
    layer_button.click
    assert_equal "caption", stored_texts.first["kind"]
  end

  test "Layout mode's Hide text button hides every text container until toggled again or the mode changes" do
    user = User.create!(name: "Letterer", email: "letter18@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    add_text("Caption")
    switch_to_layout_mode

    assert_selector ".text-box--caption", visible: :all

    within(".contextual-tray[data-mode='layout']") { click_button "Hide text" }
    assert_no_selector ".text-box--caption"

    within(".contextual-tray[data-mode='layout']") { click_button "Show text" }
    assert_selector ".text-box--caption", visible: :all

    within(".contextual-tray[data-mode='layout']") { click_button "Hide text" }
    assert_no_selector ".text-box--caption"

    switch_to_letter_mode # (b) changing modes also brings it back
    assert_selector ".text-box--caption", visible: :all
  end
end
