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
        send: (method, params = {}) =>
          new Promise((res, rej) => {
            const myId = ++id;
            pending.set(myId, { resolve: res, reject: rej });
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
    readyState: vids.map(v => v.readyState),
    paused: vids.map(v => v.paused),
    ts: Date.now(),
  };
})()`;

async function main() {
  const { url, pageUrl } = await wsUrl();
  const cdp = await connect(url);

  if (cmd === "eval") {
    console.log(JSON.stringify(await evaluate(cdp, arg), null, 2));
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
    console.log(`watching ${pageUrl} for ${secs}s — zap channels, open the guide, reproduce the freeze\n`);
    console.log("time   route                heap   nodes  foc  img vid buffered  state");
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
      console.log(
        `${t} ${String(s.url).slice(0, 20).padEnd(20)} ` +
          `${String(s.heapMB).padStart(5)}MB ${String(s.domNodes).padStart(6)} ` +
          `${String(s.focusables).padStart(4)} ${String(s.images).padStart(4)} ` +
          `${String(s.videos).padStart(3)} ${JSON.stringify(s.buffered).padEnd(9)} ` +
          `${JSON.stringify(s.readyState)}`,
      );
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
