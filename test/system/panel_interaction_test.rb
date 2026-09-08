require "application_system_test_case"

class PanelInteractionTest < ApplicationSystemTestCase
  def sign_in(user)
    visit new_session_path
    fill_in "Email", with: user.email
    fill_in "Password", with: "password123"
    click_button "Sign in"
    assert_text "Signed in as #{user.name}"
  end

  def points_of(panel_id)
    find("polygon.panel-outline[data-panel-id='#{panel_id}']")["points"]
  end

  # Capybara has no pixel-offset drag helper (only drag_to a target
  # element), so drive the W3C pointer actions directly: press on the
  # element, move by a relative offset, release.
  def drag_element_by(element, dx, dy)
    page.driver.browser.action
      .move_to(element.native)
      .pointer_down
      .move_by(dx, dy)
      .pointer_up
      .perform
  end

  test "clicking a panel selects it and shows corner handles; clicking the background deselects" do
    user = User.create!(name: "Interact", email: "interact1@kapow.test", password: "password123")
    project = user.projects.create!(name: "Comic", format: :comic)
    page_rec = project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [ { "id" => "p1", "pts" => [ [ 100, 100 ], [ 300, 100 ], [ 300, 300 ], [ 100, 300 ] ], "strokes" => [], "photo" => nil } ],
      "texts" => []
    })

    sign_in(user)
    visit project_path(project)

    find("polygon.panel-outline[data-panel-id='p1']").click
    assert_selector "polygon.panel-outline--selected[data-panel-id='p1']"
    assert_selector ".panel-handle", count: 4

    # click the page background (top-left corner of the svg, far from the panel)
    find("svg.page-canvas").click(x: 5, y: 5)
    assert_no_selector "polygon.panel-outline--selected"
    assert_no_selector ".panel-handle"
  end

  test "dragging a panel moves it, and the new position persists" do
    user = User.create!(name: "Interact", email: "interact2@kapow.test", password: "password123")
    project = user.projects.create!(name: "Comic", format: :comic)
    page_rec = project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [ { "id" => "p1", "pts" => [ [ 100, 100 ], [ 300, 100 ], [ 300, 300 ], [ 100, 300 ] ], "strokes" => [], "photo" => nil } ],
      "texts" => []
    })

    sign_in(user)
    visit project_path(project)

    before = points_of("p1")
    panel = find("polygon.panel-outline[data-panel-id='p1']")
    drag_element_by(panel, 60, 40)

    after = points_of("p1")
    assert_not_equal before, after

    before_x = before.split(" ").first.split(",").first.to_f
    after_x = after.split(" ").first.split(",").first.to_f
    assert after_x > before_x, "expected the panel to move right (before x=#{before_x}, after x=#{after_x})"

    sleep 1 # let the debounced save land
    visit project_path(project)
    assert_equal after, points_of("p1")
  end

  test "dragging a corner handle scales the panel, and the new size persists" do
    user = User.create!(name: "Interact", email: "interact3@kapow.test", password: "password123")
    project = user.projects.create!(name: "Comic", format: :comic)
    page_rec = project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [ { "id" => "p1", "pts" => [ [ 100, 100 ], [ 300, 100 ], [ 300, 300 ], [ 100, 300 ] ], "strokes" => [], "photo" => nil } ],
      "texts" => []
    })

    sign_in(user)
    visit project_path(project)

    find("polygon.panel-outline[data-panel-id='p1']").click
    assert_selector ".panel-handle", count: 4

    se_handle = find(".panel-handle[data-corner='se']")
    drag_element_by(se_handle, 80, 80)

    after = points_of("p1")
    after_max_x = after.split(" ").map { |pt| pt.split(",").first.to_f }.max
    assert after_max_x > 300, "expected the panel to grow past its original right edge (300), got max x=#{after_max_x}"

    sleep 1
    visit project_path(project)
    assert_equal after, points_of("p1")
  end
end
