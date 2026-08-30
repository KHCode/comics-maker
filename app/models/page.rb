class Page < ApplicationRecord
  belongs_to :project

  attribute :data, default: -> { { "schema_version" => 1, "panels" => [], "texts" => [] } }

  validates :name, presence: true
  validates :position, presence: true, uniqueness: { scope: :project_id }
end
