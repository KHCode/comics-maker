require "application_system_test_case"

# Trackpad ctrl+scroll and touchscreen pinch (see editor_controller.js#
# handleWheelZoom/handleTouchStart/handleTouchMove) — layered on top of the
# zoom +/- buttons from canvas_zoom_test.rb, not a replacement for them.
class CanvasZoomGesturesTest < ApplicationSystemTestCase
  def sign_in(user)
    visit new_session_path
    fill_in "Email", with: user.email
    fill_in "Password", with: "password123"
    click_button "Sign in"
    assert_text "Signed in as #{user.name}"
  end

  def zoom_level_text
    find("[data-editor-target='zoomLevel']").text
  end

  def dispatch_ctrl_wheel(delta_y)
    page.evaluate_script(<<~JS)
      document.querySelector(".editor-canvas").dispatchEvent(
        new WheelEvent("wheel", { deltaY: #{delta_y}, ctrlKey: true, cancelable: true, bubbles: true })
      )
    JS
  end

  def dispatch_plain_wheel(delta_y)
    page.evaluate_script(<<~JS)
      document.querySelector(".editor-canvas").dispatchEvent(
        new WheelEvent("wheel", { deltaY: #{delta_y}, ctrlKey: false, cancelable: true, bubbles: true })
      )
    JS
  end

  # Synthetic two-finger touch sequence: start at (startX1,startY1)/
  # (startX2,startY2), then move to (endX1,endY1)/(endX2,endY2) — models a
  # pinch as a pair of touchstart/touchmove events, the same shape
  # handleTouchStart/handleTouchMove actually read (touches.length,
  # clientX/clientY), since Selenium's own action API has no built-in
  # multi-touch pinch gesture to drive this with directly.
  def dispatch_pinch(start_points, end_points)
    page.evaluate_script(<<~JS)
      (() => {
        const target = document.querySelector(".editor-canvas")
        const makeTouches = (points) => points.map(([ x, y ], i) => new Touch({
          identifier: i, target, clientX: x, clientY: y
        }))

        target.dispatchEvent(new TouchEvent("touchstart", {
          touches: makeTouches(#{start_points.to_json}), cancelable: true, bubbles: true
        }))
        target.dispatchEvent(new TouchEvent("touchmove", {
          touches: makeTouches(#{end_points.to_json}), cancelable: true, bubbles: true
        }))
      })()
    JS
  end

  test "ctrl+wheel zooms the canvas in and out" do
    user = User.create!(name: "Zoomer", email: "gesture1@kapow.test", password: "password123")
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: { "schema_version" => 1, "panels" => [], "texts" => [] })

    sign_in(user)
    visit project_path(project)

    assert_equal "100%", zoom_level_text

    dispatch_ctrl_wheel(-100) # negative deltaY == pinch out / zoom in, matching trackpad convention
    assert_equal "200%", zoom_level_text

    dispatch_ctrl_wheel(50)
    assert_equal "150%", zoom_level_text
  end

  test "a plain wheel scroll (no ctrl) is left alone and does not zoom" do
    user = User.create!(name: "Zoomer", email: "gesture2@kapow.test", password: "password123")
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: { "schema_version" => 1, "panels" => [], "texts" => [] })

    sign_in(user)
    visit project_path(project)

    dispatch_plain_wheel(-200)

    assert_equal "100%", zoom_level_text
  end

  test "a two-finger pinch-out zooms in, and pinch-in zooms back out" do
    user = User.create!(name: "Zoomer", email: "gesture3@kapow.test", password: "password123")
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: { "schema_version" => 1, "panels" => [], "texts" => [] })

    sign_in(user)
    visit project_path(project)

    assert_equal "100%", zoom_level_text

    # Fingers start 100px apart, end up 200px apart — a 2x pinch-out.
    dispatch_pinch([ [ 600, 400 ], [ 700, 400 ] ], [ [ 550, 400 ], [ 750, 400 ] ])
    assert_equal "200%", zoom_level_text

    # From here, bring them back to 100px apart (half the current distance).
    dispatch_pinch([ [ 550, 400 ], [ 750, 400 ] ], [ [ 600, 400 ], [ 700, 400 ] ])
    assert_equal "100%", zoom_level_text
  end

  test "a single-finger touch (one touch point) never triggers zoom" do
    user = User.create!(name: "Zoomer", email: "gesture4@kapow.test", password: "password123")
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [ { "id" => "p1", "pts" => [ [ 100, 100 ], [ 300, 100 ], [ 300, 300 ], [ 100, 300 ] ], "strokes" => [], "photo" => nil } ],
      "texts" => []
    })

    sign_in(user)
    visit project_path(project)

    page.evaluate_script(<<~JS)
      (() => {
        const target = document.querySelector(".editor-canvas")
        const touch = (x, y) => new Touch({ identifier: 0, target, clientX: x, clientY: y })
        target.dispatchEvent(new TouchEvent("touchstart", { touches: [ touch(300, 300) ], cancelable: true, bubbles: true }))
        target.dispatchEvent(new TouchEvent("touchmove", { touches: [ touch(400, 300) ], cancelable: true, bubbles: true }))
      })()
    JS

    assert_equal "100%", zoom_level_text
  end
end
