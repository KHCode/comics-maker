module EditorHelper
  # Draw mode's 7 ink swatches, for the Draw tray's color row. Keep in sync
  # with INK_COLORS in app/javascript/kapow/ink.js, the source of truth for
  # everything about how a stroke actually renders.
  INK_COLORS = %w[#1c1a17 #e0452d #ffd43a #f2994a #2f6fed #2f9e52 #8b5cf6].freeze
end
