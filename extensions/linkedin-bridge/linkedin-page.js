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

  let watched = null;
  const titleObserver = new MutationObserver(check);
  const headObserver = new MutationObserver(watchTitle);

  // After the extension is reloaded or updated, this copy keeps running in
  // tabs opened before, cut off from the extension: chrome.runtime.id is then
  // undefined and sendMessage throws synchronously ("Extension context
  // invalidated"), which a .catch() on its promise never sees. Stop watching.
  function stop() {
    titleObserver.disconnect();
    headObserver.disconnect();
  }

  function notify() {
    if (!chrome.runtime || !chrome.runtime.id) return stop();
    try {
      chrome.runtime.sendMessage({ type: "linkedin-activity" }).catch(() => undefined);
    } catch {
      stop();
    }
  }

  function check() {
    const current = unreadIn(document.title);
    if (current > last) notify();
    last = current;
  }

  function watchTitle() {
    const title = document.querySelector("head > title");
    if (!title || title === watched) return;
    titleObserver.disconnect();
    titleObserver.observe(title, { childList: true, characterData: true, subtree: true });
    watched = title;
    check();
  }
  // LinkedIn may replace the <title> element itself.
  if (document.head) headObserver.observe(document.head, { childList: true });
  watchTitle();
})();
