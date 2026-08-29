require "test_helper"

class SessionTest < ActiveSupport::TestCase
  test "invalid without a user" do
    session = Session.new(ip_address: "127.0.0.1", user_agent: "test")
    assert_not session.valid?
  end

  test "valid with a user" do
    session = Session.new(user: users(:one), ip_address: "127.0.0.1", user_agent: "test")
    assert session.valid?
  end
end
