class Project < ApplicationRecord
  belongs_to :user
  belongs_to :folder, optional: true
  has_many :pages, -> { order(:position) }, dependent: :destroy

  enum :format, { comic: 0, manga_b5: 1, newspaper_strip: 2, webtoon: 3 }

  validates :name, presence: true
  validates :format, presence: true
  validate :folder_belongs_to_same_user

  private
    def folder_belongs_to_same_user
      return if folder.nil? || folder.user_id == user_id

      errors.add(:folder, "must belong to the same user")
    end
end
