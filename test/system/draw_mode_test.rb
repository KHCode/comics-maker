require "application_system_test_case"

class DrawModeTest < ApplicationSystemTestCase
  BOX_PTS = [ [ 100, 100 ], [ 300, 100 ], [ 300, 300 ], [ 100, 300 ] ]

  def sign_in(user)
    visit new_session_path
    fill_in "Email", with: user.email
    fill_in "Password", with: "password123"
    click_button "Sign in"
    assert_text "Signed in as #{user.name}"
  end

  def create_project_with_panel(user, pts: BOX_PTS)
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [ { "id" => "p1", "pts" => pts, "strokes" => [], "photo" => nil } ],
      "texts" => []
    })
    project
  end

  def canvas_view_box
    find("svg.page-canvas")["viewBox"]
  end

  def switch_to_draw_mode
    within(".mode-tabs") { click_button "Draw" }
  end

  test "tapping a panel in Draw mode zooms into it and dims the rest of the page" do
    user = User.create!(name: "Drawer", email: "draw1@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)

    original_view_box = canvas_view_box
    switch_to_draw_mode

    find("polygon.panel-outline[data-panel-id='p1']").click
    assert_selector ".panel-focus-dim"

    zoomed_view_box = canvas_view_box
    assert_not_equal original_view_box, zoomed_view_box

    zoomed_width = zoomed_view_box.split(" ")[2].to_f
    original_width = original_view_box.split(" ")[2].to_f
    assert zoomed_width < original_width, "expected the zoomed viewBox (#{zoomed_width}) to be narrower than the original (#{original_width})"
  end

  test "tapping a panel in Draw mode does not select it for Layout-style move/scale" do
    user = User.create!(name: "Drawer", email: "draw2@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)

    switch_to_draw_mode
    find("polygon.panel-outline[data-panel-id='p1']").click

    assert_no_selector "polygon.panel-outline--selected"
    assert_no_selector ".panel-handle"
    assert_no_selector ".panel-floating-bar"
  end

  test "the Whole page button returns to the original view" do
    user = User.create!(name: "Drawer", email: "draw3@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)

    original_view_box = canvas_view_box
    switch_to_draw_mode
    find("polygon.panel-outline[data-panel-id='p1']").click
    assert_not_equal original_view_box, canvas_view_box

    click_button "Whole page"
    assert_equal original_view_box, canvas_view_box
    assert_no_selector ".panel-focus-dim"
  end

  test "tapping the dimmed margin exits focus, same as Whole page" do
    user = User.create!(name: "Drawer", email: "draw4@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)

    original_view_box = canvas_view_box
    switch_to_draw_mode
    find("polygon.panel-outline[data-panel-id='p1']").click
    assert_not_equal original_view_box, canvas_view_box

    # The overlay's own bounding box is the full (pre-hole) outer rect, so
    # its geometric center sits inside the focused panel's cut-out — not
    # painted there, so a plain coordinate click lands on the panel
    # underneath instead of the dimmed margin around it. Dispatching the
    # pointerdown directly on the element instead exercises the same
    # panel_controller.js wiring without fighting Capybara/Selenium over
    # exactly which pixel is "the dimmed area" for an irregularly-shaped
    # (hole-punched) path.
    page.execute_script(<<~JS)
      document.querySelector(".panel-focus-dim")
        .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    JS
    assert_equal original_view_box, canvas_view_box
    assert_no_selector ".panel-focus-dim"
  end

  test "switching to Layout mode while zoomed in exits focus automatically" do
    user = User.create!(name: "Drawer", email: "draw5@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)

    original_view_box = canvas_view_box
    switch_to_draw_mode
    find("polygon.panel-outline[data-panel-id='p1']").click
    assert_not_equal original_view_box, canvas_view_box

    within(".mode-tabs") { click_button "Layout" }
    assert_equal original_view_box, canvas_view_box
    assert_no_selector ".panel-focus-dim"
  end

  test "switching to Draw mode while a panel is selected in Layout mode clears the selection" do
    user = User.create!(name: "Drawer", email: "draw6@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)

    find("polygon.panel-outline[data-panel-id='p1']").click
    assert_selector "polygon.panel-outline--selected"

    switch_to_draw_mode
    assert_no_selector "polygon.panel-outline--selected"
    assert_no_selector ".panel-handle"
  end

  test "Layout mode still selects a panel for move/scale (not a Draw-mode regression)" do
    user = User.create!(name: "Drawer", email: "draw7@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)

    find("polygon.panel-outline[data-panel-id='p1']").click
    assert_selector "polygon.panel-outline--selected"
    assert_selector ".panel-handle", count: 4
  end

  test "focusing a panel hides sibling panels' outlines instead of just dimming them" do
    user = User.create!(name: "Drawer", email: "draw8@kapow.test", password: "password123")
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [
        { "id" => "p1", "pts" => BOX_PTS, "strokes" => [], "photo" => nil },
        { "id" => "p2", "pts" => [ [ 320, 100 ], [ 520, 100 ], [ 520, 300 ], [ 320, 300 ] ], "strokes" => [], "photo" => nil }
      ],
      "texts" => []
    })

    sign_in(user)
    visit project_path(project)

    assert_selector "polygon.panel-outline", count: 2
    switch_to_draw_mode
    find("polygon.panel-outline[data-panel-id='p1']").click

    assert_selector "polygon.panel-outline", count: 1
    assert_selector "polygon.panel-outline[data-panel-id='p1']"

    click_button "Whole page"
    assert_selector "polygon.panel-outline", count: 2
  end

  test "mode tabs and the Whole page tray button stay reachable while a panel is focused" do
    user = User.create!(name: "Drawer", email: "draw9@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)

    original_view_box = canvas_view_box
    switch_to_draw_mode
    find("polygon.panel-outline[data-panel-id='p1']").click
    assert_not_equal original_view_box, canvas_view_box

    within(".mode-tabs") { click_button "Layout" }
    assert_equal original_view_box, canvas_view_box
  end

  test "the focus overlay stays centered in the viewport regardless of how far the page list was scrolled" do
    user = User.create!(name: "Drawer", email: "draw10@kapow.test", password: "password123")
    project = user.projects.create!(name: "Comic", format: :comic)
    2.times do |i|
      project.pages.create!(position: i + 1, name: "Page #{i + 1}", data: {
        "schema_version" => 1,
        "panels" => i == 1 ? [ { "id" => "p1", "pts" => BOX_PTS, "strokes" => [], "photo" => nil } ] : [],
        "texts" => []
      })
    end

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode

    page.execute_script("document.querySelector('.editor-canvas').scrollTop = document.querySelector('.editor-canvas').scrollHeight")
    find("polygon.panel-outline[data-panel-id='p1']").click

    rect = page.evaluate_script("document.querySelector('svg.page-canvas').getBoundingClientRect()")
    viewport_height = page.evaluate_script("window.innerHeight")
    assert rect["top"] >= 0, "expected the focused panel's top (#{rect['top']}) to be within the viewport, not scrolled above it"
    assert rect["bottom"] <= viewport_height, "expected the focused panel's bottom (#{rect['bottom']}) to be within the viewport (height #{viewport_height})"
  end

  test "the focused panel is centered within the header/footer gap, not the whole viewport" do
    user = User.create!(name: "Drawer", email: "draw11@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode
    find("polygon.panel-outline[data-panel-id='p1']").click

    svg_rect = page.evaluate_script("document.querySelector('svg.page-canvas').getBoundingClientRect()")
    canvas_rect = page.evaluate_script("document.querySelector('.editor-canvas').getBoundingClientRect()")

    top_margin = svg_rect["top"] - canvas_rect["top"]
    bottom_margin = canvas_rect["bottom"] - svg_rect["bottom"]

    # Header and footer are rarely the same height (the footer carries the
    # mode tabs + tray), so centering on the *whole* viewport — rather than
    # on .editor-canvas's own rect, which is exactly the visible gap
    # between them — would skew the panel toward whichever is shorter.
    assert_in_delta top_margin, bottom_margin, 1.0,
      "expected the focused panel to be vertically centered within the header/footer gap (top margin #{top_margin}, bottom margin #{bottom_margin})"
  end

  test "clicking the focus container's own background (not just the SVG's dim overlay) exits focus" do
    user = User.create!(name: "Drawer", email: "draw12@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)

    original_view_box = canvas_view_box
    switch_to_draw_mode
    find("polygon.panel-outline[data-panel-id='p1']").click
    assert_not_equal original_view_box, canvas_view_box

    # updateFocusViewBox now matches the container's own aspect ratio, so
    # in practice the SVG fills .page--focused almost exactly (no real
    # letterbox gap left to click into) — this instead directly confirms
    # panel_controller.js's own background-click listener on .page--focused
    # itself, a defense-in-depth exit path for whatever residual gap
    # rounding (or an unusual container/panel shape) leaves behind, kept
    # independent of the dim overlay's tap-to-exit (which only covers the
    # margin *inside* the SVG's viewBox).
    page.execute_script(<<~JS)
      const pageEl = document.querySelector('[data-controller~="panel"]');
      pageEl.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    JS
    assert_equal original_view_box, canvas_view_box
    assert_no_selector ".panel-focus-dim"
  end

  test "a focused panel's SVG fills the canvas area on both axes, regardless of the panel's own aspect ratio" do
    user = User.create!(name: "Drawer", email: "draw13@kapow.test", password: "password123")
    project = create_project_with_panel(user) # a square panel, in a landscape canvas area

    sign_in(user)
    visit project_path(project)

    switch_to_draw_mode
    find("polygon.panel-outline[data-panel-id='p1']").click

    svg_rect = page.evaluate_script("document.querySelector('svg.page-canvas').getBoundingClientRect()")
    canvas_rect = page.evaluate_script("document.querySelector('.editor-canvas').getBoundingClientRect()")

    assert_in_delta svg_rect["width"], canvas_rect["width"], 5,
      "expected the focused SVG to fill the canvas area's width (svg=#{svg_rect['width']}, canvas=#{canvas_rect['width']})"
    assert_in_delta svg_rect["height"], canvas_rect["height"], 5,
      "expected the focused SVG to fill the canvas area's height (svg=#{svg_rect['height']}, canvas=#{canvas_rect['height']})"
  end
end
