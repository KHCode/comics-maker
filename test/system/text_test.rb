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
end
