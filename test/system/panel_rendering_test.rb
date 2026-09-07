require "application_system_test_case"

class PanelRenderingTest < ApplicationSystemTestCase
  def ellipse_points(cx, cy, rx, ry, count: 14)
    Array.new(count) do |i|
      angle = 2 * Math::PI * i / count
      [ (cx + rx * Math.cos(angle)).round(2), (cy + ry * Math.sin(angle)).round(2) ]
    end
  end

  def star_points(cx, cy, outer_r, inner_r, points: 10)
    count = points * 2
    Array.new(count) do |i|
      angle = Math::PI * i / points
      r = i.even? ? outer_r : inner_r
      [ (cx + r * Math.sin(angle)).round(2), (cy - r * Math.cos(angle)).round(2) ]
    end
  end

  test "renders panels of every shape profile as SVG polygons with clip-paths" do
    user = User.create!(name: "Panel Tester", email: "panel-tester@kapow.test", password: "password123")
    project = user.projects.create!(name: "Panel Test", format: :comic)
    page = project.pages.create!(position: 1, name: "Page 1")

    box = { "id" => "box1", "pts" => [ [ 50, 50 ], [ 300, 50 ], [ 300, 300 ], [ 50, 300 ] ], "strokes" => [], "photo" => nil }
    slant = { "id" => "slant1", "pts" => [ [ 350, 50 ], [ 570, 50 ], [ 520, 300 ], [ 400, 300 ] ], "strokes" => [], "photo" => nil }
    round = { "id" => "round1", "pts" => ellipse_points(310, 500, 120, 120, count: 14), "strokes" => [], "photo" => nil }
    burst = { "id" => "burst1", "pts" => star_points(310, 800, 100, 50, points: 10), "strokes" => [], "photo" => nil }

    page.update!(data: {
      "schema_version" => 1,
      "panels" => [ box, slant, round, burst ],
      "texts" => []
    })

    visit new_session_path
    fill_in "Email", with: user.email
    fill_in "Password", with: "password123"
    click_button "Sign in"
    assert_text "Signed in as Panel Tester"

    visit project_path(project)

    within "svg.page-canvas" do
      assert_selector "polygon.panel-outline", count: 4
      assert_selector "polygon[data-panel-id='box1']"
      assert_selector "polygon[data-panel-id='slant1']"
      assert_selector "polygon[data-panel-id='round1']"
      assert_selector "polygon[data-panel-id='burst1']"

      assert_selector "clipPath polygon", count: 4, visible: false
    end

    box_polygon = find("polygon[data-panel-id='box1']")
    assert_equal "url(#panel-clip-box1)", box_polygon["clip-path"]
    assert_equal "50,50 300,50 300,300 50,300", box_polygon["points"]
  end
end
