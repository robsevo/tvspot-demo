"use client";

/**
 * Module-level "is a stream actively playing right now" signal.
 *
 * Why a module and not the usePlayer context: the deploy-reload gates
 * (components/DeployRefresh.tsx, components/ServiceWorkerRegister.tsx) are mounted
 * in the ROOT layout, ABOVE PlayerProvider, so they can't read player context.
 * They can import this. It lets them hold off a version-skew reload while a stream
 * is on screen, so a production deploy never yanks the app out mid-watch — the
 * reload happens the moment playback stops or the tab is backgrounded instead.
 *
 * VideoPlayer is the single writer (its own play/pause/ended/unmount). Only one
 * stream plays at a time in this app, so a boolean is sufficient; a channel switch
 * (old player pause → new player play) briefly flips it false, which the reload
 * gate's short grace window absorbs.
 */
let _active = false;
const listeners = new Set<(active: boolean) => void>();

export function setPlaybackActive(active: boolean): void {
  if (_active === active) return;
  _active = active;
  for (const l of listeners) {
    try {
      l(active);
    } catch {
      // a listener throwing must not wedge playback state for the others
    }
  }
}

export function isPlaybackActive(): boolean {
  return _active;
}

/** Subscribe to active↔idle transitions. Returns an unsubscribe fn. */
export function onPlaybackChange(cb: (active: boolean) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
