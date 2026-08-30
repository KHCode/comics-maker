// Loaded via a classic (non-module) <script> tag in the layout <head>, so
// it runs synchronously before first paint — applying a saved theme choice
// before anything renders, avoiding a flash of the wrong theme. See
// app/javascript/controllers/theme_controller.js for the toggle itself.
function applySavedTheme() {
  var saved = localStorage.getItem("kapow.theme")
  if (saved) document.documentElement.dataset.theme = saved
}

applySavedTheme()
