require "application_system_test_case"

class ExportTest < ApplicationSystemTestCase
  BOX_PTS = [ [ 100, 100 ], [ 300, 100 ], [ 300, 300 ], [ 100, 300 ] ]
  SAMPLE_PHOTO = Rails.root.join("test/fixtures/files/sample_photo.png")

  def sign_in(user)
    visit new_session_path
    fill_in "Email", with: user.email
    fill_in "Password", with: "password123"
    click_button "Sign in"
    assert_text "Signed in as #{user.name}"
  end

  def create_blank_project(user, name: "My Comic")
    project = user.projects.create!(name: name, format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1, "panels" => [], "texts" => []
    })
    project
  end

  def create_project_with_panel(user)
    project = user.projects.create!(name: "Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [ { "id" => "p1", "pts" => BOX_PTS, "strokes" => [], "photo" => nil } ],
      "texts" => []
    })
    project
  end

  def switch_to_letter_mode
    within(".mode-tabs") { click_button "Letter" }
  end

  def switch_to_layout_mode
    within(".mode-tabs") { click_button "Layout" }
  end

  def switch_to_draw_mode
    within(".mode-tabs") { click_button "Draw" }
  end

  def switch_to_photo_layer
    within(".draw-layer-tabs") { click_button "Photo" }
  end

  # Stubs the two browser APIs export actually triggers a real download
  # through, so the test can inspect what would have been downloaded
  # without needing headless Chrome's download directory configured. Stows
  # the blob itself (not just its type/size) so a test can pull its actual
  # bytes back out afterward (see pdf_export_test.rb's export_pdf_bytes).
  def stub_download_capture
    page.execute_script(<<~JS)
      window.__exportCalls = []
      const originalCreateObjectURL = URL.createObjectURL.bind(URL)
      URL.createObjectURL = (blob) => {
        window.__exportCalls.push({ type: blob.type, size: blob.size, blob })
        return originalCreateObjectURL(blob)
      }
      HTMLAnchorElement.prototype.click = function () {
        window.__exportLastFilename = this.download
      }
    JS
  end

  def export_calls
    page.evaluate_script("window.__exportCalls")
  end

  def export_last_filename
    page.evaluate_script("window.__exportLastFilename")
  end

  def export_svg_markup
    # Mirrors exportPage()'s own order of operations (deselect/exit-focus
    # *then* build the markup) rather than calling buildExportSvgMarkup in
    # isolation, since a stale selection is exactly what it's meant to
    # avoid baking in.
    page.evaluate_script(<<~JS)
      (() => {
        const pageEl = document.querySelector('[data-controller~="document-store"]')
        const controller = window.Stimulus.getControllerForElementAndIdentifier(
          document.querySelector('[data-controller~="editor"]'), "editor"
        )
        controller.panelControllerFor(pageEl)?.deselect()
        controller.panelControllerFor(pageEl)?.exitFocus()
        controller.textControllerFor(pageEl)?.deselect()
        return controller.buildExportSvgMarkup(pageEl)
      })()
    JS
  end

  # [r, g, b, a] at (x, y) in the actual rasterized export — not just the
  # markup string — for pixel-level regression checks (see the corner-
  # bleed bug below, which no markup-only assertion would have caught).
  def export_pixel_at(x, y)
    page.evaluate_script(<<~JS)
      (() => {
        const pageEl = document.querySelector('[data-controller~="document-store"]')
        const controller = window.Stimulus.getControllerForElementAndIdentifier(
          document.querySelector('[data-controller~="editor"]'), "editor"
        )
        controller.panelControllerFor(pageEl)?.deselect()
        controller.textControllerFor(pageEl)?.deselect()
        return controller.renderPageToBlob(pageEl).then((blob) => createImageBitmap(blob)).then((bitmap) => {
          const canvas = document.createElement("canvas")
          canvas.width = bitmap.width
          canvas.height = bitmap.height
          const ctx = canvas.getContext("2d")
          ctx.drawImage(bitmap, 0, 0)
          return Array.from(ctx.getImageData(#{x}, #{y}, 1, 1).data)
        })
      })()
    JS
  end

  test "the exported page has no border/rounded-corner UI chrome baked in, at any corner (regression)" do
    user = User.create!(name: "Exporter", email: "export6@kapow.test", password: "password123")
    project = user.projects.create!(name: "Comic", format: :comic)
    # A panel that exactly covers the whole 620x956 page, so every corner
    # pixel should be pure ink black (the panel's own outline) with no
    # white gap or rounded curve from .page-canvas's own border/
    # border-radius (real UI chrome — see editor.css — that used to get
    # baked into the export, offsetting the whole page inward by its
    # width and showing a rounded corner in one corner only, per a user
    # report with a screenshot of exactly that).
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [ { "id" => "p1", "pts" => [ [ 0, 0 ], [ 620, 0 ], [ 620, 956 ], [ 0, 956 ] ], "strokes" => [], "photo" => nil } ],
      "texts" => []
    })

    sign_in(user)
    visit project_path(project)

    [ [ 0, 0 ], [ 619, 0 ], [ 0, 955 ], [ 619, 955 ] ].each do |x, y|
      pixel = export_pixel_at(x, y)
      assert pixel[0] < 128 && pixel[1] < 128 && pixel[2] < 128,
        "expected corner (#{x}, #{y}) to be dark (the panel outline), got rgb(#{pixel[0]}, #{pixel[1]}, #{pixel[2]})"
    end
  end

  test "clicking Export rasterizes the page and downloads a PNG with a name derived from the project/page" do
    user = User.create!(name: "Exporter", email: "export1@kapow.test", password: "password123")
    project = create_blank_project(user, name: "My Comic")

    sign_in(user)
    visit project_path(project)
    click_button "Box"

    stub_download_capture
    click_button "Export"

    assert_selector :button, "Export", disabled: false
    assert_equal 1, export_calls.length
    assert_equal "image/png", export_calls.first["type"]
    assert export_calls.first["size"] > 0
    assert_equal "My-Comic-Page-1.png", export_last_filename
  end

  test "the exported SVG embeds the text layer via a foreignObject, with stylesheet rules inlined" do
    user = User.create!(name: "Exporter", email: "export2@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    click_button "Caption"
    find(".text-box--caption .text-box-content").double_click
    find(".text-box--caption .text-box-content").send_keys("Meanwhile...")
    find("body").click # blur, commit

    markup = export_svg_markup
    assert_includes markup, "foreignObject"
    assert_includes markup, "Meanwhile..."
    # The panel/text classes only have real fill/stroke/font rules because
    # of this — without it they'd render as invisible, unstyled boxes.
    assert_includes markup, ".text-box--caption"

    # The vendored fonts' own @font-face src is inlined as a data: URI too
    # (see editor_controller.js#inlineCssFontUrls) — confirmed, by
    # rendering an actual export, that leaving it as a plain "/assets/..."
    # URL silently fails (root-relative, and the fetch race that
    # inlinePhotoImages' own comment describes), so every text box
    # rendered in a fallback font instead of Comic Neue/Bangers.
    assert_match(/@font-face[^}]*url\("data:font\/woff2;base64,/, markup)
    assert_no_match(%r{url\("/assets/}, markup)
  end

  test "the exported SVG inlines the photo's own bytes as a data: URI" do
    user = User.create!(name: "Exporter", email: "export3@kapow.test", password: "password123")
    project = create_project_with_panel(user)

    sign_in(user)
    visit project_path(project)
    switch_to_draw_mode
    switch_to_photo_layer
    find("polygon.panel-outline[data-panel-id='p1']").click
    attach_file("photo-file-input", SAMPLE_PHOTO, visible: :all)
    assert_selector ".panel-photo[data-panel-id='p1'] image", visible: :all

    # Inlined as a data: URI (its bytes fetched and embedded up front —
    # see editor_controller.js#inlinePhotoImages) rather than left as a
    # plain URL for the browser to fetch once rasterization starts: that
    # fetch isn't guaranteed to finish before the outer SVG's own "loaded"
    # event fires, which was confirmed, by rendering an actual export, to
    # silently drop the photo entirely.
    markup = export_svg_markup
    assert_match(/<image[^>]*href="data:image\/png;base64,/, markup)
    assert_no_match(%r{href="https?://[^"]+/rails/active_storage/blobs/redirect/}, markup)
  end

  test "exporting while something is selected doesn't bake handles or floating bars into the image" do
    user = User.create!(name: "Exporter", email: "export4@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    click_button "Box"
    find("polygon.panel-outline").click # select the panel

    switch_to_letter_mode
    click_button "Caption"
    find(".text-box--caption").click # select the text too

    # The embedded stylesheet legitimately mentions these class names in
    # its own selectors (e.g. ".panel-handle { ... }") regardless of
    # whether anything actually uses them — strip it before checking that
    # no *element* was left carrying one.
    markup_outside_style = export_svg_markup.sub(%r{<style>.*?</style>}m, "")
    assert_no_match(/panel-handle|photo-handle|panel-floating-bar/, markup_outside_style)
    assert_no_match(/text-handle|text-bar-toggle|text-floating-bar|text-box--selected/, markup_outside_style)
  end

  test "exporting still includes the lettering even while Layout mode's Hide text is active" do
    user = User.create!(name: "Exporter", email: "export5@kapow.test", password: "password123")
    project = create_blank_project(user)

    sign_in(user)
    visit project_path(project)
    switch_to_letter_mode
    click_button "Caption"
    switch_to_layout_mode
    click_button "Hide text"
    assert_no_selector ".text-box--caption"

    markup = export_svg_markup
    assert_includes markup, "text-box--caption"
    assert_no_match(/<div[^>]*class="page-text-layer"[^>]*hidden/, markup)
  end
end
