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

  test "index lists only the current user's unfiled projects" do
    get projects_path
    assert_response :success
    assert_select "li", text: /#{projects(:unfiled).name}/
    # filed into a folder — belongs on that folder's page, not here
    assert_select "li", text: /#{projects(:one).name}/, count: 0
    # a different user's project entirely
    assert_select "li", text: /#{projects(:two).name}/, count: 0
  end

  test "index does not list a project after it's moved into a folder" do
    project = @user.projects.create!(name: "Moving", format: :comic)
    folder = @user.folders.create!(name: "Sketchbook")

    get projects_path
    assert_select "li", text: /Moving/

    project.update!(folder: folder)

    get projects_path
    assert_select "li", text: /Moving/, count: 0
  end

  test "index orders projects by most recently updated first" do
    older = @user.projects.create!(name: "Older", format: :comic, updated_at: 2.days.ago)
    newer = @user.projects.create!(name: "Newer", format: :comic, updated_at: 1.hour.ago)

    get projects_path

    assert_response :success
    body = response.body
    assert body.index(newer.name) < body.index(older.name)
  end

  test "index shows each project's last-updated time and page count" do
    project = @user.projects.create!(name: "With Pages", format: :comic)
    project.pages.create!(position: 1, name: "Page 1")
    project.pages.create!(position: 2, name: "Page 2")

    get projects_path

    assert_select "li", text: /2 pages/
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

  test "show renders one page canvas per page, sized to the project's format" do
    project = @user.projects.create!(name: "Paginated", format: :comic)
    project.pages.create!(position: 1, name: "Page 1")
    project.pages.create!(position: 2, name: "Page 2")

    get project_path(project)

    assert_response :success
    assert_select "svg.page-canvas[viewBox=?]", "0 0 620 956", count: 2
    assert_select ".page-label", text: "Page 1"
    assert_select ".page-label", text: "Page 2"
    assert_select "form[action=?] button", project_pages_path(project), text: "+Page"
    assert_select "form[action=?]", project_page_path(project, project.pages.first)
  end

  test "show renders a growable webtoon page with no per-page delete button" do
    project = @user.projects.create!(name: "Scroll", format: :webtoon)
    project.pages.create!(position: 1, name: "Page 1", height_units: 2)

    get project_path(project)

    assert_response :success
    assert_select "svg.page-canvas[viewBox=?]", "0 0 500 3000"
    assert_select "form[action=?]", project_page_path(project, project.pages.first), count: 0
    assert_select "form[action=?]", grow_project_page_path(project, project.pages.first)
    assert_select "form[action=?] button:not([disabled])", shrink_project_page_path(project, project.pages.first)
  end

  test "show disables the Shorter button when the webtoon page is already at its shortest height" do
    project = @user.projects.create!(name: "Scroll", format: :webtoon)
    project.pages.create!(position: 1, name: "Page 1", height_units: 1)

    get project_path(project)

    assert_select "form[action=?] button[disabled]", shrink_project_page_path(project, project.pages.first)
  end

  test "show hides the per-page delete button when only one page remains" do
    project = @user.projects.create!(name: "Paginated", format: :comic)
    only_page = project.pages.create!(position: 1, name: "Page 1")

    get project_path(project)

    assert_select "form[action=?]", project_page_path(project, only_page), count: 0
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

  test "show embeds the save dialog for the current user's project" do
    project = @user.projects.create!(name: "Draft", format: :comic)

    get project_path(project)

    assert_response :success
    assert_select "dialog input[name=?][value=?]", "project[name]", "Draft"
    assert_select "dialog button[name=save_mode][value=save]"
    assert_select "dialog button[name=save_mode][value=save_as]"
  end

  test "show reopens the save dialog when open_save is present" do
    project = @user.projects.create!(name: "Draft", format: :comic)

    get project_path(project, open_save: true)

    assert_select "dialog[data-modal-open-value=?]", "true"
  end

  test "show does not reopen the save dialog on a normal visit" do
    project = @user.projects.create!(name: "Draft", format: :comic)

    get project_path(project)

    assert_select "dialog[data-modal-open-value=?]", "false"
  end

  test "update with save_mode=save renames the project" do
    project = @user.projects.create!(name: "Draft", format: :comic)

    patch project_path(project), params: { save_mode: "save", project: { name: "Field Trip Comic" } }

    assert_redirected_to project_path(project)
    assert_equal "Field Trip Comic", project.reload.name
  end

  test "a plain save (no save_mode) behaves like save_mode=save" do
    project = @user.projects.create!(name: "Draft", format: :comic)

    patch project_path(project), params: { project: { name: "Field Trip Comic" } }

    assert_redirected_to project_path(project)
    assert_equal "Field Trip Comic", project.reload.name
  end

  test "update moves the project into a folder owned by the current user" do
    project = @user.projects.create!(name: "Draft", format: :comic)
    folder = @user.folders.create!(name: "Sketchbook")

    patch project_path(project), params: { project: { name: "Draft", folder_id: folder.id } }

    assert_equal folder, project.reload.folder
  end

  test "update moves the project back to My Comics with a blank folder selection" do
    folder = @user.folders.create!(name: "Sketchbook")
    project = @user.projects.create!(name: "Draft", format: :comic, folder: folder)

    patch project_path(project), params: { project: { name: "Draft", folder_id: "" } }

    assert_nil project.reload.folder_id
  end

  test "update rejects moving into another user's folder" do
    project = @user.projects.create!(name: "Draft", format: :comic)

    patch project_path(project), params: { project: { name: "Draft", folder_id: folders(:two).id } }

    assert_response :unprocessable_entity
    assert_nil project.reload.folder_id
  end

  test "update re-renders the editor with the dialog reopened on a blank name" do
    project = @user.projects.create!(name: "Draft", format: :comic)

    patch project_path(project), params: { project: { name: "" } }

    assert_response :unprocessable_entity
    assert_equal "Draft", project.reload.name
    assert_select "dialog[data-modal-open-value=?]", "true"
    assert_select ".field-errors"
  end

  test "cannot update another user's project" do
    patch project_path(projects(:two)), params: { project: { name: "Hijacked" } }
    assert_response :not_found
  end

  test "update with save_mode=save_as creates a new project with copied pages, leaving the original untouched" do
    project = @user.projects.create!(name: "Original", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: { "schema_version" => 1, "panels" => [ { "id" => "p1" } ], "texts" => [] })
    project.pages.create!(position: 2, name: "Page 2")

    assert_difference "Project.count", 1 do
      assert_difference "Page.count", 2 do
        patch project_path(project), params: { save_mode: "save_as", project: { name: "Original copy" } }
      end
    end

    new_project = @user.projects.order(:created_at).last
    assert_redirected_to project_path(new_project)
    assert_equal "Original copy", new_project.name
    assert_equal project.format, new_project.format
    assert_equal 2, new_project.pages.count
    assert_equal [ { "id" => "p1" } ], new_project.pages.order(:position).first.data["panels"]

    # original is untouched
    assert_equal "Original", project.reload.name
    assert_equal 2, project.pages.count
  end

  test "save_as defaults to 'Copy of' the original name when left blank" do
    project = @user.projects.create!(name: "Original", format: :comic)
    project.pages.create!(position: 1, name: "Page 1")

    patch project_path(project), params: { save_mode: "save_as", project: { name: "" } }

    assert_equal "Copy of Original", @user.projects.order(:created_at).last.name
  end

  test "save_as can file the copy into a folder" do
    project = @user.projects.create!(name: "Original", format: :comic)
    project.pages.create!(position: 1, name: "Page 1")
    folder = @user.folders.create!(name: "Sketchbook")

    patch project_path(project), params: { save_mode: "save_as", project: { name: "Original copy", folder_id: folder.id } }

    assert_equal folder, @user.projects.order(:created_at).last.folder
  end

  test "save_as into another user's folder fails without creating a copy" do
    project = @user.projects.create!(name: "Original", format: :comic)
    project.pages.create!(position: 1, name: "Page 1")

    assert_no_difference "Project.count" do
      patch project_path(project), params: { save_mode: "save_as", project: { name: "Original copy", folder_id: folders(:two).id } }
    end

    assert_response :unprocessable_entity
  end

  test "cannot save_as another user's project" do
    assert_no_difference "Project.count" do
      patch project_path(projects(:two)), params: { save_mode: "save_as", project: { name: "Stolen" } }
    end
    assert_response :not_found
  end
end
