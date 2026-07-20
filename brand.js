/* FASTBREAK rebrand overlay — runtime brand fixups that a static file cannot do:
 *  (1) favicon swap to the FASTBREAK mark,
 *  (2) keep the document title = "FASTBREAK" (RP rewrites it via react-helmet
 *      on every route change, so we re-assert it).
 * No RP chunk is modified — this is our own added script. */
(function () {
  // FASTBREAK backend (streampulse) location for the Observability & KPIs tab.
  // Runtime-injected so the tab fetches LIVE KPIs instead of the honest sample fallback.
  window.FASTBREAK_API_URL = window.FASTBREAK_API_URL || 'http://localhost:8000';

  var MARK = 'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMjU2IDI1NiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiByb2xlPSJpbWciIGFyaWEtbGFiZWw9IkZBU1RCUkVBSyI+CiAgPHJlY3QgeD0iOCIgeT0iOCIgd2lkdGg9IjI0MCIgaGVpZ2h0PSIyNDAiIHJ4PSI1NCIgZmlsbD0iIzRDOERGRiIvPgogIDxwYXRoIGQ9Ik05MiA2NCBMMTk2IDEyOCBMOTIgMTkyIEw5MiAxNTAgTDU2IDE1MCBMNTYgMTA2IEw5MiAxMDYgWiIgZmlsbD0iIzBCMEUxNCIvPgo8L3N2Zz4K';
  var TITLE = 'FASTBREAK';

  function setFavicon() {
    var links = document.querySelectorAll('link[rel~="icon"]');
    for (var i = 0; i < links.length; i++) links[i].parentNode.removeChild(links[i]);
    var l = document.createElement('link');
    l.rel = 'icon';
    l.type = 'image/svg+xml';
    l.href = MARK;
    document.head.appendChild(l);
  }

  function fixTitle() {
    if (document.title !== TITLE) document.title = TITLE;
  }

  setFavicon();
  fixTitle();

  var t = document.querySelector('title');
  if (t) new MutationObserver(fixTitle).observe(t, { childList: true, characterData: true, subtree: true });
  // react-helmet can also replace the whole <title> node; poll as a backstop.
  setInterval(fixTitle, 1000);
})();
