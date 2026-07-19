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

  // Chrome < 68 defaults fetch to credentials:"omit" — Set-Cookie on responses
  // is discarded and cookies are never sent, which silently broke sign-in on
  // the TV. Restore the modern default ("same-origin") for calls that don't
  // specify credentials. Only string/URL inputs are touched; Request objects
  // carry their own credentials and pass through untouched.
  if (window.fetch) {
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
      if (typeof input === "string" || input instanceof URL) {
        init = init || {};
        if (!init.credentials) {
          var patched = {};
          for (var k in init) patched[k] = init[k];
          patched.credentials = "same-origin";
          return origFetch.call(this, input, patched);
        }
      }
      return origFetch.call(this, input, init);
    };
  }

  if (typeof Object.hasOwn !== "function") {
    Object.hasOwn = function (obj, prop) {
      return Object.prototype.hasOwnProperty.call(Object(obj), prop);
    };
  }

  if (typeof Array.prototype.at !== "function") {
    var at = function (n) {
      n = Math.trunc(n) || 0;
      if (n < 0) n += this.length;
      if (n < 0 || n >= this.length) return undefined;
      return this[n];
    };
    // defineProperty (not assignment) so the shim stays non-enumerable and
    // never leaks into for...in loops over arrays/strings.
    Object.defineProperty(Array.prototype, "at", { value: at, writable: true, configurable: true });
    Object.defineProperty(String.prototype, "at", { value: at, writable: true, configurable: true });
  }

  if (typeof window.AggregateError === "undefined") {
    var AggErr = function (errors, message) {
      var e = new Error(message);
      e.name = "AggregateError";
      e.errors = Array.prototype.slice.call(errors);
      return e;
    };
    window.AggregateError = AggErr;
  }

  if (window.crypto && typeof window.crypto.randomUUID !== "function") {
    window.crypto.randomUUID = function () {
      var bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
      var hex = [];
      for (var i = 0; i < 16; i++) hex.push((bytes[i] + 256).toString(16).slice(1));
      return (
        hex.slice(0, 4).join("") + "-" + hex.slice(4, 6).join("") + "-" +
        hex.slice(6, 8).join("") + "-" + hex.slice(8, 10).join("") + "-" +
        hex.slice(10, 16).join("")
      );
    };
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
    var matchAllShim = function (re) {
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
    Object.defineProperty(String.prototype, "matchAll", {
      value: matchAllShim,
      writable: true,
      configurable: true,
    });
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
