class Page < ApplicationRecord
  # touch: true keeps Project#updated_at reflecting real editing activity
  # (adding/deleting/resizing pages, and later panel/text edits), so the
  # projects list can sort by "most recently worked on."
  belongs_to :project, touch: true

  # The real record behind a panel's photo.src (a blob signed_id, per the
  # doc's panel.photo schema) — panels themselves stay pure JSON (see
  # `data` below), but attaching the blob here gives uploaded photos a real
  # owner for lifecycle purposes (so they're destroyed with the page,
  # rather than orphaned rows Active Storage never cleans up). See
  # PagesController#update for where new blobs referenced in `data` get
  # attached.
  has_many_attached :photos

  attribute :data, default: -> { { "schema_version" => 1, "panels" => [], "texts" => [] } }

  validates :name, presence: true
  validates :position, presence: true, uniqueness: { scope: :project_id }

  delegate :page_width, to: :project

  # Canvas height in page units. Fixed per format, except webtoon, which
  # grows/shrinks by whole units (height_units) with no fixed page height.
  def height
    return project.page_unit_height unless project.webtoon?

    project.page_unit_height * (height_units || 1)
  end
end
