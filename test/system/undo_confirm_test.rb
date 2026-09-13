require "application_system_test_case"

# Phase 10 fast-follow (see the plan's "Undo spanning project switches"):
# leaving the editor via the header logo is an ordinary page navigation
# that discards session-only undo history (see document_store.js), so this
# warns first whenever there's undo history that would actually be lost —
# see editor_controller.js#confirmLeaveIfUnsavedHistory.
class UndoConfirmTest < ApplicationSystemTestCase
  def sign_in(user)
    visit new_session_path
    fill_in "Email", with: user.email
    fill_in "Password", with: "password123"
    click_button "Sign in"
    assert_text "Signed in as #{user.name}"
  end

  def create_blank_project(user, name: "My Comic")
    project = user.projects.create!(name: name, format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1, "panels" => [], "texts" => []
    })
    project
  end

  test "leaving via the logo with no undo history navigates straight to Projects, no confirmation" do
    user = User.create!(name: "Editor", email: "undoconfirm1@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)

    click_link "Kapow!"
    assert_text "My Comics"
  end

  test "leaving via the logo with undo history prompts for confirmation, and dismissing keeps you on the editor" do
    user = User.create!(name: "Editor", email: "undoconfirm2@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    click_button "Box" # gives the page undo history (see document_store's canUndo)
    assert_not find("[data-editor-target='undoButton']").disabled?

    dismiss_confirm do
      click_link "Kapow!"
    end

    assert_selector "polygon.panel-outline" # still on the editor, panel still there
  end

  test "leaving via the logo with undo history and accepting the confirmation navigates to Projects" do
    user = User.create!(name: "Editor", email: "undoconfirm3@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    click_button "Box"
    assert_not find("[data-editor-target='undoButton']").disabled?

    accept_confirm do
      click_link "Kapow!"
    end

    assert_text "My Comics"
  end
end
