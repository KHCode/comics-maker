require "test_helper"

class PagesControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    sign_in_as @user
  end

  test "update replaces a page's panels and texts" do
    project = @user.projects.create!(name: "Paginated", format: :comic)
    page = project.pages.create!(position: 1, name: "Page 1")

    panels = [ { "id" => "p1", "pts" => [ [ 0, 0 ], [ 100, 0 ], [ 100, 100 ], [ 0, 100 ] ], "strokes" => [], "photo" => nil } ]
    texts = [ { "id" => "t1", "kind" => "speech", "x" => 10, "y" => 10, "w" => 50, "h" => 20, "fs" => 16, "rot" => 0, "text" => "Hi!" } ]

    patch project_page_path(project, page), params: { page: { panels: panels, texts: texts } }, as: :json

    assert_response :no_content
    page.reload
    assert_equal panels, page.data["panels"]
    assert_equal texts, page.data["texts"]
  end

  test "update preserves schema_version and accepts an empty document" do
    project = @user.projects.create!(name: "Paginated", format: :comic)
    page = project.pages.create!(position: 1, name: "Page 1")

    patch project_page_path(project, page), params: { page: { panels: [], texts: [] } }, as: :json

    assert_response :no_content
    page.reload
    assert_equal 1, page.data["schema_version"]
    assert_equal [], page.data["panels"]
    assert_equal [], page.data["texts"]
  end

  test "update does not touch position or name" do
    project = @user.projects.create!(name: "Paginated", format: :comic)
    page = project.pages.create!(position: 1, name: "Page 1")

    patch project_page_path(project, page), params: { page: { panels: [], texts: [] } }, as: :json

    page.reload
    assert_equal 1, page.position
    assert_equal "Page 1", page.name
  end

  test "update rejects a request with no page param" do
    project = @user.projects.create!(name: "Paginated", format: :comic)
    page = project.pages.create!(position: 1, name: "Page 1")

    patch project_page_path(project, page), params: {}, as: :json

    assert_response :bad_request
  end

  test "cannot update another user's page" do
    other_project = projects(:two)
    other_page = pages(:two)

    patch project_page_path(other_project, other_page), params: { page: { panels: [], texts: [] } }, as: :json

    assert_response :not_found
  end

  test "create appends a page for a paginated project" do
    project = @user.projects.create!(name: "Paginated", format: :comic)
    project.pages.create!(position: 1, name: "Page 1")

    assert_difference "project.pages.count", 1 do
      post project_pages_path(project)
    end

    new_page = project.pages.order(:position).last
    assert_equal 2, new_page.position
    assert_equal "Page 2", new_page.name
    assert_redirected_to project_path(project)
  end

  test "create refuses to add a page to a webtoon project" do
    project = @user.projects.create!(name: "Scroll", format: :webtoon)
    project.pages.create!(position: 1, name: "Page 1", height_units: 1)

    assert_no_difference "project.pages.count" do
      post project_pages_path(project)
    end
    assert_redirected_to project_path(project)
  end

  test "destroy removes a page and shifts later pages' positions and default names down" do
    project = @user.projects.create!(name: "Paginated", format: :comic)
    page1 = project.pages.create!(position: 1, name: "Page 1")
    page2 = project.pages.create!(position: 2, name: "Page 2")
    page3 = project.pages.create!(position: 3, name: "Page 3")

    assert_difference "project.pages.count", -1 do
      delete project_page_path(project, page2)
    end

    assert_equal 1, page1.reload.position
    assert_equal "Page 1", page1.name
    assert_equal 2, page3.reload.position
    assert_equal "Page 2", page3.name
    assert_redirected_to project_path(project)
  end

  test "destroy does not rename a page whose default label was already customized" do
    project = @user.projects.create!(name: "Paginated", format: :comic)
    page1 = project.pages.create!(position: 1, name: "Page 1")
    page2 = project.pages.create!(position: 2, name: "Page 2")
    page3 = project.pages.create!(position: 3, name: "Cover")

    delete project_page_path(project, page2)

    assert_equal 2, page3.reload.position
    assert_equal "Cover", page3.name
  end

  test "destroy refuses to remove a project's only page" do
    project = @user.projects.create!(name: "Paginated", format: :comic)
    only_page = project.pages.create!(position: 1, name: "Page 1")

    assert_no_difference "project.pages.count" do
      delete project_page_path(project, only_page)
    end
    assert_redirected_to project_path(project)
  end

  test "cannot create or destroy pages on another user's project" do
    other_project = projects(:two)

    assert_no_difference "Page.count" do
      post project_pages_path(other_project)
    end
    assert_response :not_found

    assert_no_difference "Page.count" do
      delete project_page_path(other_project, pages(:two))
    end
    assert_response :not_found
  end

  test "grow increments height_units for a webtoon page" do
    project = @user.projects.create!(name: "Scroll", format: :webtoon)
    page = project.pages.create!(position: 1, name: "Page 1", height_units: 1)

    patch grow_project_page_path(project, page)

    assert_equal 2, page.reload.height_units
    assert_redirected_to project_path(project)
  end

  test "grow is rejected for a paginated project" do
    project = @user.projects.create!(name: "Paginated", format: :comic)
    page = project.pages.create!(position: 1, name: "Page 1")

    patch grow_project_page_path(project, page)

    assert_response :unprocessable_entity
    assert_nil page.reload.height_units
  end

  test "shrink decrements height_units for a webtoon page" do
    project = @user.projects.create!(name: "Scroll", format: :webtoon)
    page = project.pages.create!(position: 1, name: "Page 1", height_units: 2)

    patch shrink_project_page_path(project, page)

    assert_equal 1, page.reload.height_units
    assert_redirected_to project_path(project)
  end

  test "shrink refuses to go below one unit" do
    project = @user.projects.create!(name: "Scroll", format: :webtoon)
    page = project.pages.create!(position: 1, name: "Page 1", height_units: 1)

    patch shrink_project_page_path(project, page)

    assert_equal 1, page.reload.height_units
    assert_redirected_to project_path(project)
  end

  test "create, destroy, grow, and shrink all touch the project's updated_at" do
    project = @user.projects.create!(name: "Paginated", format: :comic, updated_at: 1.day.ago)
    project.pages.create!(position: 1, name: "Page 1")

    assert_changes -> { project.reload.updated_at } do
      post project_pages_path(project)
    end

    page = project.pages.order(:position).last
    assert_changes -> { project.reload.updated_at } do
      delete project_page_path(project, page)
    end

    webtoon = @user.projects.create!(name: "Scroll", format: :webtoon, updated_at: 1.day.ago)
    webtoon_page = webtoon.pages.create!(position: 1, name: "Page 1", height_units: 1)

    assert_changes -> { webtoon.reload.updated_at } do
      patch grow_project_page_path(webtoon, webtoon_page)
    end

    assert_changes -> { webtoon.reload.updated_at } do
      patch shrink_project_page_path(webtoon, webtoon_page)
    end
  end
end
