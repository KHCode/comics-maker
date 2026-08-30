require "test_helper"

class PageTest < ActiveSupport::TestCase
  def valid_attributes
    { project: projects(:one), position: 5, name: "Page 5" }
  end

  test "valid with a project, position, and name" do
    assert Page.new(valid_attributes).valid?
  end

  test "invalid without a name" do
    page = Page.new(valid_attributes.merge(name: nil))
    assert_not page.valid?
  end

  test "invalid without a position" do
    page = Page.new(valid_attributes.merge(position: nil))
    assert_not page.valid?
  end

  test "invalid with a duplicate position within the same project" do
    page = Page.new(valid_attributes.merge(position: pages(:one).position))
    assert_not page.valid?
  end

  test "valid with the same position number in a different project" do
    other_project = Project.create!(user: users(:one), name: "Another Comic", format: :comic)
    page = Page.new(project: other_project, position: pages(:one).position, name: "Page")
    assert page.valid?
  end

  test "defaults data to an empty schema" do
    page = Page.new(valid_attributes)
    assert_equal({ "schema_version" => 1, "panels" => [], "texts" => [] }, page.data)
  end

  test "height_units is nullable" do
    page = Page.new(valid_attributes.merge(height_units: nil))
    assert page.valid?
  end

  test "height is the format's fixed unit height for paginated formats" do
    page = Page.new(valid_attributes.merge(project: projects(:one))) # comic
    assert_equal 956, page.height
  end

  test "height is unit_height times height_units for webtoon" do
    webtoon_project = Project.create!(user: users(:one), name: "Scroll Comic", format: :webtoon)
    page = Page.new(project: webtoon_project, position: 1, name: "Page 1", height_units: 3)
    assert_equal 4500, page.height
  end

  test "webtoon height defaults to one unit when height_units is nil" do
    webtoon_project = Project.create!(user: users(:one), name: "Scroll Comic", format: :webtoon)
    page = Page.new(project: webtoon_project, position: 1, name: "Page 1", height_units: nil)
    assert_equal 1500, page.height
  end
end
