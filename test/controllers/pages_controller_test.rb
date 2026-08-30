require "test_helper"

class PagesControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    sign_in_as @user
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
end
