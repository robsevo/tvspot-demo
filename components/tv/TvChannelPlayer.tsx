"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useChannels } from "@/hooks/useChannels";
import { useEpg } from "@/hooks/useEpg";
import { channelSlug } from "@/lib/sources";
import { type SourceStatus } from "@/hooks/useStreamCheck";
import { useLiveSources } from "@/hooks/useLiveSources";
import VideoPlayer from "@/components/VideoPlayer";
import { LogoImage } from "@/components/LogoImage";
import { useTvBack } from "@/components/tv/TvNav";
import TvKeyHints from "@/components/tv/TvKeyHints";
import { nowAndNext, fmtTime } from "@/lib/tvEpg";
import { TVKEY } from "@/lib/tv";
import { Check, X, Loader2, RefreshCw } from "lucide-react";

/** Transient channel/source banner lifetime. */
const BANNER_MS = 3500;
/** Info overlay auto-closes after this much remote inactivity. */
const OVERLAY_IDLE_MS = 8000;

function StatusDot({ status }: { status: SourceStatus }) {
  if (status === "checking") return <Loader2 className="w-4 h-4 animate-spin text-text-muted" />;
  if (status === "working") return <Check className="w-4 h-4 text-green-400" />;
  if (status === "dead") return <X className="w-4 h-4 text-red-400" />;
  if (status === "busy") return <span className="w-3 h-3 rounded-full bg-amber-400" />;
  return null;
}

/**
 * Full-screen live player for the TV shell. The source pipeline — verified
 * links first, live probing, busy-aware auto-pick, drop cooldowns — is SHARED
 * with the web player via useLiveSources; only the control surface differs:
 *
 *   Up/Down (or ChannelUp/Down)  zap to the prev/next channel
 *   Left/Right                   cycle to another source
 *   Enter                        info overlay (sources, status, recheck)
 *   Play/Pause media keys        pause/resume
 *   Back                         close the overlay, else leave the player
 */
