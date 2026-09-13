require "application_system_test_case"
require "base64"

class PdfExportTest < ApplicationSystemTestCase
  # A full-bleed panel (touching all 4 page edges) vs. a small centered one
  # give each page a visually distinct, easy-to-check rendering: the
  # full-bleed page's corners are the panel's own ink-black outline, the
  # centered one's corners are plain white page background. Used below to
  # confirm the assembled PDF's pages actually land in the right order,
  # not just that there are the right number of them.
  FULL_BLEED_PTS = [ [ 0, 0 ], [ 620, 0 ], [ 620, 956 ], [ 0, 956 ] ]
  CENTERED_PTS = [ [ 210, 328 ], [ 410, 328 ], [ 410, 628 ], [ 210, 628 ] ]

  def sign_in(user)
    visit new_session_path
    fill_in "Email", with: user.email
    fill_in "Password", with: "password123"
    click_button "Sign in"
    assert_text "Signed in as #{user.name}"
  end

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

  def export_last_filename
    page.evaluate_script("window.__exportLastFilename")
  end

  # Pulls the actual downloaded PDF's bytes back out of the stubbed blob
  # (see stub_download_capture) via FileReader/data: URL — the same
  # size-safe technique the app's own export code uses (blobToDataUrl in
  # editor_controller.js) rather than spreading the bytes into a JS array,
  # which risks blowing the call stack on a real multi-page file.
  def export_pdf_bytes
    base64 = page.evaluate_script(<<~JS)
      (async () => {
        const blob = window.__exportCalls.at(-1).blob
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(blob)
        })
        return dataUrl.split(",")[1]
      })()
    JS
    Base64.decode64(base64)
  end

  def with_pdf_file(bytes)
    Dir.mktmpdir do |dir|
      path = File.join(dir, "export.pdf")
      File.binwrite(path, bytes)
      yield path, dir
    end
  end

  # [r, g, b] near the middle of a poppler-rendered page raster, at a given
  # 0-based page number.
  def rendered_pixel(dir, page_number, x, y)
    prefix = File.join(dir, "page")
    `pdftoppm -r 72 -f #{page_number} -l #{page_number} #{File.join(dir, "export.pdf")} #{prefix}`
    # pdftoppm names each output file after its real page number (not
    # output sequence), e.g. "page-2.ppm" even with -f 2 -l 2 — glob on
    # that exact name rather than "first file found", since a prior call
    # in the same directory (page 1) can otherwise still be picked up.
    ppm_path = Dir.glob("#{prefix}-#{page_number}.ppm").first
    bytes = File.binread(ppm_path)
    header_match = bytes.match(/\AP6\s+(\d+)\s+(\d+)\s+255\n/)
    width = header_match[1].to_i
    data_start = header_match.end(0)
    offset = data_start + (y * width + x) * 3
    bytes.byteslice(offset, 3).unpack("C3")
  end

  test "Export PDF assembles every page, in order, into one downloadable PDF" do
    user = User.create!(name: "Exporter", email: "pdf1@kapow.test", password: "password123")
    project = user.projects.create!(name: "My Comic", format: :comic)
    project.pages.create!(position: 1, name: "Page 1", data: {
      "schema_version" => 1,
      "panels" => [ { "id" => "p1", "pts" => FULL_BLEED_PTS, "strokes" => [], "photo" => nil } ],
      "texts" => []
    })
    project.pages.create!(position: 2, name: "Page 2", data: {
      "schema_version" => 1,
      "panels" => [ { "id" => "p2", "pts" => CENTERED_PTS, "strokes" => [], "photo" => nil } ],
      "texts" => []
    })

    sign_in(user)
    visit project_path(project)

    stub_download_capture
    click_button "Export PDF"

    assert_selector :button, "Export PDF", disabled: false
    assert_equal "My-Comic.pdf", export_last_filename

    bytes = export_pdf_bytes
    with_pdf_file(bytes) do |path, dir|
      info = `pdfinfo #{path}`
      assert_match(/Pages:\s+2/, info)
      # A comic page is 620x956 page units; MediaBox uses those units
      # directly (see kapow/pdf.js), so both pages should report exactly
      # that size, preserving the format's own aspect ratio.
      assert_match(/Page size:\s+620 x 956/, info)

      corner_page_1 = rendered_pixel(dir, 1, 0, 0)
      assert corner_page_1.all? { |c| c < 128 },
        "expected page 1's corner (the full-bleed panel's outline) to be dark, got #{corner_page_1}"

      corner_page_2 = rendered_pixel(dir, 2, 0, 0)
      assert corner_page_2.all? { |c| c > 200 },
        "expected page 2's corner (outside the centered panel) to be white, got #{corner_page_2}"
    end
  end
end
