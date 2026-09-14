require "application_system_test_case"

# Phase 10 fast-follow: renaming a project directly from the Projects list
# (or a folder's contents), without opening the full editor's Save dialog —
# see projects/_project.html.erb and ProjectsController#save_project's
# return_to handling.
class InlineRenameTest < ApplicationSystemTestCase
  def sign_in(user)
    visit new_session_path
    fill_in "Email", with: user.email
    fill_in "Password", with: "password123"
    click_button "Sign in"
    assert_text "Signed in as #{user.name}"
  end

  test "renaming a project from the Projects list stays on that list" do
    user = User.create!(name: "Renamer", email: "rename1@kapow.test", password: "password123")
    user.projects.create!(name: "Old Name", format: :comic)

    sign_in(user)
    visit projects_path

    fill_in "Rename Old Name", with: "New Name"
    click_button "Rename"

    assert_current_path projects_path
    assert_selector "input[value='New Name']"
    assert_no_selector "input[value='Old Name']"
  end

  test "renaming a project from within a folder's tab stays on the Projects page" do
    user = User.create!(name: "Renamer", email: "rename2@kapow.test", password: "password123")
    folder = user.folders.create!(name: "Sketchbook")
    project = user.projects.create!(name: "Old Name", format: :comic, folder: folder)

    sign_in(user)
    visit projects_path
    click_button "Sketchbook" # switch to that folder's tab (see project_tabs_controller.js)

    fill_in "Rename Old Name", with: "New Name"
    click_button "Rename"

    assert_current_path projects_path
    assert_equal "New Name", project.reload.name

    # The page reload resets the tab selection back to "My Comics" — switch
    # back to confirm the rename actually took, not just the redirect.
    click_button "Sketchbook"
    assert_selector "input[value='New Name']"
  end

  test "clearing the name and renaming shows a validation alert and stays on the list" do
    user = User.create!(name: "Renamer", email: "rename3@kapow.test", password: "password123")
    user.projects.create!(name: "Old Name", format: :comic)

    sign_in(user)
    visit projects_path

    # A whitespace-only name passes the field's HTML5 `required` (non-empty)
    # check client-side, but still fails the model's presence validation
    # (which strips whitespace) server-side — an empty string wouldn't even
    # leave the browser, so this is what actually exercises that path.
    fill_in "Rename Old Name", with: "   "
    click_button "Rename"

    assert_current_path projects_path
    assert_text "Name can't be blank"
    assert_selector "input[value='Old Name']"
  end
end
