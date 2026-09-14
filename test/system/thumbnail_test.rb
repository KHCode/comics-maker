require "application_system_test_case"

# Phase 10 fast-follow: a Projects-screen thumbnail, generated client-side
# from the first page's own rasterization pipeline (see editor_controller
# .js#renderThumbnailBlob) and uploaded whenever Save/Save As is actually
# submitted (see save_dialog_controller.js) — see Project#thumbnail.
class ThumbnailTest < ApplicationSystemTestCase
  def sign_in(user)
    visit new_session_path
    fill_in "Email", with: user.email
    fill_in "Password", with: "password123"
    click_button "Sign in"
    assert_text "Signed in as #{user.name}"
  end

  test "a project with no thumbnail yet shows the format-shaped placeholder on the list" do
    user = User.create!(name: "Saver", email: "thumb1@kapow.test", password: "password123")
    project = user.projects.create!(name: "Fresh Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1, "panels" => [], "texts" => []
    })

    sign_in(user)
    visit projects_path

    assert_selector ".project-thumbnail-placeholder.format-preview--comic"
    assert_no_selector "img.project-thumbnail"
  end

  test "clicking Save renders and attaches a real thumbnail, which then appears on the Projects list" do
    user = User.create!(name: "Saver", email: "thumb2@kapow.test", password: "password123")
    project = user.projects.create!(name: "My Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [ { "id" => "p1", "pts" => [ [ 100, 100 ], [ 300, 100 ], [ 300, 300 ], [ 100, 300 ] ], "strokes" => [], "photo" => nil } ],
      "texts" => []
    })

    sign_in(user)
    visit project_path(project)

    click_button "Save"
    within("dialog") { click_button "Save" }

    assert_text "Saved."
    assert project.reload.thumbnail.attached?
    assert_equal "image/jpeg", project.thumbnail.content_type

    visit projects_path
    assert_selector "img.project-thumbnail"
    assert_no_selector ".project-thumbnail-placeholder"
  end

  test "thumbnails and placeholders render at the same fixed size across every format" do
    user = User.create!(name: "Saver", email: "thumb4@kapow.test", password: "password123")
    comic = user.projects.create!(name: "Comic Shaped", format: :comic)
    comic.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [ { "id" => "p1", "pts" => [ [ 100, 100 ], [ 300, 100 ], [ 300, 300 ], [ 100, 300 ] ], "strokes" => [], "photo" => nil } ],
      "texts" => []
    })
    strip = user.projects.create!(name: "Strip Shaped", format: :newspaper_strip)
    strip.pages.create!(position: 1, name: "Page 1", data: { "schema_version" => 1, "panels" => [], "texts" => [] })

    sign_in(user)
    visit project_path(comic)
    click_button "Save"
    within("dialog") { click_button "Save" }
    assert_text "Saved."

    visit projects_path

    sizes = all(".project-thumbnail, .project-thumbnail-placeholder").map do |el|
      el.native.size.to_a
    end

    assert_equal 2, sizes.length
    assert_equal [ sizes.first ], sizes.uniq # a wide strip and a tall comic render at the identical box size
  end

  test "Save As carries the original project's thumbnail over to the new copy" do
    user = User.create!(name: "Saver", email: "thumb3@kapow.test", password: "password123")
    project = user.projects.create!(name: "Original", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [ { "id" => "p1", "pts" => [ [ 100, 100 ], [ 300, 100 ], [ 300, 300 ], [ 100, 300 ] ], "strokes" => [], "photo" => nil } ],
      "texts" => []
    })

    sign_in(user)
    visit project_path(project)

    click_button "Save"
    within("dialog") do
      fill_in "Name", with: "Copy of Original"
      click_button "Save As…"
    end

    assert_text "Saved a copy"
    new_project = user.projects.order(:created_at).last
    assert_equal "Copy of Original", new_project.name
    assert new_project.thumbnail.attached?
  end
end
