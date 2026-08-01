'use client';

import { Html5Qrcode } from 'html5-qrcode';
import { Camera, Keyboard } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

// ─── src/components/retail/ScanGate.tsx ───────────────────────────────────────
// The one scan surface used at every fulfillment checkpoint: item picking,
// customer-QR handoff, and (later) return receiving. Continuous scanning —
// it does NOT stop after a read, because picking means scanning many items
// back to back. A short debounce swallows the duplicate frames a camera
// produces while the same barcode sits in view, while still allowing an
// intentional immediate re-scan of the same SKU (qty > 1) after the window.
//
// Feedback is delegated: call ScanGate.feedback(ok) from your scan handler
// after the engine validates — a scan is only "good" when the ORDER says so,
// not when the camera merely reads a code.

const DEBOUNCE_MS = 1600;

function beep(ok: boolean) {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = ok ? 1200 : 220;
    gain.gain.value = 0.08;
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.09 : 0.25));
    osc.onended = () => ctx.close().catch(() => {});
  } catch {
    // audio is best-effort
  }
}

export function scanFeedback(ok: boolean) {
  beep(ok);
  try {
    if (navigator.vibrate) navigator.vibrate(ok ? 40 : [80, 60, 80]);
  } catch {
    // vibration is best-effort
  }
}

export function ScanGate({
  onScan,
  paused = false,
  label = 'Point the camera at a code',
  className,
}: {
  onScan: (value: string) => void;
  paused?: boolean;
  label?: string;
  className?: string;
}) {
  const idRef = useRef(`scan-gate-${Math.random().toString(36).slice(2, 9)}`);
  const lastRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });
  const onScanRef = useRef(onScan);
  const [cameraError, setCameraError] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualValue, setManualValue] = useState('');

  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  useEffect(() => {
    if (paused) return;
    let qr: Html5Qrcode | undefined;
    let cancelled = false;

    const timer = setTimeout(() => {
      const el = document.getElementById(idRef.current);
      if (!el || cancelled) return;
      qr = new Html5Qrcode(idRef.current);
      qr.start(
        { facingMode: 'environment' },
        { fps: 12, qrbox: { width: 240, height: 180 } },
        (text: string) => {
          const raw = text.trim();
          const now = Date.now();
          if (raw === lastRef.current.value && now - lastRef.current.at < DEBOUNCE_MS) return;
          lastRef.current = { value: raw, at: now };
          onScanRef.current(raw);
        },
        () => {}
      ).catch(() => {
        if (!cancelled) setCameraError('Camera unavailable — check permissions or close other camera apps.');
      });
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (qr?.isScanning) qr.stop().catch(console.error);
    };
  }, [paused]);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="relative rounded-2xl border-2 overflow-hidden bg-black min-h-[220px]">
        <div id={idRef.current} className="w-full" />
        {cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center bg-black/80">
            <Camera className="w-6 h-6 text-white/40" />
            <p className="text-[10px] font-black uppercase tracking-widest text-white/70">{cameraError}</p>
          </div>
        )}
      </div>
      <p className="text-[9px] font-black uppercase tracking-widest text-center text-muted-foreground/60">{label}</p>
          <div className="mt-2">
        {manualOpen ? (
          <form
            className="flex gap-2"
            onSubmit={(e: React.FormEvent) => {
              e.preventDefault();
              const v = manualValue.trim();
              if (!v) return;
              onScanRef.current(v);
              setManualValue('');
            }}
          >
            <input
              value={manualValue}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setManualValue(e.target.value)}
              placeholder="Type the SKU, barcode, or code"
              autoFocus
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="h-11 flex-1 rounded-xl border-2 bg-white px-3 font-mono font-black text-xs uppercase tracking-widest outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={!manualValue.trim()}
              className="h-11 px-4 rounded-xl border-2 bg-foreground text-background text-[9px] font-black uppercase tracking-widest disabled:opacity-40"
            >
              Enter
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            className="w-full h-9 rounded-xl border-2 border-dashed text-[9px] font-black uppercase tracking-widest text-muted-foreground hover:border-primary/40 transition-all flex items-center justify-center gap-1.5"
          >
            <Keyboard className="w-3.5 h-3.5" /> Can&apos;t scan? Type it instead
          </button>
        )}
      </div>
</div>
  );
}
