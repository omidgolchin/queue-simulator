/* omid-tools-kit — theme handling shared by all tools.
 *
 * Load in <head> (no async/defer) so the saved theme applies before the
 * page paints:
 *   <script src="kit-theme.js"></script>
 *
 * Behaviour: the OS preference (prefers-color-scheme) decides by default.
 * A toggle button (class "kit-theme-toggle" or [data-kit-theme-toggle])
 * flips it, sets data-theme="light"|"dark" on <html>, and remembers the
 * choice in localStorage under "omid-tools-theme". Charts should redraw
 * on change: register with KitTheme.onChange(fn).
 */
(function () {
  "use strict";
  var KEY = "omid-tools-theme";
  var listeners = [];

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function save(t) {
    try { localStorage.setItem(KEY, t); } catch (e) { /* private mode */ }
  }
  function current() {
    var t = document.documentElement.getAttribute("data-theme");
    if (t === "light" || t === "dark") return t;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark" : "light";
  }
  function apply(t) {
    document.documentElement.setAttribute("data-theme", t);
    save(t);
    document.querySelectorAll("[data-kit-theme-toggle], .kit-theme-toggle")
      .forEach(function (b) { b.setAttribute("aria-pressed", String(t === "dark")); });
    listeners.forEach(function (fn) { fn(t); });
  }

  // Apply a saved choice immediately (this script runs in <head>).
  var saved = stored();
  if (saved === "light" || saved === "dark") {
    document.documentElement.setAttribute("data-theme", saved);
  }

  window.KitTheme = {
    current: current,
    toggle: function () { apply(current() === "dark" ? "light" : "dark"); },
    set: apply,
    onChange: function (fn) { listeners.push(fn); }
  };

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-kit-theme-toggle], .kit-theme-toggle")
      .forEach(function (b) {
        b.setAttribute("aria-pressed", String(current() === "dark"));
        b.addEventListener("click", function () { KitTheme.toggle(); });
      });
  });
})();
