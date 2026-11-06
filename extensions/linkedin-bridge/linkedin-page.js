// Content script on linkedin.com. Passive: it only watches the tab title,
// where LinkedIn shows its unread count ("(3) Messaging | LinkedIn"). When
// the count goes up, it tells the service worker, which asks ARIA to refresh
// the inbox now instead of at the next scheduled sync. It makes no request
// and reads nothing else from the page.
(() => {
  const unreadIn = (title) => {
    const match = /^\((\d+)\+?\)/.exec(title || "");
    return match ? Number(match[1]) : 0;
  };
  let last = unreadIn(document.title);

  function check() {
    const current = unreadIn(document.title);
    if (current > last) chrome.runtime.sendMessage({ type: "linkedin-activity" }).catch(() => undefined);
    last = current;
  }

  let watched = null;
  const titleObserver = new MutationObserver(check);
  function watchTitle() {
    const title = document.querySelector("head > title");
    if (!title || title === watched) return;
    titleObserver.disconnect();
    titleObserver.observe(title, { childList: true, characterData: true, subtree: true });
    watched = title;
    check();
  }
  // LinkedIn may replace the <title> element itself.
  if (document.head) new MutationObserver(watchTitle).observe(document.head, { childList: true });
  watchTitle();
})();
