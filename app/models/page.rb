class Page < ApplicationRecord
  belongs_to :project

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
