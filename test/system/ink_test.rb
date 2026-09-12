require "application_system_test_case"

class InkTest < ApplicationSystemTestCase
  BOX_PTS = [ [ 100, 100 ], [ 300, 100 ], [ 300, 300 ], [ 100, 300 ] ]

  def sign_in(user)
    visit new_session_path
    fill_in "Email", with: user.email
    fill_in "Password", with: "password123"
    click_button "Sign in"
    assert_text "Signed in as #{user.name}"
  end

  def create_project_with_panel(user, pts: BOX_PTS, strokes: [])
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [ { "id" => "p1", "pts" => pts, "strokes" => strokes, "photo" => nil } ],
      "texts" => []
    })
    project
  end

  def switch_to_draw_mode
    within(".mode-tabs") { click_button "Draw" }
  end

  def switch_to_layout_mode
    within(".mode-tabs") { click_button "Layout" }
  end

  def draw_tray
    find(".contextual-tray[data-mode='draw']", visible: :all)
  end

  def panel_polygon
    find("polygon.panel-outline[data-panel-id='p1']")
  end

  def focus_panel
    panel_polygon.click
  end

  # Capybara has no pixel-offset drag helper (only drag_to a target
  # element), so drive the W3C pointer actions directly: press on the
  # element (its own center, by default), move by a relative offset,
  # release — matching the pattern already established for corner-handle
  # drags in panel_interaction_test.rb.
  def drag_element_by(element, dx, dy)
    page.driver.browser.action
      .move_to(element.native)
      .pointer_down
      .move_by(dx, dy)
      .pointer_up
      .perform
  end

  def stored_panel
    page.evaluate_script(<<~JS)
      (() => {
        const pageEl = document.querySelector('[data-controller~="document-store"]')
        const controller = window.Stimulus.getControllerForElementAndIdentifier(pageEl, "document-store")
        return controller.store.getState().panels.find((p) => p.id === "p1")
      })()
    JS
  end

  def bbox_width(pts)
    xs = pts.map { |x, _y| x }
    xs.max - xs.min
  end

  test "drawing with the Pen tool adds a clipped ink stroke, sized at the default brush width" do
    user = User.create!(name: "Inker", email: "ink1@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode
    focus_panel

    drag_element_by(panel_polygon, 60, 40)

    # visible: :all — Selenium's element-displayed check relies on a real
    # CSS box, which a perfectly horizontal/vertical SVG polyline doesn't
    # have (its own geometry bounding box is 0px tall/wide before the
    # stroke width is drawn on top), so it can read as "not visible" even
    # though it's plainly on-screen.
    assert_selector ".panel-ink[data-panel-id='p1'] polyline", count: 1, visible: :all

    stroke = stored_panel["strokes"].first
    assert_equal "pen", stroke["tool"]
    assert_equal 1, stroke["op"]
    assert_equal 8, stroke["w"] # size "m" default (8), pen's 1x multiplier, default (mouse) pressure
    assert stroke["pts"].length >= 2
  end

  test "the Marker tool draws 2.4x wider and at 45% opacity" do
    user = User.create!(name: "Inker", email: "ink2@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode
    focus_panel

    within(draw_tray) { click_button "🖊 Marker" }
    drag_element_by(panel_polygon, 60, 40)

    stroke = stored_panel["strokes"].first
    assert_equal "marker", stroke["tool"]
    assert_in_delta 19.2, stroke["w"], 0.01
    assert_in_delta 0.45, stroke["op"], 0.01
  end

  test "picking a color swatch changes the color of new strokes" do
    user = User.create!(name: "Inker", email: "ink3@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode
    focus_panel

    target_color = EditorHelper::INK_COLORS[1]
    within(draw_tray) { find("button.ink-color[data-color='#{target_color}']").click }
    drag_element_by(panel_polygon, 60, 40)

    stroke = stored_panel["strokes"].first
    assert_equal target_color, stroke["color"]
  end

  test "picking the L brush size draws a wider stroke" do
    user = User.create!(name: "Inker", email: "ink4@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode
    focus_panel

    within(draw_tray) { click_button "L" }
    drag_element_by(panel_polygon, 60, 40)

    stroke = stored_panel["strokes"].first
    assert_equal 14, stroke["w"]
  end

  test "the Eraser removes ink where it passes, rather than painting over it" do
    user = User.create!(name: "Inker", email: "ink5@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode
    focus_panel

    # Draw a stroke, then erase back along the exact same path — since both
    # gestures start at the panel's own center and move by the same pixel
    # offset, the eraser's path is guaranteed to overlap the ink it's meant
    # to remove.
    drag_element_by(panel_polygon, 80, 0)
    assert_equal 1, stored_panel["strokes"].length
    # visible: :all — Selenium's element-displayed check relies on a real
    # CSS box, which a perfectly horizontal/vertical SVG polyline doesn't
    # have (its own geometry bounding box is 0px tall/wide before the
    # stroke width is drawn on top), so it can read as "not visible" even
    # though it's plainly on-screen.
    assert_selector ".panel-ink[data-panel-id='p1'] polyline", count: 1, visible: :all

    within(draw_tray) { click_button "⌫ Eraser" }
    drag_element_by(panel_polygon, 80, 0)

    assert_equal 0, stored_panel["strokes"].length
    assert_no_selector ".panel-ink[data-panel-id='p1'] polyline", visible: :all
  end

  test "moving a panel in Layout mode carries its ink strokes along with it" do
    user = User.create!(name: "Inker", email: "ink6@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode
    focus_panel
    drag_element_by(panel_polygon, 60, 40)

    before_panel = stored_panel
    before_panel_x = before_panel["pts"].first[0]
    before_stroke_x = before_panel["strokes"].first["pts"].first[0]

    switch_to_layout_mode
    drag_element_by(panel_polygon, 50, 0)

    after_panel = stored_panel
    after_panel_x = after_panel["pts"].first[0]
    after_stroke_x = after_panel["strokes"].first["pts"].first[0]

    panel_dx = after_panel_x - before_panel_x
    stroke_dx = after_stroke_x - before_stroke_x
    assert panel_dx.abs > 1, "expected the panel to actually have moved"
    assert_in_delta panel_dx, stroke_dx, 0.5
  end

  test "scaling a panel via its corner handle proportionally scales its ink" do
    user = User.create!(name: "Inker", email: "ink7@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode
    focus_panel
    drag_element_by(panel_polygon, 60, 40)

    before_panel = stored_panel
    before_panel_width = bbox_width(before_panel["pts"])
    before_stroke_width = bbox_width(before_panel["strokes"].first["pts"])
    before_stroke_w = before_panel["strokes"].first["w"]

    switch_to_layout_mode
    panel_polygon.click # select for Layout move/scale
    corner_handle = find(".panel-handle[data-corner='se']")
    drag_element_by(corner_handle, 60, 60)

    after_panel = stored_panel
    after_panel_width = bbox_width(after_panel["pts"])
    after_stroke_width = bbox_width(after_panel["strokes"].first["pts"])
    after_stroke_w = after_panel["strokes"].first["w"]

    panel_width_ratio = after_panel_width.to_f / before_panel_width
    stroke_width_ratio = after_stroke_width.to_f / before_stroke_width
    stroke_w_ratio = after_stroke_w.to_f / before_stroke_w

    assert panel_width_ratio > 1.05, "expected the panel to actually have grown"
    assert_in_delta panel_width_ratio, stroke_width_ratio, 0.2
    assert_in_delta panel_width_ratio, stroke_w_ratio, 0.2
  end
end
