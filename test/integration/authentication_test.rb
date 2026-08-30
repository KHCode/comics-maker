require "test_helper"

class AuthenticationTest < ActionDispatch::IntegrationTest
  test "visiting a protected page while signed out redirects to sign in" do
    get root_path
    assert_redirected_to new_session_path
  end

  test "signing up creates an account, signs in, and redirects to root" do
    assert_difference "User.count", 1 do
      post users_path, params: { user: { name: "Alex", email: "alex@example.com", password: "password123" } }
    end

    assert_redirected_to root_path
    follow_redirect!
    assert_match "Signed in as Alex", response.body
  end

  test "signing up with invalid data re-renders the form" do
    assert_no_difference "User.count" do
      post users_path, params: { user: { name: "", email: "not-an-email", password: "short" } }
    end

    assert_response :unprocessable_entity
  end

  test "signing in with correct credentials redirects to root" do
    user = User.create!(name: "Alex", email: "alex@example.com", password: "password123")

    post session_path, params: { email: user.email, password: "password123" }

    assert_redirected_to root_path
    follow_redirect!
    assert_match "Signed in as Alex", response.body
  end

  test "signing in with incorrect credentials redirects back to sign in" do
    User.create!(name: "Alex", email: "alex@example.com", password: "password123")

    post session_path, params: { email: "alex@example.com", password: "wrongpassword" }

    assert_redirected_to new_session_path
  end

  test "signing out ends the session" do
    user = User.create!(name: "Alex", email: "alex@example.com", password: "password123")
    post session_path, params: { email: user.email, password: "password123" }

    delete session_path
    assert_redirected_to new_session_path

    get root_path
    assert_redirected_to new_session_path
  end
end
