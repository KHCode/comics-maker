require "application_system_test_case"

class LayoutModeTest < ApplicationSystemTestCase
  def sign_in(user)
    visit new_session_path
    fill_in "Email", with: user.email
    fill_in "Password", with: "password123"
    click_button "Sign in"
    assert_text "Signed in as #{user.name}"
  end

  test "empty-state hint shows on a blank project and disappears after adding a panel" do
    user = User.create!(name: "Layout Tester", email: "layout-tester@kapow.test", password: "password123")
    project = user.projects.create!(name: "Blank Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1")

    sign_in(user)
    visit project_path(project)

    assert_selector ".empty-state-hint", text: /This comic is empty/

    within(".mode-tabs") { click_button "Layout" }
    click_button "Box"

    assert_selector "svg.page-canvas polygon.panel-outline", count: 1
    assert_no_selector ".empty-state-hint", visible: true
  end

  test "adding a panel persists to the server, not just the DOM" do
    user = User.create!(name: "Layout Tester", email: "layout-tester2@kapow.test", password: "password123")
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1")

    sign_in(user)
    visit project_path(project)

    click_button "Burst"
    assert_selector "svg.page-canvas polygon.panel-outline", count: 1

    # give the document store's debounced save (800ms) time to land
    sleep 1

    visit project_path(project)
    assert_selector "svg.page-canvas polygon.panel-outline", count: 1
  end

  test "adding several panels offsets them instead of stacking exactly" do
    user = User.create!(name: "Layout Tester", email: "layout-tester3@kapow.test", password: "password123")
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1")

    sign_in(user)
    visit project_path(project)

    click_button "Box"
    click_button "Box"

    points = all("svg.page-canvas polygon.panel-outline", count: 2).map { |el| el["points"] }
    assert_not_equal points[0], points[1]
  end

  test "applying a Comic preset replaces panels on the newest page" do
    user = User.create!(name: "Preset Tester", email: "preset-comic@kapow.test", password: "password123")
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1")

    sign_in(user)
    visit project_path(project)

    click_button "2×2"
    assert_selector "svg.page-canvas polygon.panel-outline", count: 4

    click_button "3 Rows"
    assert_selector "svg.page-canvas polygon.panel-outline", count: 3
  end

  test "applying a Manga B5 preset replaces panels on the newest page" do
    user = User.create!(name: "Preset Tester", email: "preset-manga@kapow.test", password: "password123")
    project = user.projects.create!(name: "Manga", format: :manga_b5)
    project.pages.create!(position: 1, name: "Page 1")

    sign_in(user)
    visit project_path(project)

    click_button "4-koma"
    assert_selector "svg.page-canvas polygon.panel-outline", count: 4

    click_button "Action"
    assert_selector "svg.page-canvas polygon.panel-outline", count: 3
  end

  test "applying a Newspaper strip preset replaces panels on the newest page" do
    user = User.create!(name: "Preset Tester", email: "preset-news@kapow.test", password: "password123")
    project = user.projects.create!(name: "Strip", format: :newspaper_strip)
    project.pages.create!(position: 1, name: "Page 1")

    sign_in(user)
    visit project_path(project)

    click_button "4 across"
    assert_selector "svg.page-canvas polygon.panel-outline", count: 4

    click_button "Big + 1"
    assert_selector "svg.page-canvas polygon.panel-outline", count: 2
  end

  test "applying a Webtoon preset appends panels instead of replacing existing ones" do
    user = User.create!(name: "Preset Tester", email: "preset-webtoon@kapow.test", password: "password123")
    project = user.projects.create!(name: "Scroll", format: :webtoon)
    project.pages.create!(position: 1, name: "Page 1", height_units: 1)

    sign_in(user)
    visit project_path(project)

    click_button "5 stacked"
    assert_selector "svg.page-canvas polygon.panel-outline", count: 5

    # Webtoon has no page seams — a fresh preset can't "replace panels on
    # the page" the way a paginated format's preset does, since there's
    # only ever one, ever-growing page. It appends a new section instead.
    click_button "Tall + 2"
    assert_selector "svg.page-canvas polygon.panel-outline", count: 8
  end

  test "a Webtoon preset applied after growing the page fills the new section, without wiping or stretching what was already there" do
    user = User.create!(name: "Preset Tester", email: "preset-webtoon-grow@kapow.test", password: "password123")
    project = user.projects.create!(name: "Scroll", format: :webtoon)
    project.pages.create!(position: 1, name: "Page 1", height_units: 1)

    sign_in(user)
    visit project_path(project)

    click_button "3 stacked"
    assert_selector "svg.page-canvas polygon.panel-outline", count: 3
    first_batch_points = all("svg.page-canvas polygon.panel-outline").map { |el| el["points"] }

    sleep 1 # let the debounced save land before "Longer" triggers a full-page reload
    click_button "↓ Longer"
    # "↑ Shorter" is disabled at height_units <= 1 — waiting for it to enable
    # confirms the grow round-trip (a full Turbo navigation) has landed.
    assert_selector :button, "↑ Shorter", disabled: false

    click_button "3 stacked"
    assert_selector "svg.page-canvas polygon.panel-outline", count: 6

    current_points = all("svg.page-canvas polygon.panel-outline").map { |el| el["points"] }
    assert (first_batch_points - current_points).empty?, "expected the original 3 panels to be unchanged, not wiped or stretched"

    # the newly appended panels sit within the second (newly grown) unit,
    # not stretched across the full, now-3000-tall page
    new_panel_min_ys = (current_points - first_batch_points).map do |points|
      points.split(" ").map { |point| point.split(",")[1].to_f }.min
    end
    assert new_panel_min_ys.all? { |y| y >= 1500 }, "expected new panels to start after the first unit (y >= 1500), got: #{new_panel_min_ys}"
  end

  test "Add panel and presets target the newest page by default" do
    user = User.create!(name: "Page Target Tester", email: "page-target-default@kapow.test", password: "password123")
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1")
    project.pages.create!(position: 2, name: "Page 2")

    sign_in(user)
    visit project_path(project)

    pages = all(".page")
    click_button "Box"

    within(pages.last) { assert_selector "polygon.panel-outline", count: 1 }
    within(pages.first) { assert_no_selector "polygon.panel-outline" }
  end

  test "clicking an earlier page selects it as the target for Add panel and presets" do
    user = User.create!(name: "Page Target Tester", email: "page-target-select@kapow.test", password: "password123")
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1")
    project.pages.create!(position: 2, name: "Page 2")

    sign_in(user)
    visit project_path(project)

    pages = all(".page")
    pages.first.find(".page-label").click
    assert pages.first[:class].split.include?("page--active"), "expected the clicked page to be marked active"

    click_button "Box"

    within(pages.first) { assert_selector "polygon.panel-outline", count: 1 }
    within(pages.last) { assert_no_selector "polygon.panel-outline" }
  end

  test "selecting a panel on an earlier page also targets that page for Add panel and presets" do
    user = User.create!(name: "Page Target Tester", email: "page-target-panel@kapow.test", password: "password123")
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [ { "id" => "p1", "pts" => [ [ 100, 100 ], [ 300, 100 ], [ 300, 300 ], [ 100, 300 ] ], "strokes" => [], "photo" => nil } ],
      "texts" => []
    })
    project.pages.create!(position: 2, name: "Page 2")

    sign_in(user)
    visit project_path(project)

    pages = all(".page")
    # a panel click's pointerdown calls preventDefault, which suppresses
    # the compatibility "click" event a plain click->editor#selectPage
    # binding would rely on — this exercises the panel:selected event
    # instead (see panel_controller.js#startMove).
    find("polygon.panel-outline[data-panel-id='p1']").click
    assert pages.first[:class].split.include?("page--active"), "expected selecting a panel on page 1 to mark it active"

    click_button "Box"

    within(pages.first) { assert_selector "polygon.panel-outline", count: 2 }
    within(pages.last) { assert_no_selector "polygon.panel-outline" }
  end
end
