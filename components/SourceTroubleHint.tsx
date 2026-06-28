"use client";

import { useState, useEffect } from "react";
import { AlertCircle } from "lucide-react";

/**
 * Shows a gentle "having trouble?" hint after `delayMs` (default 30s) of the
 * current source being selected, prompting the user to switch sources manually.
 * We do NOT auto-switch — the user picks. Re-arms whenever `resetKey` changes
 * (i.e. when the user switches source or episode), so the timer restarts per
 * source rather than firing once globally.
 */
export function SourceTroubleHint({
  resetKey,
  delayMs = 30000,
  message = "Trouble playing? Try another source above.",
}: {
  resetKey: string | number;
  delayMs?: number;
  message?: string;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(false);
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [resetKey, delayMs]);

  if (!show) return null;
  return (
    <div className="mt-2 flex items-center gap-2 text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 animate-fade-in">
      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}
