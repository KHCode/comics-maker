require "application_system_test_case"

# Folders are tabs on the Projects screen itself (see
# project_tabs_controller.js and ProjectsController#index) rather than a
# separate page — every folder and its contents should be viewable
# without navigating away from the root page.
class ProjectTabsTest < ApplicationSystemTestCase
  def sign_in(user)
    visit new_session_path
    fill_in "Email", with: user.email
    fill_in "Password", with: "password123"
    click_button "Sign in"
    assert_text "Signed in as #{user.name}"
  end

  test "switching between the My Comics tab and a folder tab reveals each one's own projects, without navigating away" do
    user = User.create!(name: "Browser", email: "tabs1@kapow.test", password: "password123")
    folder = user.folders.create!(name: "Sketchbook")
    user.projects.create!(name: "Unfiled Comic", format: :comic)
    user.projects.create!(name: "Filed Comic", format: :comic, folder: folder)

    sign_in(user)
    visit projects_path

    assert_selector "input[value='Unfiled Comic']"
    assert_no_selector "input[value='Filed Comic']", visible: :visible
    assert_selector "input[value='Filed Comic']", visible: :all # present, just hidden

    click_button "Sketchbook"

    assert_current_path projects_path # still the same page, no navigation
    assert_selector "input[value='Filed Comic']"
    assert_no_selector "input[value='Unfiled Comic']", visible: :visible

    click_button "My Comics"

    assert_selector "input[value='Unfiled Comic']"
    assert_no_selector "input[value='Filed Comic']", visible: :visible
  end

  test "a folder with no projects in it shows its own empty message on its tab" do
    user = User.create!(name: "Browser", email: "tabs2@kapow.test", password: "password123")
    user.folders.create!(name: "Empty Folder")

    sign_in(user)
    visit projects_path
    click_button "Empty Folder"

    assert_text "Nothing in this folder yet."
  end

  test "with no folders at all, no tab bar appears" do
    user = User.create!(name: "Browser", email: "tabs3@kapow.test", password: "password123")
    user.projects.create!(name: "Solo Comic", format: :comic)

    sign_in(user)
    visit projects_path

    assert_no_selector ".project-tabs"
    assert_selector "input[value='Solo Comic']"
  end
end
