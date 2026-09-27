require "test_helper"
require "minitest/retry"

# ChromeDriver's native click occasionally delivers no event at all —
# confirmed by tracing the browser directly: elementFromPoint resolves to
# the right target and its listener is attached, but nothing fires, not
# even a capture-phase listener on window. That's the input pipeline
# itself dropping the event, not an app bug, and it's rare enough that
# retrying the whole test (rather than guessing which click needs its own
# retry logic) is the more general fix. Scoped to system tests only —
# other test types should stay deterministic.
Minitest::Retry.use!(retry_count: 2, classes_to_retry: [ "ActionDispatch::SystemTestCase" ])

class ApplicationSystemTestCase < ActionDispatch::SystemTestCase
  driven_by :selenium, using: :headless_chrome, screen_size: [ 1400, 1400 ]
end
