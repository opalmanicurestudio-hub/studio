'use client';

import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
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
    const master = ctx.createGain();
    master.gain.value = 0.14;
    master.connect(ctx.destination);
    const tone = (freq: number, start: number, dur: number, type: OscillatorType = 'sine', peak = 1) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(peak, ctx.currentTime + start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.02);
    };
    if (ok) {
      // A bright, friendly two-note chirp (E6 → B6) — reads as "got it".
      tone(1318.5, 0, 0.09);
      tone(1975.5, 0.07, 0.12);
    } else {
      // A soft low double-thud — unmistakably "no", without being harsh.
      tone(196, 0, 0.12, 'triangle', 0.9);
      tone(147, 0.14, 0.16, 'triangle', 0.9);
    }
    setTimeout(() => ctx.close().catch(() => {}), 600);
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
      qr = new Html5Qrcode(idRef.current, {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
        ],
        verbose: false,
      } as any);
      qr.start(
        { facingMode: 'environment' },
        {
          fps: 15,
          // WIDE box: 1D barcodes (UPC/EAN/Code128) are wide and short — a
          // squarish box makes the decoder miss them. Sized to the viewport.
          qrbox: (vw: number, vh: number) => ({
            width: Math.min(Math.floor(vw * 0.9), 320),
            height: Math.min(Math.floor(vh * 0.55), 150),
          }),
          // Native BarcodeDetector (Chrome/Android + iOS 17 Safari) is far
          // more reliable on phones than the JS decoder — use it when there.
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        } as any,
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
