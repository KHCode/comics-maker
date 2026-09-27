require "application_system_test_case"

class PanelFloatingBarTest < ApplicationSystemTestCase
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

  def select_panel(panel_id = "p1")
    find("polygon.panel-outline[data-panel-id='#{panel_id}']").click
  end

  def bar_button(action)
    find("[data-bar-action='#{action}']")
  end

  def drag_element_by(element, dx, dy)
    page.driver.browser.action
      .move_to(element.native)
      .pointer_down
      .move_by(dx, dy)
      .pointer_up
      .perform
  end

  test "duplicate clones the selected panel with an offset, and the clone persists" do
    user = User.create!(name: "Interact", email: "bar1@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)

    select_panel
    bar_button("duplicate").click

    assert_selector "polygon.panel-outline", count: 2
    assert_selector "polygon.panel-outline--selected", count: 1

    sleep 1 # let the debounced save land
    visit project_path(project)
    assert_selector "polygon.panel-outline", count: 2
  end

  test "delete via the floating bar button removes the panel, and it stays deleted" do
    user = User.create!(name: "Interact", email: "bar2@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)

    select_panel
    bar_button("delete").click
    assert_no_selector "polygon.panel-outline"

    sleep 1 # let the debounced save land
    visit project_path(project)
    assert_no_selector "polygon.panel-outline"
  end

  test "delete via the Delete/Backspace keyboard shortcut removes the selected panel, and it stays deleted" do
    user = User.create!(name: "Interact", email: "bar4@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)

    select_panel
    page.driver.browser.action.send_keys(:backspace).perform
    assert_no_selector "polygon.panel-outline"

    sleep 1
    visit project_path(project)
    assert_no_selector "polygon.panel-outline"
  end

  test "shape mode: dragging a vertex, inserting a midpoint, and removing vertices down to a floor of 3" do
    user = User.create!(name: "Interact", email: "bar3@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)

    select_panel
    bar_button("shape").click
    assert_selector ".floating-bar-button--active[data-bar-action='shape']"
    assert_selector ".panel-handle--vertex", count: 4
    assert_selector ".panel-handle--midpoint", count: 4

    # tap a midpoint to insert a new vertex
    all(".panel-handle--midpoint")[0].click
    assert_selector ".panel-handle--vertex", count: 5

    # drag the newly inserted vertex (index 1, between the original nw/ne corners)
    vertex = all(".panel-handle--vertex")[1]
    before_points = find("polygon.panel-outline[data-panel-id='p1']")["points"]
    drag_element_by(vertex, 15, -15) # small enough to stay on-page and visible
    after_points = find("polygon.panel-outline[data-panel-id='p1']")["points"]
    assert_not_equal before_points, after_points

    # double-tap vertices to remove them, down to the floor of 3
    all(".panel-handle--vertex")[0].double_click
    assert_selector ".panel-handle--vertex", count: 4

    all(".panel-handle--vertex")[0].double_click
    assert_selector ".panel-handle--vertex", count: 3

    # one more double-tap should refuse to go below 3
    all(".panel-handle--vertex")[0].double_click
    assert_selector ".panel-handle--vertex", count: 3

    sleep 1
    visit project_path(project)
    points_after_reload = find("polygon.panel-outline[data-panel-id='p1']")["points"]
    assert_equal 3, points_after_reload.split(" ").length
  end
end
