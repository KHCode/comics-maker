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
end
