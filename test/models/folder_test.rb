require "test_helper"

class FolderTest < ActiveSupport::TestCase
  test "valid with a user and a name" do
    folder = Folder.new(user: users(:one), name: "My Comics")
    assert folder.valid?
  end

  test "invalid without a name" do
    folder = Folder.new(user: users(:one), name: nil)
    assert_not folder.valid?
  end

  test "invalid with a duplicate name for the same user" do
    duplicate = Folder.new(user: users(:one), name: folders(:one).name)
    assert_not duplicate.valid?
  end

  test "valid with a duplicate name for a different user" do
    project = Folder.new(user: users(:two), name: folders(:one).name)
    assert project.valid?
  end

  test "destroying a folder nullifies its projects rather than destroying them" do
    folder = folders(:one)
    project = projects(:one)
    assert_equal folder, project.folder

    assert_no_difference "Project.count" do
      folder.destroy
    end
    assert_nil project.reload.folder_id
  end
end
