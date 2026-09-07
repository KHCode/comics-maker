require "test_helper"

class FoldersControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    sign_in_as @user
  end

  test "redirects to sign in when signed out" do
    sign_out
    get folders_path
    assert_redirected_to new_session_path
  end

  test "index lists only the current user's folders" do
    get folders_path
    assert_response :success
    assert_select "li", text: folders(:one).name
    assert_select "li", text: folders(:two).name, count: 0
  end

  test "index links each folder to its contents" do
    get folders_path
    assert_select "a[href=?]", folder_path(folders(:one)), text: folders(:one).name
  end

  test "show lists the current user's projects filed in that folder" do
    get folder_path(folders(:one))

    assert_response :success
    assert_select "h1", text: folders(:one).name
    assert_select "li", text: /#{projects(:one).name}/
  end

  test "show cannot be accessed for another user's folder" do
    get folder_path(folders(:two))
    assert_response :not_found
  end

  test "create adds a folder for the current user" do
    assert_difference "@user.folders.count", 1 do
      post folders_path, params: { folder: { name: "School Projects" } }
    end

    assert_equal "School Projects", @user.folders.order(:created_at).last.name
  end

  test "create with a project_id returns to that project's editor with the save dialog reopened" do
    project = @user.projects.create!(name: "Draft", format: :comic)

    post folders_path, params: { folder: { name: "Sketchbook Ideas" }, project_id: project.id }

    assert_redirected_to project_path(project, open_save: true)
  end

  test "create without a project_id falls back to the projects list" do
    post folders_path, params: { folder: { name: "Sketchbook Ideas" } }
    assert_redirected_to projects_path
  end

  test "create cannot be used to redirect to another user's project" do
    post folders_path, params: { folder: { name: "Sketchbook Ideas" }, project_id: projects(:two).id }
    assert_response :not_found
  end

  test "create rejects a duplicate folder name for the same user" do
    assert_no_difference "@user.folders.count" do
      post folders_path, params: { folder: { name: folders(:one).name } }
    end
    assert_redirected_to projects_path
    assert_match(/has already been taken/, flash[:alert])
  end
end
