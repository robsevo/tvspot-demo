"use client";

/**
 * Google Cast Web Sender SDK wrapper.
 * Loads the Cast SDK script on demand and provides a simple API.
 * The chrome.cast namespace is provided by the external script loaded at runtime.
 */

const castLoaded = false;
let castInitPromise: Promise<void> | null = null;

declare global {
  interface Window {
    chrome?: any;
    __onGCastApiAvailable?: (available: boolean) => void;
  }
}

export function loadCastSDK(): Promise<void> {
  if (castInitPromise) return castInitPromise;
  if (castLoaded) return Promise.resolve();

  castInitPromise = new Promise((resolve, reject) => {
    if (window.chrome?.cast?.isAvailable) {
      initCast(resolve, reject);
      return;
    }
    window.__onGCastApiAvailable = (available: boolean) => {
      if (available) {
        initCast(resolve, reject);
      } else {
        reject(new Error("Cast SDK not available"));
      }
    };
    const script = document.createElement("script");
    script.src =
      "//www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
    script.async = true;
    script.onerror = () => reject(new Error("Failed to load Cast SDK"));
    document.head.appendChild(script);
  });

  return castInitPromise;
}

function initCast(resolve: () => void, reject: (err: Error) => void) {
  try {
    const appId =
      process.env.NEXT_PUBLIC_CAST_APP_ID ||
      window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID;
    const sessionRequest = new window.chrome.cast.SessionRequest(appId);
    const apiConfig = new window.chrome.cast.ApiConfig(
      sessionRequest,
      () => {},
      () => {}
    );
    window.chrome.cast.initialize(apiConfig, resolve, reject);
  } catch (e) {
    reject(e as Error);
  }
}

export function isCastAvailable(): boolean {
  return !!window.chrome?.cast?.isAvailable;
}

// The live cast session, so the player can end it ("Play here instead") and so
// a second castMedia can reuse/replace it cleanly.
let activeSession: any = null;

/** End the current cast session (stops playback on the TV). Safe to call always. */
export function endCastSession(): void {
  try {
    activeSession?.stop(() => {}, () => {});
  } catch {}
  activeSession = null;
}

/**
 * The Chromecast fetches media from ITS OWN place on the network, so the URL
 * has to be absolute — a relative path has no origin for the receiver to
 * resolve, and loadMedia just fails on the device. Our VOD sources are
 * same-origin proxy paths (/api/vod-stream?url=…), so they were being handed to
 * the receiver as bare relative strings and never played. /api/vod-stream is
 * public and self-authenticates via the &st= token already in the URL (see
 * middleware.ts), so the absolute form is fetchable by a cookieless device.
 * Already-absolute live URLs pass through unchanged.
 */
function absoluteMediaUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return url;
  }
}

/**
 * Content type the receiver should expect. The Default Media Receiver keys its
 * pipeline off this, and it can reject a progressive MP4 announced as HLS — our
 * IPTV direct files are .mp4, so labelling everything x-mpegURL (as this did)
 * broke exactly those. HLS is the manifest form (.m3u8) and our relay remux,
 * which serves rolling live-style HLS through the same proxy — detect it by the
 * inner target the proxy is wrapping, not the outer /api path.
 */
function guessContentType(url: string): string {
  const inner = (() => {
    const m = url.match(/[?&]url=([^&]+)/);
    try {
      return m ? decodeURIComponent(m[1]) : url;
    } catch {
      return url;
    }
  })();
  if (/\.m3u8(\?|$)/i.test(inner) || /\/(hls|remux)\//i.test(inner) || /relay\./i.test(inner)) {
    return "application/x-mpegURL";
  }
  if (/\.mp4(\?|$)/i.test(inner)) return "video/mp4";
  if (/\.mkv(\?|$)/i.test(inner)) return "video/x-matroska";
  // Unknown: HLS is the safer default here — every non-direct source we cast
  // (provider-a, Origin, provider-b, remux) is a manifest, and only the direct-file case
  // is MP4, which the checks above already catch when the extension is present.
  return "application/x-mpegURL";
}

export async function castMedia(
  url: string,
  title: string,
  poster?: string,
  opts?: {
    /** Fired once when the TV session ends/disconnects (either side). */
    onSessionEnd?: () => void;
  }
): Promise<void> {
  await loadCastSDK();
  const mediaUrl = absoluteMediaUrl(url);
  const contentType = guessContentType(mediaUrl);
  return new Promise((resolve, reject) => {
    window.chrome.cast.requestSession(
      (session: any) => {
        activeSession = session;
        const mediaInfo = new window.chrome.cast.media.MediaInfo(
          mediaUrl,
          contentType
        );
        mediaInfo.metadata = new window.chrome.cast.media.MovieMediaMetadata();
        mediaInfo.metadata.title = title;
        if (poster) {
          mediaInfo.metadata.images = [new window.chrome.cast.Image(poster)];
        }
        const request = new window.chrome.cast.media.LoadRequest(mediaInfo);
        session.loadMedia(
          request,
          () => {
            if (opts?.onSessionEnd) {
              const listener = (isAlive: boolean) => {
                if (isAlive) return;
                try { session.removeUpdateListener(listener); } catch {}
                if (activeSession === session) activeSession = null;
                opts.onSessionEnd!();
              };
              try { session.addUpdateListener(listener); } catch {}
            }
            resolve();
          },
          reject
        );
      },
      reject
    );
  });
}