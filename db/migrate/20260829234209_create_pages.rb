class CreatePages < ActiveRecord::Migration[8.1]
  def change
    create_table :pages do |t|
      t.references :project, null: false, foreign_key: true
      t.integer :position, null: false
      t.string :name, null: false
      t.integer :height_units
      t.jsonb :data, null: false, default: {}

      t.timestamps
    end
    add_index :pages, [ :project_id, :position ], unique: true
  end
end
