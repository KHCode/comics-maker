require "test_helper"

class ProjectsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    sign_in_as @user
  end

  test "redirects to sign in when signed out" do
    sign_out
    get projects_path
    assert_redirected_to new_session_path
  end

  test "index lists only the current user's projects" do
    get projects_path
    assert_response :success
    assert_select "li", text: /#{projects(:one).name}/
    assert_select "li", text: /#{projects(:two).name}/, count: 0
  end

  test "each format card posts format as a body param, not a URL/route extension" do
    get projects_path
    assert_response :success

    ProjectsHelper::FORMAT_PREVIEWS.each_key do |format|
      assert_select "form[action=?] input[name=format][value=?]", projects_path, format
    end
  end

  test "create builds a project and a blank first page for each format, then redirects to the editor" do
    %w[comic manga_b5 newspaper_strip webtoon].each do |format|
      assert_difference [ "Project.count", "Page.count" ], 1 do
        post projects_path, params: { format: format }
      end

      project = @user.projects.order(:created_at).last
      assert_equal format, project.format
      assert_equal 1, project.pages.count
      assert_equal 1, project.pages.first.position
      assert_redirected_to project_path(project)
    end
  end

  test "create sets height_units only for webtoon" do
    post projects_path, params: { format: "comic" }
    assert_nil @user.projects.order(:created_at).last.pages.first.height_units

    post projects_path, params: { format: "webtoon" }
    assert_equal 1, @user.projects.order(:created_at).last.pages.first.height_units
  end

  test "create rejects an invalid format" do
    assert_no_difference "Project.count" do
      post projects_path, params: { format: "supersized" }
    end
    assert_redirected_to projects_path
  end

  test "show renders the editor shell for the current user's project" do
    project = projects(:one)

    get project_path(project)

    assert_response :success
    assert_select ".editor[data-controller=?]", "editor"
    assert_select ".mode-tab[data-mode=?]", "layout"
    assert_select ".mode-tab[data-mode=?]", "draw"
    assert_select ".mode-tab[data-mode=?]", "letter"
    assert_select ".contextual-tray[data-mode=?]", "layout", count: 1
    assert_select ".contextual-tray[data-mode=?]", "draw", count: 1
    assert_select ".contextual-tray[data-mode=?]", "letter", count: 1
  end

  test "show cannot be accessed for another user's project" do
    get project_path(projects(:two))
    assert_response :not_found
  end

  test "destroy removes the current user's project" do
    project = @user.projects.create!(name: "Throwaway", format: :comic)

    assert_difference "Project.count", -1 do
      delete project_path(project)
    end
    assert_redirected_to projects_path
  end

  test "destroy cannot remove another user's project" do
    other_project = projects(:two)

    assert_no_difference "Project.count" do
      delete project_path(other_project)
    end
    assert_response :not_found
  end
end
