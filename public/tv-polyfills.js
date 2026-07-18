/**
 * Runtime polyfills for the 2019 Samsung TV webview (Tizen 5.0 ≈ Chromium 63).
 *
 * Loaded synchronously from the root layout BEFORE the app bundles, so the
 * APIs exist by the time React/Next code runs. Next's own polyfill chunk
 * covers Array.flat/flatMap and Object.fromEntries but not these. Every shim
 * feature-detects, so modern browsers execute nothing.
 *
 * Written in ES5 on purpose — this file is served verbatim from public/ and
 * must parse on the oldest engine we support.
 */
(function () {
  "use strict";

  if (typeof window.globalThis === "undefined") {
    window.globalThis = window;
  }

  if (typeof window.queueMicrotask !== "function") {
    window.queueMicrotask = function (cb) {
      Promise.resolve().then(cb);
    };
  }

  if (typeof Promise.allSettled !== "function") {
    Promise.allSettled = function (promises) {
      return Promise.all(
        Array.prototype.map.call(promises, function (p) {
          return Promise.resolve(p).then(
            function (value) {
              return { status: "fulfilled", value: value };
            },
            function (reason) {
              return { status: "rejected", reason: reason };
            }
          );
        })
      );
    };
  }

  if (typeof String.prototype.matchAll !== "function") {
    String.prototype.matchAll = function (re) {
      if (re && !re.global) {
        throw new TypeError("matchAll requires a global RegExp");
      }
      var str = this;
      var copy = new RegExp(re.source, re.flags);
      var results = [];
      var m;
      while ((m = copy.exec(str)) !== null) {
        results.push(m);
        if (m[0] === "") copy.lastIndex += 1; // never loop on empty matches
      }
      var i = 0;
      var iterator = {};
      iterator[Symbol.iterator] = function () {
        return iterator;
      };
      iterator.next = function () {
        return i < results.length
          ? { value: results[i++], done: false }
          : { value: undefined, done: true };
      };
      return iterator;
    };
  }

  // Minimal AbortController (Chromium 66+). fetch() won't truly cancel with
  // this shim, but code that creates controllers, checks signal.aborted, and
  // listens for "abort" works — which is all the app does with it.
  if (typeof window.AbortController === "undefined") {
    var Signal = function () {
      this.aborted = false;
      this.reason = undefined;
      this._listeners = [];
    };
    Signal.prototype.addEventListener = function (type, cb) {
      if (type === "abort") this._listeners.push(cb);
    };
    Signal.prototype.removeEventListener = function (type, cb) {
      if (type !== "abort") return;
      var i = this._listeners.indexOf(cb);
      if (i !== -1) this._listeners.splice(i, 1);
    };
    Signal.prototype.throwIfAborted = function () {
      if (this.aborted) throw this.reason;
    };

    var Controller = function () {
      this.signal = new Signal();
    };
    Controller.prototype.abort = function (reason) {
      var signal = this.signal;
      if (signal.aborted) return;
      signal.aborted = true;
      signal.reason =
        reason !== undefined
          ? reason
          : { name: "AbortError", message: "The operation was aborted." };
      var event = { type: "abort", target: signal };
      if (typeof signal.onabort === "function") signal.onabort(event);
      for (var i = 0; i < signal._listeners.length; i++) {
        try {
          signal._listeners[i](event);
        } catch (e) {}
      }
    };

    window.AbortController = Controller;
    window.AbortSignal = Signal;
  }
})();
