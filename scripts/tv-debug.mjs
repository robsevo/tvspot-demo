/**
 * Talk to the TV's webview over the Chrome DevTools Protocol.
 *
 * The 2019 Samsung has no devtools you can open and no console you can read, so
 * every claim about how it behaves is otherwise a guess. This is the tool that
 * makes it measurable — it is how the guide's 3420ms first paint and the 10MB /
 * 368MB heap numbers in TvEpgGrid were established.
 *
 * Setup (see tizen/README.md):
 *   ~/tizen-studio/tools/sdb connect <TV-IP>
 *   ~/tizen-studio/tools/sdb -s <TV-IP>:26101 shell 0 debug TVSpotTVapp.TVSpot
 *     -> prints "port: NNNNN"
 *
 * Usage:
 *   node scripts/tv-debug.mjs <host:port> eval '<js expression>'
 *   node scripts/tv-debug.mjs <host:port> snapshot     # one health reading
 *   node scripts/tv-debug.mjs <host:port> watch [secs] # poll until it wedges
 *
 * NOTE: DevTools `Runtime.evaluate` bypasses the page CSP, so code that works
 * here can still be CSP-blocked as page code. Don't use this to prove a fix.
 */

const [, , target, cmd = "snapshot", arg] = process.argv;

if (!target) {
  console.error("usage: node scripts/tv-debug.mjs <host:port> [eval <js> | snapshot | watch [secs]]");
  process.exit(1);
}

async function wsUrl() {
  const res = await fetch(`http://${target}/json`);
  const pages = await res.json();
  const page = pages.find((p) => p.type === "page") || pages[0];
  if (!page?.webSocketDebuggerUrl) throw new Error("no debuggable page on the TV");
  return { url: page.webSocketDebuggerUrl, pageUrl: page.url };
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      }
    };
    ws.onerror = () => reject(new Error("websocket error — is the debug port still open?"));
    ws.onopen = () =>
      resolve({
        // Every send is bounded. Chromium 63 predates chunks of the protocol
        // (Performance.enable among them) and simply NEVER ANSWERS an unknown
        // method rather than returning an error — so an unbounded send hangs
        // forever against exactly the device this tool exists for.
        send: (method, params = {}, timeoutMs = 15000) =>
          new Promise((res, rej) => {
            const myId = ++id;
            const timer = setTimeout(() => {
              pending.delete(myId);
              rej(new Error(`${method}: no reply in ${timeoutMs}ms (unsupported on this webview?)`));
            }, timeoutMs);
            pending.set(myId, {
              resolve: (v) => { clearTimeout(timer); res(v); },
              reject: (e) => { clearTimeout(timer); rej(e); },
            });
            ws.send(JSON.stringify({ id: myId, method, params }));
          }),
        close: () => ws.close(),
      });
  });
}

/** Evaluate an expression in the page and return its value. */
async function evaluate(cdp, expression) {
  const r = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  }
  return r.result.value;
}

/**
 * One health reading. Everything here is cheap and side-effect free — this gets
 * polled, so it must not itself perturb what it measures.
 */
const SNAPSHOT = `(() => {
  const m = performance.memory || {};
  const vids = Array.from(document.querySelectorAll('video'));
  return {
    url: location.pathname,
    heapMB: m.usedJSHeapSize ? +(m.usedJSHeapSize / 1048576).toFixed(1) : null,
    heapTotalMB: m.totalJSHeapSize ? +(m.totalJSHeapSize / 1048576).toFixed(1) : null,
    heapLimitMB: m.jsHeapSizeLimit ? +(m.jsHeapSizeLimit / 1048576).toFixed(0) : null,
    domNodes: document.getElementsByTagName('*').length,
    focusables: document.querySelectorAll('[data-tv]').length,
    images: document.images.length,
    // Leak suspects: a video element or MediaSource that outlives its channel.
    videos: vids.length,
    videoSrcs: vids.map(v => (v.src || '').slice(0, 24)),
    // A video holding buffered ranges it will never play is retained decode
    // memory — the thing most likely to wedge a 1GB renderer.
    // NOTE: \`catch (e)\`, never \`catch {\`. Optional catch binding is ES2019 and
    // this webview is Chromium 63 — a bare \`catch {\` is a SyntaxError that kills
    // the WHOLE expression, which is exactly how this script failed first run.
    // Nothing evaluated here is transpiled the way the app's own bundle is.
    buffered: vids.map(v => { try { return v.buffered.length; } catch (e) { return -1; } }),
    // The two numbers that explain a wedge after the fact: was the playhead
    // still advancing, and was there buffer left ahead of it? A freeze with a
    // full buffer and a stopped playhead is a different failure from one that
    // starved. Without these the run-up samples say nothing useful.
    t: vids.map(v => +(v.currentTime || 0).toFixed(1)),
    ahead: vids.map(v => {
      try {
        var b = v.buffered;
        return b.length ? +(b.end(b.length - 1) - v.currentTime).toFixed(1) : 0;
      } catch (e) { return -1; }
    }),
    readyState: vids.map(v => v.readyState),
    paused: vids.map(v => v.paused),
    dropped: vids.map(v => {
      try {
        var q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
        return q ? q.droppedVideoFrames : -1;
      } catch (e) { return -1; }
    }),
    ts: Date.now(),
  };
})()`;

