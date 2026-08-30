class Folder < ApplicationRecord
  belongs_to :user
  has_many :projects, dependent: :nullify

  validates :name, presence: true, uniqueness: { scope: :user_id }
end
