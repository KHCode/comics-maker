require "application_system_test_case"

# A minimal end-to-end check that the whole system-test pipeline actually
# works (real headless Chrome, real JS, real form submission) — sign up,
# land on Projects, create a comic, land in the editor, open the Save
# dialog via its real Stimulus-driven <dialog>.
class SmokeTest < ApplicationSystemTestCase
  test "sign up, create a comic, and open the Save dialog" do
    visit new_user_path

    fill_in "Name", with: "System Test"
    fill_in "Email", with: "system-test@kapow.test"
    fill_in "Password", with: "password123"
    click_button "Sign up"

    assert_text "Signed in as System Test"

    click_button "Comic"
    assert_selector ".editor-project-name", text: /Comic #\d+/

    click_button "Save"
    assert_selector "dialog[open]"
    within "dialog" do
      assert_field "project_name"
    end
  end
end