export default function TvChannelPlayer({ channelName }: { channelName: string }) {
  const { channels } = useChannels();
  const router = useRouter();

  const channel = channels.find((c) => channelSlug(c.name) === channelName);

  // EPG for the banner/overlay — one channel; sports game-guide fills gaps.
  const epgNames = useMemo(() => (channel ? [channel.name] : []), [channel?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const { epg } = useEpg(epgNames);
  const guide = nowAndNext(
    channel && epg[channel.name]?.length ? epg[channel.name] : channel?.programs,
  );

  // ── source pipeline ─────────────────────────────────────────────────────
  // Shared with the web player. It was a hand-port for a long time — the same
  // ~200-line state machine kept in sync by copying — and the two had already
  // drifted. Now there is one implementation and this component owns only the
  // 10-foot control surface below.
  const {
    allUrls, src, displayUrls, badgeOf, condemned, shownWorking, busyCount,
    loading, settled, revalidating, pick, recheckAll, onStarted, onFailure,
  } = useLiveSources(channel, channelName);

  // ── TV controls ─────────────────────────────────────────────────────────
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const overlayOpenRef = useRef(false);
  overlayOpenRef.current = overlayOpen;

  // Transient banner: shows on channel entry and on source change.
  const [bannerText, setBannerText] = useState<string | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showBanner = useCallback((text: string) => {
    setBannerText(text);
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setBannerText(null), BANNER_MS);
  }, []);
  useEffect(() => () => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
  }, []);
  useEffect(() => {
    if (channel) showBanner(channel.name);
  }, [channel?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const zap = useCallback(
    (delta: 1 | -1) => {
      if (!channel) return;
      const idx = channels.findIndex((c) => c.name === channel.name);
      const next = channels[idx + delta];
      if (next) router.replace(`/tv/live/${channelSlug(next.name)}`);
    },
    [channel, channels, router],
  );

  const cycleSource = useCallback(
    (delta: 1 | -1) => {
      if (displayUrls.length < 2) return;
      const cur = Math.max(0, displayUrls.indexOf(src));
      const next = (cur + delta + displayUrls.length) % displayUrls.length;
      pick(displayUrls[next]);
      showBanner(`Source ${next + 1} of ${displayUrls.length}`);
    },
    [displayUrls, src, showBanner, pick],
  );

  // Remote keys while the overlay is CLOSED. With it open, TvNav's spatial
  // focus owns the arrows (the overlay is a data-tv-trap) and Back closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (overlayOpenRef.current) return;
      const code = e.keyCode;
      switch (code) {
        case TVKEY.up:
        case TVKEY.channelUp:
          e.preventDefault();
          zap(1);
          return;
        case TVKEY.down:
        case TVKEY.channelDown:
          e.preventDefault();
          zap(-1);
          return;
        case TVKEY.left:
          e.preventDefault();
          cycleSource(-1);
          return;
        case TVKEY.right:
          e.preventDefault();
          cycleSource(1);
          return;
        case TVKEY.enter:
          e.preventDefault();
          setOverlayOpen(true);
          return;
        case TVKEY.playPause:
        case TVKEY.play:
        case TVKEY.pause: {
          e.preventDefault();
          const v = videoElRef.current;
          if (!v) return;
          if (code === TVKEY.play ? v.paused : code === TVKEY.pause ? !v.paused : true) {
            if (v.paused) void v.play().catch(() => {});
            else v.pause();
          }
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zap, cycleSource]);

  // Back closes the overlay while it's open (innermost handler wins; with the
  // overlay closed, TvNav's default Back leaves the player).
  const closeOverlay = useCallback(() => setOverlayOpen(false), []);
  useTvBack(overlayOpen ? closeOverlay : null);

  // The overlay auto-closes after idle so it can't sit over the video forever.
  useEffect(() => {
    if (!overlayOpen) return;
    let timer = setTimeout(closeOverlay, OVERLAY_IDLE_MS);
    const rearm = () => {
      clearTimeout(timer);
      timer = setTimeout(closeOverlay, OVERLAY_IDLE_MS);
    };
    window.addEventListener("keydown", rearm);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", rearm);
    };
  }, [overlayOpen, closeOverlay]);

  if (!channel) {
    // Lineup still loading (cold start straight into a deep link) vs a truly
    // unknown slug — don't flash "not found" while the list is on its way.
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <p className="text-2xl text-text-secondary">
          {channels.length === 0 ? "Tuning…" : "Channel not found"}
        </p>
      </div>
    );
  }

  return (
    // tv-osd-open lifts the captions clear of the source overlay while it is up
    // — both are bottom-anchored, so without it the panel sits on top of them.
    // See .tv-osd-open .tv-cc-overlay in globals.css.
    <div className={`fixed inset-0 bg-black ${overlayOpen ? "tv-osd-open" : ""}`}>
      {/* VideoPlayer renders a w-full aspect-video box — on a 16:9 panel that
          IS the screen; strip its mobile rounding and its touch chrome (the
          TV draws its own OSD; the webview synthesizes mouse events from
          D-pad input, which used to pop the phone controls over the video). */}
      <div className="w-full h-full flex items-center justify-center [&>div]:rounded-none">
        <VideoPlayer
          src={src}
          channelName={channel.name}
          title={channel.name}
          poster={channel.logo_url || channel.logo}
          isLive
          hideControls
          videoElRef={videoElRef}
          onStarted={onStarted}
          onStall={onFailure}
          onError={onFailure}
        />
      </div>

      {/* Remote hints (top-right, transient). Deliberately opposite the zap
          banner's bottom-left corner and clear of the info overlay, so all
          three can be up at once without colliding. Hidden the moment the
          overlay opens — at that point the overlay's own footer line takes
          over as the key legend. */}
      <TvKeyHints
        id="live"
        suppressed={overlayOpen}
        hints={[
          { keys: "Enter", label: "Source list & Recheck" },
          { keys: "▲ ▼", label: "Change channel" },
          { keys: "◀ ▶", label: "Change source" },
        ]}
        footer="Buffering or stuck? Press Enter, then Recheck."
      />

      {/* Zap banner (bottom-left, transient): channel + what's on now. */}
      {bannerText && !overlayOpen && (
        <div className="absolute bottom-12 left-12 flex items-center gap-5 bg-[#0f171e]/90 rounded-xl px-7 py-5 ring-1 ring-white/10 animate-fade-in max-w-2xl">
          <div className="w-20 h-12 shrink-0">
            <LogoImage
              name={channel.name}
              logoUrl={channel.logo_url || channel.logo}
              className="w-full h-full"
              fallbackClassName="text-lg font-bold text-white/80"
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <p className="text-2xl font-bold text-white truncate">{bannerText}</p>
              {channel.online && (
                <span className="text-[11px] font-bold tracking-wider text-white bg-[#cc0000] rounded px-1.5 py-0.5 shrink-0">
                  LIVE
                </span>
              )}
            </div>
            {guide.now && (
              <>
                <p className="text-lg text-[#aebbc5] truncate mt-0.5">{guide.now.title}</p>
                <div className="mt-2 h-1 rounded-full bg-white/15 overflow-hidden">
                  <div
                    className="h-full bg-[#1399ff]"
                    style={{ width: `${Math.round(guide.progress)}%` }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Info overlay: now/next + sources + recheck. data-tv-trap hands the
          arrows to spatial focus among the chips while it's open. */}
      {overlayOpen && (
        <div
          data-tv-trap
          className="tv-fade-osd absolute inset-x-0 bottom-0 px-14 pt-28 pb-10 animate-fade-in"
        >
          <div className="flex items-center gap-6 mb-5">
            <div className="w-24 h-14 shrink-0">
              <LogoImage
                name={channel.name}
                logoUrl={channel.logo_url || channel.logo}
                className="w-full h-full"
                fallbackClassName="text-xl font-bold text-white/80"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-3xl font-bold text-white truncate">{channel.name}</p>
              {guide.now ? (
                <p className="text-lg text-[#aebbc5] truncate">
                  Now · {guide.now.title}
                  {guide.next && (
                    <span className="text-[#8197a4]">
                      {"   ·   "}Next {fmtTime(guide.next.start_utc)} · {guide.next.title}
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-lg text-[#8197a4]">
                  {loading
                    ? "Checking sources…"
                    : shownWorking > 0
                      ? `${shownWorking} of ${allUrls.length} sources online`
                      : "Searching for a working source…"}
                </p>
              )}
            </div>
            {/* Counts lead, "checking" trails — verdicts land per panel now, so
                the first one is ~0.5s in and the couch should see that. */}
            <p className="text-base text-[#8197a4] shrink-0">
              {shownWorking > 0
                ? `${shownWorking} online${busyCount > 0 ? ` · ${busyCount} busy` : ""} of ${allUrls.length}${!settled ? " · checking…" : ""}`
                : loading
                  ? "Checking sources…"
                  : busyCount > 0
                    ? `${busyCount} busy — will connect when free`
                    : `0 of ${allUrls.length} online`}
            </p>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            {/* Recheck leads the row. The overlay gets opened BECAUSE something
                is wrong, and this is the one control that re-judges every source
                at once — behind up to ten chips it was the furthest thing from
                the remote at the moment it's most wanted.
                Moving it here costs nothing on the way in: displayUrls sorts the
                playing/picked source to tier 0, so the chip carrying
                data-tv-autofocus is normally the FIRST one, which now sits
                immediately to Recheck's right. One press of Left. */}
            {/* Feedback is wired to `revalidating`, NOT `loading` — that gap is
                why this button "did nothing" on the Samsung and the Fire Stick.
                useStreamCheck deliberately leaves `loading` false during a
                manual recheck (blanking every badge on each press was the old
                flicker bug) and raises `revalidating` instead. The web player
                reads that flag; this one never destructured it, so a press ran
                a full probe round whose results usually MERGE to the same
                verdicts — no spinner, no label change, nothing on screen. On a
                10-foot UI with no devtools that is indistinguishable from a dead
                button. The label swap matters more than the spinner here: it is
                readable from a couch. */}
            <button
              data-tv
              onClick={recheckAll}
              disabled={loading || revalidating}
              className="flex items-center gap-2.5 px-6 py-3.5 rounded-lg text-xl font-medium bg-[#1a242f] text-[#aebbc5] disabled:opacity-50"
            >
              <RefreshCw className={`w-5 h-5 ${loading || revalidating ? "animate-spin" : ""}`} />
              {revalidating ? "Checking…" : "Recheck"}
            </button>
            {displayUrls.map((url) => {
              // isCondemned, not isDead: only a source that dropped ALONE earns
              // the ✗. One caught in a relay-wide blip keeps its real badge —
              // painting three healthy sources ✗ for one hiccup is the bug this
              // fixes. badgeOf holds the chip at "checking" until the pass is in.
              const status = condemned(url) ? "dead" : badgeOf(url);
              const isCurrent = url === src;
              return (
                <button
                  key={url}
                  data-tv
                  {...(isCurrent ? { "data-tv-autofocus": true } : {})}
                  onClick={() => {
                    pick(url);
                    setOverlayOpen(false);
                  }}
                  className={`flex items-center gap-2.5 px-6 py-3.5 rounded-lg text-xl font-medium ${
                    isCurrent
                      ? "bg-white text-black"
                      : status === "dead"
                        ? "bg-[#1a242f] text-[#5a6b78]"
                        : "bg-[#1a242f] text-[#aebbc5]"
                  }`}
                >
                  <StatusDot status={status} />
                  Source {allUrls.indexOf(url) + 1}
                </button>
              );
            })}
          </div>

          <p className="mt-6 text-base text-[#5a6b78]">
            Up/Down: channel · Left/Right: source · Back: close
          </p>
        </div>
      )}
    </div>
  );
}
