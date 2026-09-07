module ProjectsHelper
  # Cosmetic only, for the format-card previews on the Projects screen.
  # Real page geometry (used by the editor canvas) is defined separately.
  # Aspect ratios live in app/assets/stylesheets/application.css as
  # .format-preview--<format> rules, keyed by the same format strings.
  FORMAT_PREVIEWS = {
    "comic" => { label: "Comic", sublabel: "6.625×10.25\"" },
    "manga_b5" => { label: "Manga B5", sublabel: "176×250mm" },
    "newspaper_strip" => { label: "Newspaper strip", sublabel: nil },
    "webtoon" => { label: "Webtoon", sublabel: "500×1500 per unit" }
  }.freeze

  # Button labels only, for the Layout tray's per-format preset buttons —
  # matching the doc's page-format table. The actual layout geometry for
  # each name lives in app/javascript/kapow/panel_layouts.js
  # (PRESETS_BY_FORMAT); keep these two lists in sync.
  LAYOUT_PRESETS = {
    "comic" => [ "3 Rows", "2×2", "2×3", "Big + 2" ],
    "manga_b5" => [ "4-koma", "2×2", "Action", "Big + 2" ],
    "newspaper_strip" => [ "3 across", "4 across", "Big + 1" ],
    "webtoon" => [ "3 stacked", "5 stacked", "Tall + 2" ]
  }.freeze
end
