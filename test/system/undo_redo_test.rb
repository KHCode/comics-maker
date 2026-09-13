require "application_system_test_case"

class UndoRedoTest < ApplicationSystemTestCase
  BOX_PTS = [ [ 100, 100 ], [ 300, 100 ], [ 300, 300 ], [ 100, 300 ] ]
  SAMPLE_PHOTO = Rails.root.join("test/fixtures/files/sample_photo.png")

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

  def create_project_with_panel(user)
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [ { "id" => "p1", "pts" => BOX_PTS, "strokes" => [], "photo" => nil } ],
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

  def switch_to_draw_mode
    within(".mode-tabs") { click_button "Draw" }
  end

  def switch_to_photo_layer
    within(".draw-layer-tabs") { click_button "Photo" }
  end

  def undo_button
    find("button", text: "Undo")
  end

  def redo_button
    find("button", text: "Redo")
  end

  def stored_state
    page.evaluate_script(<<~JS)
      (() => {
        const pageEl = document.querySelector('[data-controller~="document-store"]')
        const controller = window.Stimulus.getControllerForElementAndIdentifier(pageEl, "document-store")
        return JSON.stringify(controller.store.getState())
      })()
    JS
  end

  def stored_panels
    JSON.parse(stored_state)["panels"]
  end

  def stored_texts
    JSON.parse(stored_state)["texts"]
  end

  test "Undo/Redo start disabled on a fresh project" do
    user = User.create!(name: "Editor", email: "undo1@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)

    assert undo_button.disabled?
    assert redo_button.disabled?
  end

  test "adding a panel enables Undo; undoing removes it and enables Redo; redoing restores it" do
    user = User.create!(name: "Editor", email: "undo2@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)

    click_button "Box"
    assert_equal 1, stored_panels.length
    assert_not undo_button.disabled?
    assert redo_button.disabled?

    undo_button.click
    assert_equal 0, stored_panels.length
    assert undo_button.disabled?
    assert_not redo_button.disabled?

    redo_button.click
    assert_equal 1, stored_panels.length
    assert_not undo_button.disabled?
    assert redo_button.disabled?
  end

  test "an undo persists to the server, not just the DOM" do
    user = User.create!(name: "Editor", email: "undo3@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)

    click_button "Box"
    undo_button.click
    assert_equal 0, stored_panels.length

    sleep 1 # let the document store's debounced save land
    visit project_path(project)
    assert_no_selector "svg.page-canvas polygon.panel-outline"
  end

  test "undoing steps back through a mix of panel and text mutations, across mode switches" do
    user = User.create!(name: "Editor", email: "undo4@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)

    click_button "Box"
    switch_to_letter_mode
    click_button "Caption"

    assert_equal 1, stored_panels.length
    assert_equal 1, stored_texts.length

    undo_button.click # undoes adding the caption
    assert_equal 1, stored_panels.length
    assert_equal 0, stored_texts.length

    undo_button.click # undoes adding the panel
    assert_equal 0, stored_panels.length
    assert_equal 0, stored_texts.length
    assert undo_button.disabled?

    redo_button.click
    assert_equal 1, stored_panels.length
    redo_button.click
    assert_equal 1, stored_texts.length
    assert redo_button.disabled?
  end

  test "a new action after undoing discards the redo history" do
    user = User.create!(name: "Editor", email: "undo5@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)

    click_button "Box"
    click_button "Burst"
    undo_button.click
    assert_not redo_button.disabled?

    click_button "Slant"
    assert redo_button.disabled?

    # Box/Slant are both 4-point quadrilaterals; Burst is a 20-point star —
    # if undo had failed to actually remove it, this count would give it
    # away even without a "kind" field in the stored panel schema.
    assert_equal 2, stored_panels.length
    assert stored_panels.all? { |p| p["pts"].length == 4 }
  end

  test "dragging a photo Adjust slider through many ticks undoes as a single step" do
    user = User.create!(name: "Editor", email: "undo6@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode
    switch_to_photo_layer
    find("polygon.panel-outline[data-panel-id='p1']").click

    attach_file("photo-file-input", SAMPLE_PHOTO, visible: :all)
    assert_selector ".panel-photo[data-panel-id='p1'] image", visible: :all

    within(".contextual-tray[data-mode='draw']") { click_button "Adjust" }
    slider = find("input[data-editor-target='photoBright']")

    # Simulate a real slider drag's many intermediate "input" ticks, not
    # just one final .set() — this is exactly the case coalesceKey exists
    # for (see kapow/document_store.js).
    page.execute_script(<<~JS, slider.native)
      const el = arguments[0]
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      for (const v of [10, 20, 30, 40, 50]) {
        nativeSetter.call(el, v)
        el.dispatchEvent(new Event("input", { bubbles: true }))
      }
    JS

    photo_state = ->(field) { stored_panels.first["photo"][field] }
    assert_equal 50, photo_state.call("bright")

    # One undo reverts the *entire* 5-tick drag back to bright: 0 — if
    # coalescing had failed and each tick were its own step, this would
    # only land on 40. The photo itself is a separate, earlier undo step
    # (inserting it and adjusting it are two distinct user actions), so a
    # second undo is still available and removes the photo entirely.
    undo_button.click
    assert_equal 0, photo_state.call("bright")
    assert_not undo_button.disabled?

    undo_button.click
    assert_nil stored_panels.first["photo"]
  end
end
