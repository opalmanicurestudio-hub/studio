'use client';

/**
 * QRScanner
 *
 * Camera-based QR code scanner for the POS Scan / Check-In flow.
 *
 * Strategy — two-tier detection:
 *   1. BarcodeDetector API (Chrome 83+, Edge 83+, Android Chrome) — zero
 *      extra dependencies, fast, works on USB scanners via keyboard emulation.
 *   2. jsQR via dynamic import — works on iOS Safari where BarcodeDetector
 *      is absent. Requires `npm install jsqr`. Falls back gracefully to
 *      manual entry if jsQR isn't installed.
 *
 * The component opens the rear camera (facingMode: environment) in a full-
 * screen overlay so the viewfinder is large enough to actually frame a QR.
 * On success it calls onScan(rawValue) and cleans up the stream. The parent
 * is responsible for parsing the value (checking if it's a full URL or an
 * 8-char short code).
 *
 * On any camera permission failure or unsupported browser, a manual text
 * input fallback is shown automatically — scan-in and type-in coexist in
 * the same component.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, Camera, Keyboard, ZapOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface QRScannerProps {
  onScan: (value: string) => void;
  onClose: () => void;
}

type Mode = 'requesting' | 'scanning' | 'denied' | 'unsupported' | 'manual';

export function QRScanner({ onScan, onClose }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const doneRef = useRef(false);

  const [mode, setMode] = useState<Mode>('requesting');
  const [manualCode, setManualCode] = useState('');
  const manualInputRef = useRef<HTMLInputElement>(null);

  const stopStream = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  const handleDetected = useCallback((raw: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    stopStream();
    // Extract 8-char code from full URL if needed
    // e.g. https://studio.app/check-in/aB3xQ7p9LmZ2tR8v → last 8 = "2tR8vK1Y"
    // or raw is already just the 8-char code
    let code = raw;
    try {
      const url = new URL(raw);
      const parts = url.pathname.split('/').filter(Boolean);
      const token = parts[parts.length - 1];
      if (token && token.length >= 8) code = token;
    } catch {
      // Not a URL — use raw value (already a code or token)
    }
    onScan(code);
  }, [onScan, stopStream]);

  useEffect(() => {
    doneRef.current = false;

    if (!navigator?.mediaDevices?.getUserMedia) {
      setMode('unsupported');
      return;
    }

    let cancelled = false;

    (async () => {
      // --- Request camera ---
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        });
      } catch (e: any) {
        if (cancelled) return;
        const name = e?.name || '';
        setMode(name === 'NotAllowedError' || name === 'PermissionDeniedError' ? 'denied' : 'unsupported');
        return;
      }

      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try { await videoRef.current.play(); } catch { }
      }
      setMode('scanning');

      // --- Choose detection strategy ---
      const hasBarcodeDetector = 'BarcodeDetector' in window;
      let detector: any = null;
      if (hasBarcodeDetector) {
        try { detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] }); } catch { }
      }

      // Try to load jsQR dynamically (works on iOS Safari, no BarcodeDetector needed)
      let jsQR: ((data: Uint8ClampedArray, w: number, h: number) => { data: string } | null) | null = null;
      if (!detector) {
        try {
          const mod = await import('jsqr' as any);
          jsQR = mod.default ?? mod;
        } catch {
          // jsQR not installed — will fall through to manual
        }
      }

      if (!detector && !jsQR) {
        if (cancelled) return;
        // Camera works but can't decode — show manual alongside video preview
        setMode('manual');
        return;
      }

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');

      const scan = async () => {
        if (cancelled || doneRef.current) return;
        const video = videoRef.current;
        if (!video || video.readyState < 2) { rafRef.current = requestAnimationFrame(scan); return; }

        try {
          if (detector) {
            const results = await detector.detect(video);
            if (results.length > 0) { handleDetected(results[0].rawValue); return; }
          } else if (jsQR && canvas && ctx) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const result = jsQR(imageData.data, canvas.width, canvas.height);
            if (result?.data) { handleDetected(result.data); return; }
          }
        } catch { }

        rafRef.current = requestAnimationFrame(scan);
      };
      rafRef.current = requestAnimationFrame(scan);
    })();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [handleDetected, stopStream]);

  // Auto-focus manual input when mode is manual or unsupported
  useEffect(() => {
    if ((mode === 'manual' || mode === 'denied' || mode === 'unsupported') && manualInputRef.current) {
      setTimeout(() => manualInputRef.current?.focus(), 100);
    }
  }, [mode]);

  const handleManualSubmit = () => {
    const code = manualCode.trim().toUpperCase();
    if (code.length < 6) return;
    handleDetected(code);
  };

  return (
    // Full-screen overlay — important on mobile so the viewfinder is usable
    <div className="fixed inset-0 z-[200] flex flex-col bg-black">
      {/* Close */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={() => { stopStream(); onClose(); }}
          className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Camera viewfinder */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-black">
        <video
          ref={videoRef}
          className={cn(
            'w-full h-full object-cover',
            mode !== 'scanning' && mode !== 'manual' && 'opacity-0',
          )}
          playsInline
          muted
          autoPlay
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Framing guide — visible during scanning */}
        {(mode === 'scanning' || mode === 'manual') && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-56 h-56">
              {/* Corner brackets */}
              {(['tl','tr','bl','br'] as const).map(corner => (
                <div key={corner} className={cn(
                  'absolute w-10 h-10 border-white border-[3px]',
                  corner === 'tl' && 'top-0 left-0 border-r-0 border-b-0 rounded-tl-lg',
                  corner === 'tr' && 'top-0 right-0 border-l-0 border-b-0 rounded-tr-lg',
                  corner === 'bl' && 'bottom-0 left-0 border-r-0 border-t-0 rounded-bl-lg',
                  corner === 'br' && 'bottom-0 right-0 border-l-0 border-t-0 rounded-br-lg',
                )} />
              ))}
              {/* Scan line animation */}
              {mode === 'scanning' && (
                <div
                  className="absolute left-0 right-0 h-0.5 bg-green-400 opacity-80"
                  style={{ animation: 'scanLine 2s linear infinite', top: '50%' }}
                />
              )}
            </div>
          </div>
        )}

        {/* Status overlays */}
        {mode === 'requesting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
            <Camera className="w-10 h-10 animate-pulse opacity-60" />
            <p className="text-sm font-medium opacity-60">Opening camera…</p>
          </div>
        )}
        {mode === 'denied' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white px-8 text-center">
            <ZapOff className="w-10 h-10 opacity-50" />
            <p className="text-base font-bold">Camera access denied</p>
            <p className="text-sm opacity-60">Allow camera access in your browser settings, or type the code below.</p>
          </div>
        )}
        {mode === 'unsupported' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white px-8 text-center">
            <Keyboard className="w-10 h-10 opacity-50" />
            <p className="text-base font-bold">Camera scanning unavailable</p>
            <p className="text-sm opacity-60">This browser doesn't support QR scanning. Type the code below.</p>
          </div>
        )}
      </div>

      {/* Bottom panel — instruction + manual fallback */}
      <div className="bg-black/90 p-5 pb-safe space-y-3" style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
        {mode === 'scanning' && (
          <p className="text-white/70 text-xs text-center font-medium">
            Point at the QR code on the printed ticket or client's phone
          </p>
        )}

        <div className="space-y-2">
          <p className="text-white/40 text-[10px] uppercase tracking-widest font-bold text-center">Or type the 8-char code</p>
          <div className="flex gap-2">
            <Input
              ref={manualInputRef}
              value={manualCode}
              onChange={e => setManualCode(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Enter') handleManualSubmit(); }}
              placeholder="7QX2K9LM"
              className="flex-1 h-12 bg-white/10 border-white/20 text-white placeholder:text-white/30 text-center font-mono font-black text-lg tracking-[0.2em] focus:border-emerald-400 focus:ring-emerald-400"
              maxLength={21}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <Button
              onClick={handleManualSubmit}
              disabled={manualCode.trim().length < 6}
              className="h-12 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm"
            >
              Go
            </Button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes scanLine {
          0%   { transform: translateY(-56px); }
          50%  { transform: translateY(56px); }
          100% { transform: translateY(-56px); }
        }
      `}</style>
    </div>
  );
}
