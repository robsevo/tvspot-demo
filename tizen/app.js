/* External on purpose: Tizen's default widget CSP (script-src 'self', no
 * 'unsafe-inline') silently blocks INLINE scripts — the original inline
 * version of this logic never executed on the real TV ("blank screen"),
 * while everything worked in desktop testing.
 *
 * ── Set APP_URL to your deployed origin (no trailing slash) ── */
var APP_URL = "https://tvspot.vercel.app";

/* Probe the origin, then navigate. The probe AUTO-RETRIES: at cold app
 * launch the TV's network stack is often not up yet (observed on the
 * RU7100), so a one-shot check leaves a dead screen. */
var PROBE_TIMEOUT_MS = 6000;
var PROBE_RETRY_MS = 5000;

/* How long we allow the navigation ITSELF to take before deciding it will
 * never happen.
 *
 * This is the wrapper's only real safety net, and nothing on the server can
 * substitute for it. `location.replace` does not swap the screen until the new
 * document COMMITS — until then THIS page stays visible. So anything that
 * stalls the response (a service worker holding event.respondWith on an
 * unbounded fetch, a wedged edge, a half-open socket) leaves "Starting TVSpot…"
 * on screen forever with no error and no retry, and the app we were navigating
 * to never starts, so it cannot report the problem either.
 *
 * If the navigation commits, this document is torn down and the timer dies with
 * it — the watchdog can only ever fire when something actually went wrong.
 *
 * Deliberately longer than the app's own 10s SW navigation deadline, so the
 * server-side fallback gets to win first when it can. */
var NAV_WATCHDOG_MS = 14000;

/* Give up on a stalled navigation twice, then stop auto-retrying and wait for
 * the user — endless silent reloads on a genuinely broken backend just burn the
 * TV's memory and hide the problem. */
var MAX_NAV_RETRIES = 2;

var retryTimer = null;
var navWatchdog = null;
var inFlight = false;
var navAttempts = 0;

function el(id) {
  return document.getElementById(id);
}

function show(statusText, errorText) {
  var s = el("status");
  var e = el("error");
  if (statusText === null) {
    s.style.display = "none";
  } else {
    s.style.display = "";
    s.textContent = statusText;
  }
  if (errorText === null) {
    e.style.display = "none";
  } else {
    e.style.display = "block";
    e.textContent = errorText;
  }
}

function clearTimers() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (navWatchdog) { clearTimeout(navWatchdog); navWatchdog = null; }
}

/* The navigation never committed. Nothing here can fix the far end, but we can
 * stop presenting a dead screen: say what happened, and try again — with a
 * cache-busting query so a service worker can't hand back the same wedged
 * cached entry for the same key. */
function onNavStalled() {
  navWatchdog = null;
  inFlight = false;
  navAttempts++;

  if (navAttempts > MAX_NAV_RETRIES) {
    show(null, "TVSpot isn't responding. Press Enter to try again.");
    return;
  }

  show("Still loading — retrying…", null);
  retryTimer = setTimeout(function () {
    go();
  }, 1500);
}

/* Navigate to the app, watchdogged.
 *
 * TARGET IS /tv/login, NOT /tv — this is load-bearing, measured on the RU7100.
 *
 * Loading /tv DIRECTLY as the first document reliably kills the TV's renderer:
 * the process stops responding entirely (no JS execution context, and even
 * Runtime.enable/DOM.getDocument time out over remote DevTools), so the screen
 * never leaves this splash. Reaching the exact same /tv through /tv/login does
 * NOT: the login page paints, silently re-signs in with the remembered
 * credentials, and hands off to /tv as a CLIENT-SIDE navigation, which builds
 * the home screen incrementally into an already-warm runtime instead of
 * server-rendering and hydrating the whole thing as a cold first paint. On a
 * ~1GB 2019 box that difference is the difference between working and wedged.
 *
 * Proven by bisecting on the device: /api/version loaded fine (so the webview,
 * network and this wrapper are healthy), direct /tv wedged every launch, and
 * /tv/login came up and landed on a fully live /tv.
 *
 * It is also the flow the README always described ("should show 'Starting
 * TVSpot…' then land on the TV login") — going straight to /tv was the drift.
 *
 * The cache-busting query stays as insurance: it guarantees a poisoned service
 * worker entry can never be handed back for this key. The TV build no longer
 * registers a service worker at all, so it costs nothing.
 */
function go() {
  clearTimers();
  show("Loading TVSpot…", null);
  navWatchdog = setTimeout(onNavStalled, NAV_WATCHDOG_MS);
  var target = APP_URL + "/tv/login?b=" + Date.now();
  try {
    window.location.replace(target);
  } catch (err) {
    onNavStalled();
  }
}

function start() {
  if (inFlight) return;
  inFlight = true;
  clearTimers();
  show("Starting TVSpot…", null);

  var probe = new XMLHttpRequest();
  probe.open("GET", APP_URL + "/api/version", true);
  probe.timeout = PROBE_TIMEOUT_MS;
  probe.onload = function () {
    // Reachable. From here the risk is no longer "can we get a response" but
    // "will the navigation ever commit" — hence the watchdog in go().
    go();
  };
  probe.onerror = probe.ontimeout = function () {
    inFlight = false;
    show(null, "Can't reach TVSpot — check the TV's network, then press Enter to retry.");
    retryTimer = setTimeout(start, PROBE_RETRY_MS);
  };
  probe.send();
}

document.addEventListener("keydown", function (e) {
  if (e.keyCode === 13) {                  // Enter → retry now
    navAttempts = 0;
    inFlight = false;
    start();
  }
  if (e.keyCode === 10009) {               // Back → exit the app
    try { tizen.application.getCurrentApplication().exit(); } catch (err) {}
  }
});

start();
