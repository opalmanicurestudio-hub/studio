'use client';
// src/lib/use-nfc.ts — READ NFC TAGS WITH THE PHONE ITSELF, where the browser allows it (Chrome on Android). Elsewhere
// `supported` is false and nothing is shown; an RFID/NFC reader that types the ID works on every device regardless.
import * as React from 'react';
export function useNfc(onRead: (id: string) => void) {
  const supported = typeof window !== 'undefined' && 'NDEFReader' in window;
  const [on, setOn] = React.useState(false); const [error, setError] = React.useState<string | null>(null);
  const cb = React.useRef(onRead); React.useEffect(() => { cb.current = onRead; }, [onRead]);
  const stop = React.useRef<AbortController | null>(null);
  const start = React.useCallback(async () => { if (!supported) return; setError(null);
    try { const ctl = new AbortController(); const reader = new (window as any).NDEFReader(); await reader.scan({ signal: ctl.signal });
      reader.onreading = (ev: any) => { const id = String(ev?.serialNumber || '').trim(); if (id) cb.current(id); };
      reader.onreadingerror = () => setError('That tag couldn’t be read — hold it steady against the back of the phone.');
      stop.current = ctl; setOn(true); }
    catch { setError('NFC is off or not allowed — turn NFC on in the phone’s settings and allow it for this site.'); setOn(false); } }, [supported]);
  const end = React.useCallback(() => { stop.current?.abort(); stop.current = null; setOn(false); }, []);
  React.useEffect(() => () => { stop.current?.abort(); }, []);
  return { supported, on, error, start, end };
}
