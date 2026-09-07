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

  test "applying a Webtoon preset replaces panels on the newest page" do
    user = User.create!(name: "Preset Tester", email: "preset-webtoon@kapow.test", password: "password123")
    project = user.projects.create!(name: "Scroll", format: :webtoon)
    project.pages.create!(position: 1, name: "Page 1", height_units: 1)

    sign_in(user)
    visit project_path(project)

    click_button "5 stacked"
    assert_selector "svg.page-canvas polygon.panel-outline", count: 5

    click_button "Tall + 2"
    assert_selector "svg.page-canvas polygon.panel-outline", count: 3
  end
end
