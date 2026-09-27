// NaraScreen docs page enhancements — inlined by api/docs.ts. The page is
// complete without this script; it only adds copy buttons and highlights the
// current section in the sidebar.
(function () {
  "use strict";

  // Copy buttons ship `hidden`, so a page without JS never shows dead buttons.
  document.querySelectorAll(".code").forEach(function (block) {
    var btn = block.querySelector(".copy");
    var code = block.querySelector("code");
    if (!btn || !code) return;
    btn.hidden = false;
    btn.addEventListener("click", function () {
      var text = code.textContent || "";
      var done = function () {
        btn.textContent = "Copied";
        setTimeout(function () { btn.textContent = "Copy"; }, 1400);
      };
      var fallback = function () {
        var range = document.createRange();
        range.selectNodeContents(code);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        try { if (document.execCommand("copy")) done(); } catch (e) { /* text stays selected */ }
      };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    });
  });

  // Scroll spy: mark the sidebar link of the section being read.
  var links = {};
  document.querySelectorAll(".sidebar .toc a").forEach(function (a) {
    links[decodeURIComponent(a.getAttribute("href").slice(1))] = a;
  });
  var heads = Array.prototype.filter.call(document.querySelectorAll("main h2[id], main h3[id]"), function (h) {
    return links[h.id];
  });
  if (!heads.length) return;
  var current = null;
  var ticking = false;
  var update = function () {
    ticking = false;
    var active = heads[0];
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].getBoundingClientRect().top <= 120) active = heads[i];
      else break;
    }
    var link = links[active.id];
    if (link === current) return;
    if (current) current.removeAttribute("aria-current");
    link.setAttribute("aria-current", "true");
    current = link;
    // Keep the active link visible by scrolling the sidebar only (never the page).
    var side = link.closest(".sidebar");
    if (side) {
      var r = link.getBoundingClientRect();
      if (r.top < 60 || r.bottom > window.innerHeight - 40) side.scrollTop += r.top - window.innerHeight / 2;
    }
  };
  window.addEventListener("scroll", function () {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  update();
})();
