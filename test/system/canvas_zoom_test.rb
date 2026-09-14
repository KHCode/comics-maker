require "application_system_test_case"

# Zoom +/- controls in the header (see editor_controller.js#zoomIn/zoomOut)
# work the same way in every mode (Layout/Draw/Letter), independent of Draw
# mode's own separate per-panel focus-zoom.
class CanvasZoomTest < ApplicationSystemTestCase
  def sign_in(user)
    visit new_session_path
    fill_in "Email", with: user.email
    fill_in "Password", with: "password123"
    click_button "Sign in"
    assert_text "Signed in as #{user.name}"
  end

  def zoom_in_button
    find("[data-editor-target='zoomInButton']")
  end

  def zoom_out_button
    find("[data-editor-target='zoomOutButton']")
  end

  def zoom_level_text
    find("[data-editor-target='zoomLevel']").text
  end

  def canvas_width
    page.evaluate_script("document.querySelector('svg.page-canvas').getBoundingClientRect().width")
  end

  def switch_to_draw_mode
    within(".mode-tabs") { click_button "Draw" }
  end

  def drag_element_by(element, dx, dy)
    page.driver.browser.action
      .move_to(element.native)
      .pointer_down
      .move_by(dx, dy)
      .pointer_up
      .perform
  end

  def stored_panel(id)
    page.evaluate_script(<<~JS)
      (() => {
        const pageEl = document.querySelector('[data-controller~="document-store"]')
        const controller = window.Stimulus.getControllerForElementAndIdentifier(pageEl, "document-store")
        return controller.store.getState().panels.find((p) => p.id === #{id.to_json})
      })()
    JS
  end

  test "zoom in/out buttons resize the canvas and update the displayed percentage, clamped at the min/max" do
    user = User.create!(name: "Zoomer", email: "zoom1@kapow.test", password: "password123")
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: { "schema_version" => 1, "panels" => [], "texts" => [] })

    sign_in(user)
    visit project_path(project)

    assert_equal "100%", zoom_level_text
    base_width = canvas_width

    zoom_in_button.click
    assert_equal "125%", zoom_level_text
    assert canvas_width > base_width

    6.times { zoom_in_button.click } # step is 25%, max is 250%
    assert_equal "250%", zoom_level_text
    assert zoom_in_button.disabled?

    9.times { zoom_out_button.click } # step is 25%, min is 50%
    assert_equal "50%", zoom_level_text
    assert zoom_out_button.disabled?
    assert canvas_width < base_width
  end

  test "zooming the canvas doesn't affect Draw mode's own per-panel focus view" do
    user = User.create!(name: "Zoomer", email: "zoom2@kapow.test", password: "password123")
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [ { "id" => "p1", "pts" => [ [ 100, 100 ], [ 300, 100 ], [ 300, 300 ], [ 100, 300 ] ], "strokes" => [], "photo" => nil } ],
      "texts" => []
    })

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode

    find("polygon.panel-outline[data-panel-id='p1']").click # focus the panel
    assert_selector ".page--focused"
    unzoomed_focused_width = canvas_width
    find(".header-focus-exit").click
    assert_no_selector ".page--focused"

    3.times { zoom_in_button.click } # 175%
    assert_equal "175%", zoom_level_text

    find("polygon.panel-outline[data-panel-id='p1']").click
    assert_selector ".page--focused"
    assert_in_delta unzoomed_focused_width, canvas_width, 1.0
  end

  test "dragging a panel moves it by fewer page units per screen pixel while zoomed in" do
    user = User.create!(name: "Zoomer", email: "zoom3@kapow.test", password: "password123")
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [
        { "id" => "p1", "pts" => [ [ 50, 50 ], [ 250, 50 ], [ 250, 250 ], [ 50, 250 ] ], "strokes" => [], "photo" => nil },
        { "id" => "p2", "pts" => [ [ 300, 50 ], [ 500, 50 ], [ 500, 250 ], [ 300, 250 ] ], "strokes" => [], "photo" => nil }
      ],
      "texts" => []
    })

    sign_in(user)
    visit project_path(project)

    drag_element_by(find("polygon.panel-outline[data-panel-id='p1']"), 80, 0)
    moved_at_1x = stored_panel("p1")["pts"][0][0] - 50
    assert moved_at_1x > 1 # sanity: the drag actually moved it

    4.times { zoom_in_button.click } # 200%
    assert_equal "200%", zoom_level_text

    drag_element_by(find("polygon.panel-outline[data-panel-id='p2']"), 80, 0)
    moved_at_2x = stored_panel("p2")["pts"][0][0] - 300

    # Same 80px screen drag should translate to noticeably fewer page units
    # once each page unit renders bigger on screen — if the pointer-to-
    # viewBox conversion (panel_controller.js's getScreenCTM-based
    # clientToSvgPoint) weren't correctly picking up the new zoomed size,
    # this would come out identical to the 100% case instead.
    assert moved_at_2x < moved_at_1x * 0.7,
      "expected dragging at 200% zoom (#{moved_at_2x} units) to move noticeably less than at 100% zoom (#{moved_at_1x} units)"
  end
end
