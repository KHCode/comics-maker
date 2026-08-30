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
end
