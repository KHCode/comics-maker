require "test_helper"

class UserTest < ActiveSupport::TestCase
  def valid_attributes
    { name: "Alex", email: "alex@example.com", password: "password123" }
  end

  test "valid with name, email, and password" do
    assert User.new(valid_attributes).valid?
  end

  test "invalid without a name" do
    user = User.new(valid_attributes.merge(name: nil))
    assert_not user.valid?
  end

  test "invalid without an email" do
    user = User.new(valid_attributes.merge(email: nil))
    assert_not user.valid?
  end

  test "invalid with a malformed email" do
    user = User.new(valid_attributes.merge(email: "not-an-email"))
    assert_not user.valid?
  end

  test "invalid with a duplicate email" do
    User.create!(valid_attributes)
    duplicate = User.new(valid_attributes.merge(name: "Someone Else"))
    assert_not duplicate.valid?
  end

  test "email is normalized to lowercase" do
    user = User.create!(valid_attributes.merge(email: "  ALEX@Example.com  "))
    assert_equal "alex@example.com", user.email
  end

  test "invalid with a short password" do
    user = User.new(valid_attributes.merge(password: "short"))
    assert_not user.valid?
  end

  test "invalid without a password on create" do
    user = User.new(valid_attributes.merge(password: nil))
    assert_not user.valid?
  end

  test "authenticate returns the user for the correct password" do
    user = User.create!(valid_attributes)
    assert_equal user, user.authenticate("password123")
  end

  test "authenticate returns false for the wrong password" do
    user = User.create!(valid_attributes)
    assert_not user.authenticate("wrongpassword")
  end
end