/**
 * Event recorder, injected into the page.
 *
 * WHY: a 50-minute steady-state watch of the channel that freezes twice showed
 * ZERO stalls, ZERO dropped frames, readyState 4 throughout and a heap that
 * plateaued. So the freeze is not decay — it is triggered by an EVENT, and
 *3-second polling cannot see events. This records them as they happen into a
 * ring buffer the poller drains, so the wedge log carries what the app was
 * doing in the seconds before it stopped.
 *
 * Chromium-63 safe: no arrow functions in the injected body, no `catch {}`, no
 * optional chaining. This is NOT transpiled the way the app bundle is.
 */
const ARM = `(function () {
  if (window.__tvlog) return "already armed";
  window.__tvlog = [];
  var push = function (kind, detail) {
    window.__tvlog.push(
      new Date().toLocaleTimeString([], { hour12: false }) + " " + kind + (detail ? " " + detail : "")
    );
    // Bounded: we only ever want the tail before a wedge.
    if (window.__tvlog.length > 200) window.__tvlog.shift();
  };
  window.__tvpush = push;

  window.addEventListener("error", function (e) {
    push("js-error", (e && e.message ? e.message : "?").slice(0, 120));
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    push("rejection", String(r && r.message ? r.message : r).slice(0, 120));
  });

  // Media events on whatever <video> is current, re-bound when it is replaced.
  var bound = null;
  var bind = function () {
    var v = document.querySelector("video");
    if (!v || v === bound) return;
    bound = v;
    push("video-new", (v.src || "").slice(0, 40));
    var names = ["error", "stalled", "waiting", "emptied", "abort", "ended", "pause", "playing"];
    for (var i = 0; i < names.length; i++) {
      (function (n) {
        v.addEventListener(n, function () {
          var extra = "";
          if (n === "error" && v.error) extra = "code=" + v.error.code;
          push("video:" + n, extra);
        });
      })(names[i]);
    }
  };
  bind();
  setInterval(bind, 1000);

  // Route changes (a zap is client-side, so this is the only signal).
  var route = location.pathname;
  setInterval(function () {
    if (location.pathname !== route) {
      push("route", route + " -> " + location.pathname);
      route = location.pathname;
    }
  }, 500);

  push("armed", location.pathname);
  return "armed";
})()`;

async function main() {
  const { url, pageUrl } = await wsUrl();
  const cdp = await connect(url);

  if (cmd === "eval") {
    console.log(JSON.stringify(await evaluate(cdp, arg), null, 2));
    cdp.close();
    return;
  }

  if (cmd === "metrics") {
    // Performance.getMetrics sees what the page cannot: Documents, Frames,
    // JSEventListeners, LayoutObjects. A renderer that dies with a FLAT JS heap
    // — which is what this TV does — is leaking one of those, or native memory
    // behind them. Counting them across zaps is the only view we get, since the
    // retail firmware blocks both a shell and dlog.
    // Performance.getMetrics is too NEW for this webview (it never replies).
    // Memory.getDOMCounters is old enough and carries the three numbers that
    // matter for a leak the JS heap can't see: retained Documents, live Nodes,
    // and JS event listeners.
    const out = {};
    try {
      Object.assign(out, await cdp.send("Memory.getDOMCounters", {}, 8000));
    } catch (e) {
      out.domCountersError = e.message;
    }
    Object.assign(out, await evaluate(cdp, SNAPSHOT));
    console.log(JSON.stringify(out, null, 2));
    cdp.close();
    return;
  }

  if (cmd === "snapshot") {
    console.log("page:", pageUrl);
    console.log(JSON.stringify(await evaluate(cdp, SNAPSHOT), null, 2));
    cdp.close();
    return;
  }

  if (cmd === "watch") {
    const secs = Number(arg) || 300;
    const until = Date.now() + secs * 1000;
    // Arm the event recorder first — the steady-state numbers alone proved
    // insufficient (50 clean minutes on the channel that freezes).
    try {
      console.log("recorder:", await evaluate(cdp, ARM));
    } catch (e) {
      console.log("recorder: FAILED to arm —", e.message);
    }
    console.log(`watching ${pageUrl} for ${secs}s — zap channels, open the guide, reproduce the freeze\n`);
    console.log("time     route                 heap  nodes  vid   playhead  ahead  rs  dropped");
    let first = null;
    while (Date.now() < until) {
      let s;
      try {
        s = await evaluate(cdp, SNAPSHOT);
      } catch (e) {
        // A wedged renderer stops answering — that IS the signal we're after.
        console.log(`\n!! page stopped responding to CDP: ${e.message}`);
        console.log("   (that is the freeze — the renderer is not running JS)");
        break;
      }
      first ??= s;
      const t = new Date().toLocaleTimeString([], { hour12: false });
      // A stuck playhead with `ahead` still healthy is the signature worth
      // catching: buffer present, nothing consuming it.
      console.log(
        `${t} ${String(s.url).slice(0, 21).padEnd(21)} ` +
          `${String(s.heapMB).padStart(5)}MB ${String(s.domNodes).padStart(5)} ` +
          `${String(s.videos).padStart(3)} ${JSON.stringify(s.t).padStart(10)} ` +
          `${JSON.stringify(s.ahead).padStart(7)} ${JSON.stringify(s.readyState).padStart(4)} ` +
          `${JSON.stringify(s.dropped)}`,
      );
      // Drain anything the recorder captured since the last poll, so events
      // appear inline with the numbers rather than only at the end.
      try {
        const evs = await evaluate(cdp, "(function(){var a=window.__tvlog||[];window.__tvlog=[];return a})()");
        for (const line of evs || []) console.log("   * " + line);
      } catch (e) { /* renderer going down — the next poll reports it */ }
      await new Promise((r) => setTimeout(r, 3000));
    }
    cdp.close();
    return;
  }

  console.error(`unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
