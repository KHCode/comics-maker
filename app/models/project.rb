class Project < ApplicationRecord
  belongs_to :user
  belongs_to :folder, optional: true
  has_many :pages, -> { order(:position) }, dependent: :destroy

  # Projects screen thumbnail (see the plan's Phase 10 fast-follow). This
  # is a small snapshot the client renders from the first page's own
  # rasterization pipeline (see editor_controller.js#renderThumbnailBlob)
  # and uploads whenever Save/Save As is actually submitted — the server's
  # role is only to store the resulting blob, not to render anything
  # itself, since there's no headless-browser/SVG-rendering tool in this
  # stack and the client already has a working, tested pipeline for this.
  has_one_attached :thumbnail

  enum :format, { comic: 0, manga_b5: 1, newspaper_strip: 2, webtoon: 3 }

  validates :name, presence: true
  validates :format, presence: true
  validate :folder_belongs_to_same_user

  # Page canvas size, in page units (not pixels) — the doc's own coordinate
  # system. Webtoon's height is per one height_unit; see Page#height.
  PAGE_DIMENSIONS = {
    "comic" => { width: 620, height: 956 },
    "manga_b5" => { width: 560, height: 794 },
    "newspaper_strip" => { width: 1000, height: 330 },
    "webtoon" => { width: 500, height: 1500 }
  }.freeze

  # Vertical gap, in page units, between consecutive pages for paginated
  # formats. Not applicable to webtoon, which has no page seams.
  PAGE_GUTTER = 44

  def page_width
    PAGE_DIMENSIONS.fetch(format)[:width]
  end

  def page_unit_height
    PAGE_DIMENSIONS.fetch(format)[:height]
  end

  # Paginated formats (comic, manga_b5, newspaper_strip) use the multi-page
  # model: independent pages, +Page, per-page delete. Webtoon is the only
  # format that doesn't.
  def paginated?
    !webtoon?
  end

  private
    def folder_belongs_to_same_user
      return if folder.nil? || folder.user_id == user_id

      errors.add(:folder, "must belong to the same user")
    end
end
