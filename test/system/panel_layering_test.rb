require "application_system_test_case"

class PanelLayeringTest < ApplicationSystemTestCase
  def sign_in(user)
    visit new_session_path
    fill_in "Email", with: user.email
    fill_in "Password", with: "password123"
    click_button "Sign in"
    assert_text "Signed in as #{user.name}"
  end

  # p1 and p2 overlap (200..300 on both axes) so occlusion/stacking is
  # actually observable, not just theoretical.
  def create_project_with_two_panels(user)
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [
        { "id" => "p1", "pts" => [ [ 100, 100 ], [ 300, 100 ], [ 300, 300 ], [ 100, 300 ] ], "strokes" => [], "photo" => nil },
        { "id" => "p2", "pts" => [ [ 200, 200 ], [ 400, 200 ], [ 400, 400 ], [ 200, 400 ] ], "strokes" => [], "photo" => nil }
      ],
      "texts" => []
    })
    project
  end

  def select_panel(panel_id)
    find("polygon.panel-outline[data-panel-id='#{panel_id}']").click
  end

  def bar_button(action)
    find("[data-bar-action='#{action}']")
  end

  def stored_panel_ids
    page.evaluate_script(<<~JS)
      (() => {
        const pageEl = document.querySelector('[data-controller~="document-store"]')
        const controller = window.Stimulus.getControllerForElementAndIdentifier(pageEl, "document-store")
        return controller.store.getState().panels.map((p) => p.id)
      })()
    JS
  end

  test "panels are opaque: a panel's own background always paints white, not see-through" do
    user = User.create!(name: "Layers", email: "layer1@kapow.test", password: "password123")
    project = create_project_with_two_panels(user)

    sign_in(user)
    visit project_path(project)

    fill = find(".panel-background[data-panel-id='p1']", visible: :all).native.css_value("fill")
    assert_equal "rgb(255, 255, 255)", fill
  end

  test "panels paint in array order, so a later panel visually stacks on top of an earlier one" do
    user = User.create!(name: "Layers", email: "layer2@kapow.test", password: "password123")
    project = create_project_with_two_panels(user)

    sign_in(user)
    visit project_path(project)

    backgrounds = all(".panel-background", visible: :all)
    assert_equal %w[p1 p2], backgrounds.map { |el| el["data-panel-id"] }
  end

  test "duplicating a panel puts the clone on top, at the front of the stacking order" do
    user = User.create!(name: "Layers", email: "layer3@kapow.test", password: "password123")
    project = create_project_with_two_panels(user)

    sign_in(user)
    visit project_path(project)

    select_panel("p1")
    bar_button("duplicate").click

    ids = stored_panel_ids
    assert_equal 3, ids.length
    duplicate_id = ids.last
    refute_includes %w[p1 p2], duplicate_id

    backgrounds = all(".panel-background", visible: :all)
    assert_equal duplicate_id, backgrounds.last["data-panel-id"]
  end

  test "the floating bar's layer button toggles the selected panel between front and back" do
    user = User.create!(name: "Layers", email: "layer4@kapow.test", password: "password123")
    project = create_project_with_two_panels(user)

    sign_in(user)
    visit project_path(project)

    # p2 is already frontmost (last in the seeded array) — the button
    # should read as "send to back" from the start.
    select_panel("p2")
    assert_equal "⬇", bar_button("layer").text

    bar_button("layer").click
    assert_equal %w[p2 p1], stored_panel_ids
    assert_equal %w[p2 p1], all(".panel-background", visible: :all).map { |el| el["data-panel-id"] }

    # p2 is no longer frontmost, so the same button now reads "bring to
    # front" instead — this is one toggling button, not two fixed ones.
    assert_equal "⬆", bar_button("layer").text

    bar_button("layer").click
    assert_equal %w[p1 p2], stored_panel_ids
    assert_equal "⬇", bar_button("layer").text
  end

  test "sending the back panel to front persists across a reload" do
    user = User.create!(name: "Layers", email: "layer5@kapow.test", password: "password123")
    project = create_project_with_two_panels(user)

    sign_in(user)
    visit project_path(project)

    select_panel("p1")
    assert_equal "⬆", bar_button("layer").text
    bar_button("layer").click
    assert_equal %w[p2 p1], stored_panel_ids

    sleep 1 # let the debounced save land
    visit project_path(project)
    assert_equal %w[p2 p1], stored_panel_ids
  end
end
