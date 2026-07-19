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
var retryTimer = null;
var inFlight = false;

function start() {
  if (inFlight) return;
  inFlight = true;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  document.getElementById("status").style.display = "";
  document.getElementById("error").style.display = "none";
  var probe = new XMLHttpRequest();
  probe.open("GET", APP_URL + "/api/version", true);
  probe.timeout = 6000;
  probe.onload = function () { window.location.replace(APP_URL + "/tv"); };
  probe.onerror = probe.ontimeout = function () {
    inFlight = false;
    document.getElementById("status").style.display = "none";
    document.getElementById("error").style.display = "block";
    retryTimer = setTimeout(start, 5000);
  };
  probe.send();
}

document.addEventListener("keydown", function (e) {
  if (e.keyCode === 13) start();           // Enter → retry now
  if (e.keyCode === 10009) {               // Back → exit the app
    try { tizen.application.getCurrentApplication().exit(); } catch (err) {}
  }
});

start();
