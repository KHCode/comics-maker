class Folder < ApplicationRecord
  belongs_to :user
  # Matches Project's own `has_many :pages, -> { order(:position) }` — the
  # Projects screen's per-folder tab (see ProjectsController#index) always
  # wants a folder's projects most-recently-updated first, the same order
  # "My Comics" itself uses, without needing a separate query/sort in the
  # view for content that's already been eager-loaded there.
  has_many :projects, -> { order(updated_at: :desc) }, dependent: :nullify

  validates :name, presence: true, uniqueness: { scope: :user_id }
end
