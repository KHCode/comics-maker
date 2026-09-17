require "application_system_test_case"

# Draw mode's paint bucket (see panel_controller.js#startBucketFill): fills
# the whole panel background when clicked in open space, or just the
# region enclosed by a closed loop of ink when clicked inside one.
class BucketFillTest < ApplicationSystemTestCase
  SQUARE_PANEL_PTS = [ [ 0, 0 ], [ 300, 0 ], [ 300, 300 ], [ 0, 300 ] ]

  # A closed ring occupying the middle half of the 300x300 panel above —
  # a center click lands well inside it, a near-corner click lands well
  # outside it (but still inside the panel), regardless of exactly how
  # large the focused panel renders on screen.
  RING_STROKE = {
    "tool" => "pen", "color" => "#1c1a17", "w" => 8, "op" => 1,
    "pts" => [ [ 75, 75 ], [ 225, 75 ], [ 225, 225 ], [ 75, 225 ], [ 75, 75 ] ]
  }

  def sign_in(user)
    visit new_session_path
    fill_in "Email", with: user.email
    fill_in "Password", with: "password123"
    click_button "Sign in"
    assert_text "Signed in as #{user.name}"
  end

  def create_project_with_panel(user, strokes: [])
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [ { "id" => "p1", "pts" => SQUARE_PANEL_PTS, "strokes" => strokes, "photo" => nil, "bg" => nil, "fills" => [] } ],
      "texts" => []
    })
    project
  end

  def switch_to_draw_mode
    within(".mode-tabs") { click_button "Draw" }
  end

  def select_bucket_tool
    click_button "🪣 Bucket"
  end

  def select_ink_color(hex)
    find("[data-editor-target='drawColor'][data-color='#{hex}']").click
  end

  def panel_polygon
    find("polygon.panel-outline[data-panel-id='p1']")
  end

  # Capybara/Selenium's element#click(x:, y:) offset is relative to the
  # element's own *center*, not its top-left corner (confirmed by
  # instrumenting a real click and comparing the resulting page-unit
  # coordinate back against the panel's known bounds — a first attempt
  # assuming top-left-relative offsets landed clicks right on the panel's
  # far edge instead of its middle). The focused polygon's own rendered
  # box exactly matches the 300x300 panel (no margin, unlike the SVG
  # around it), so offset 0,0 is the panel's true center.
  def click_center
    panel_polygon.click(x: 0, y: 0)
  end

  # 85% of the way from center toward the top-left corner — safely inside
  # the panel's open margin around RING_STROKE (which starts at 25% in
  # from each edge), and nowhere near the panel's own true edge.
  def click_near_corner
    rect = panel_polygon.native.size
    panel_polygon.click(x: -(rect.width * 0.425).to_i, y: -(rect.height * 0.425).to_i)
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

  test "bucket click in open space sets the panel's background color and renders it" do
    user = User.create!(name: "Painter", email: "bucket1@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode
    find("polygon.panel-outline[data-panel-id='p1']").click # focus
    select_bucket_tool
    select_ink_color("#2f6fed")

    click_center

    panel = stored_panel
    assert_equal "#2f6fed", panel["bg"]
    assert_equal [], panel["fills"]

    background = find(".panel-background[data-panel-id='p1']", visible: :all)
    assert_equal "rgb(47, 111, 237)", background.native.css_value("fill")
  end

  test "bucket click inside a closed ink loop fills only that region, leaving the panel background untouched" do
    user = User.create!(name: "Painter", email: "bucket2@kapow.test", password: "password123")
    project = create_project_with_panel(user, strokes: [ RING_STROKE ])

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode
    find("polygon.panel-outline[data-panel-id='p1']").click
    select_bucket_tool
    select_ink_color("#e0452d")

    click_center # inside the ring

    panel = stored_panel
    assert_nil panel["bg"]
    assert_equal 1, panel["fills"].length
    fill = panel["fills"].first
    # roughly the ring's own interior (75..225 square, minus the stroke's
    # own width eating into it from each side)
    assert_in_delta 75, fill["x"], 10
    assert_in_delta 75, fill["y"], 10
    assert_in_delta 150, fill["w"], 20
    assert_in_delta 150, fill["h"], 20

    assert_selector ".panel-fills[data-panel-id='p1'] image", visible: :all
  end

  test "bucket click outside the loop (but inside the panel) sets the background instead of filling the loop" do
    user = User.create!(name: "Painter", email: "bucket3@kapow.test", password: "password123")
    project = create_project_with_panel(user, strokes: [ RING_STROKE ])

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode
    find("polygon.panel-outline[data-panel-id='p1']").click
    select_bucket_tool
    select_ink_color("#2f9e52")

    click_near_corner # outside the ring, still inside the panel

    panel = stored_panel
    assert_equal "#2f9e52", panel["bg"]
    assert_equal [], panel["fills"]
  end

  test "undo reverses a bucket-filled background" do
    user = User.create!(name: "Painter", email: "bucket4@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode
    find("polygon.panel-outline[data-panel-id='p1']").click
    select_bucket_tool
    select_ink_color("#ffd43a")
    click_center

    assert_equal "#ffd43a", stored_panel["bg"]

    click_button "Undo"

    assert_nil stored_panel["bg"]
  end
end
