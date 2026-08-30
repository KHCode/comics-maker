require "test_helper"

class ProjectTest < ActiveSupport::TestCase
  def valid_attributes
    { user: users(:one), name: "New Comic", format: :comic }
  end

  test "valid with a user, name, and format" do
    assert Project.new(valid_attributes).valid?
  end

  test "valid without a folder" do
    project = Project.new(valid_attributes.merge(folder: nil))
    assert project.valid?
  end

  test "invalid without a name" do
    project = Project.new(valid_attributes.merge(name: nil))
    assert_not project.valid?
  end

  test "invalid without a format" do
    project = Project.new(valid_attributes.merge(format: nil))
    assert_not project.valid?
  end

  test "invalid with a folder belonging to a different user" do
    project = Project.new(valid_attributes.merge(folder: folders(:two)))
    assert_not project.valid?
    assert_includes project.errors[:folder], "must belong to the same user"
  end

  test "valid with a folder belonging to the same user" do
    project = Project.new(valid_attributes.merge(folder: folders(:one)))
    assert project.valid?
  end

  test "exposes the four page formats" do
    assert_equal %w[comic manga_b5 newspaper_strip webtoon], Project.formats.keys
  end

  test "deleting a project destroys its pages" do
    project = projects(:one)
    assert_difference "Page.count", -project.pages.count do
      project.destroy
    end
  end
end
