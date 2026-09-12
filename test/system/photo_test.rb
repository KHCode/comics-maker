require "application_system_test_case"

class PhotoTest < ApplicationSystemTestCase
  BOX_PTS = [ [ 100, 100 ], [ 300, 100 ], [ 300, 300 ], [ 100, 300 ] ] # a 200x200 square panel
  SAMPLE_PHOTO = Rails.root.join("test/fixtures/files/sample_photo.png") # 400x200 (2:1 landscape)

  def sign_in(user)
    visit new_session_path
    fill_in "Email", with: user.email
    fill_in "Password", with: "password123"
    click_button "Sign in"
    assert_text "Signed in as #{user.name}"
  end

  def create_project_with_panel(user, pts: BOX_PTS)
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [ { "id" => "p1", "pts" => pts, "strokes" => [], "photo" => nil } ],
      "texts" => []
    })
    project
  end

  def switch_to_draw_mode
    within(".mode-tabs") { click_button "Draw" }
  end

  def switch_to_photo_layer
    within(".draw-layer-tabs") { click_button "Photo" }
  end

  def panel_polygon
    find("polygon.panel-outline[data-panel-id='p1']")
  end

  def focus_panel
    panel_polygon.click
  end

  def insert_sample_photo
    # The file input carries the `hidden` attribute on purpose — the
    # "Photos"/"Camera" buttons proxy clicks to it — so it needs visible:
    # :all to be found at all, same as every direct query against it below.
    attach_file("photo-file-input", SAMPLE_PHOTO, visible: :all)
    assert_selector ".panel-photo[data-panel-id='p1'] image", visible: :all
  end

  def drag_element_by(element, dx, dy)
    page.driver.browser.action
      .move_to(element.native)
      .pointer_down
      .move_by(dx, dy)
      .pointer_up
      .perform
  end

  def stored_panel
    page.evaluate_script(<<~JS)
      (() => {
        const pageEl = document.querySelector('[data-controller~="document-store"]')
        const controller = window.Stimulus.getControllerForElementAndIdentifier(pageEl, "document-store")
        return controller.store.getState().panels.find((p) => p.id === "p1")
      })()
    JS
  end

  test "inserting a photo attaches it to the focused panel at its natural aspect ratio" do
    user = User.create!(name: "Photog", email: "photo1@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode
    focus_panel
    switch_to_photo_layer

    insert_sample_photo

    photo = stored_panel["photo"]
    refute_nil photo
    assert_equal 400, photo["nw"]
    assert_equal 200, photo["nh"]
    assert_equal 100, photo["pct"]
    assert_equal 0, photo["rot"]
    assert_equal false, photo["flip"]
    assert_equal false, photo["cover"]
    refute_nil photo["src"]

    image = find(".panel-photo[data-panel-id='p1'] image", visible: :all)
    # 200x200 panel, contain-fitting a 400x200 (2:1) image: width is the
    # binding axis, so the rendered image is 200 wide x 100 tall.
    assert_equal "200", image["width"]
    assert_equal "100", image["height"]
  end

  test "the photo persists across a reload, resolved back to a working image URL" do
    user = User.create!(name: "Photog", email: "photo2@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode
    focus_panel
    switch_to_photo_layer
    insert_sample_photo

    sleep 1 # let the debounced save (and photo_signed_ids attach) land
    visit project_path(project)
    switch_to_draw_mode
    focus_panel
    switch_to_photo_layer

    assert_selector ".panel-photo[data-panel-id='p1'] image", visible: :all
    photo = stored_panel["photo"]
    refute_nil photo
    assert_equal 400, photo["nw"]

    image_href = find(".panel-photo[data-panel-id='p1'] image", visible: :all)["href"]
    status_code = page.evaluate_script(<<~JS, image_href)
      (async () => (await fetch(arguments[0])).status)()
    JS
    assert_equal 200, status_code
  end

  test "Fill panel switches from contain to cover fit, and Scale multiplies on top of it" do
    user = User.create!(name: "Photog", email: "photo3@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode
    focus_panel
    switch_to_photo_layer
    insert_sample_photo

    click_button "Fill panel"
    photo = stored_panel["photo"]
    assert_equal true, photo["cover"]

    image = find(".panel-photo[data-panel-id='p1'] image", visible: :all)
    # cover-fits a 400x200 image into a 200x200 box: width is now the
    # non-binding axis, so it's the one that grows past the panel (400
    # wide x 200 tall), rather than height shrinking to fit as it did
    # under contain (see the insert test above).
    assert_equal "400", image["width"]
    assert_equal "200", image["height"]

    find("input[data-editor-target='photoScale']").set(200)
    photo = stored_panel["photo"]
    assert_equal 200, photo["pct"]
    image = find(".panel-photo[data-panel-id='p1'] image", visible: :all)
    assert_equal "800", image["width"]
  end

  test "Rotate and Flip update the photo, and Remove clears it" do
    user = User.create!(name: "Photog", email: "photo4@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode
    focus_panel
    switch_to_photo_layer
    insert_sample_photo

    find("input[data-editor-target='photoRotate']").set(30)
    assert_equal 30, stored_panel["photo"]["rot"]

    click_button "Flip"
    assert_equal true, stored_panel["photo"]["flip"]

    click_button "Remove"
    assert_nil stored_panel["photo"]
    assert_no_selector ".panel-photo[data-panel-id='p1'] image", visible: :all
  end

  test "dragging the photo pans it, offsetting it from the panel's own center" do
    user = User.create!(name: "Photog", email: "photo5@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode
    focus_panel
    switch_to_photo_layer
    insert_sample_photo

    assert_equal 0, stored_panel["photo"]["x"]
    assert_equal 0, stored_panel["photo"]["y"]

    drag_element_by(panel_polygon, 20, 15)

    # The focused panel is zoomed in by whatever factor fills the canvas,
    # so a 20x15 screen-pixel drag doesn't map 1:1 to page units — only the
    # ratio between the two axes is preserved (both scale by the same
    # factor), not the raw magnitude.
    photo = stored_panel["photo"]
    assert photo["x"] > 0, "expected a rightward drag to produce a positive x offset"
    assert photo["y"] > 0, "expected a downward drag to produce a positive y offset"
    assert_in_delta 20.0 / 15.0, photo["x"] / photo["y"], 0.1
  end

  test "moving the panel in Layout mode carries the photo along (its pan offset is unchanged)" do
    user = User.create!(name: "Photog", email: "photo6@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode
    focus_panel
    switch_to_photo_layer
    insert_sample_photo
    drag_element_by(panel_polygon, 20, 0)

    before_x = stored_panel["photo"]["x"]

    within(".mode-tabs") { click_button "Layout" }
    drag_element_by(panel_polygon, 40, 0)

    after = stored_panel
    assert_equal before_x, after["photo"]["x"]
    refute_nil after["photo"]
  end
end
