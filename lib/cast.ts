"use client";

/**
 * Google Cast Web Sender SDK wrapper.
 * Loads the Cast SDK script on demand and provides a simple API.
 * The chrome.cast namespace is provided by the external script loaded at runtime.
 */

let castLoaded = false;
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

export async function castMedia(
  url: string,
  title: string,
  poster?: string
): Promise<void> {
  await loadCastSDK();
  return new Promise((resolve, reject) => {
    window.chrome.cast.requestSession(
      (session: any) => {
        const mediaInfo = new window.chrome.cast.media.MediaInfo(
          url,
          "application/x-mpegURL"
        );
        mediaInfo.metadata = new window.chrome.cast.media.MovieMediaMetadata();
        mediaInfo.metadata.title = title;
        if (poster) {
          mediaInfo.metadata.images = [new window.chrome.cast.Image(poster)];
        }
        const request = new window.chrome.cast.media.LoadRequest(mediaInfo);
        session.loadMedia(request, resolve, reject);
      },
      reject
    );
  });
}