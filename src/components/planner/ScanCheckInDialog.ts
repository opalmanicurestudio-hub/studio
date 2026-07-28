'use client';

// src/components/planner/ScanCheckInDialog.tsx
//
// Scan a ticket, find the appointment, check the client in.
//
// Three ways in, because a salon's hardware is whatever it happens to own:
//
//   1. A keyboard-wedge scanner — the cheap laser kind that plugs into USB and
//      "types" what it reads. Nothing to configure: the input below is focused,
//      the scanner types into it, and the code is looked up the moment it lands.
//      Most wedges send Enter at the end; the ones that don't are caught by
//      timing, since no human types eight characters in a tenth of a second.
//   2. The device camera — reads the QR on the guest stub. This uses the
//      browser's own BarcodeDetector, so there is no library to install, but it
//      does mean the camera option only appears where the browser supports it
//      (Chrome on Android, ChromeOS, most desktop Chrome). iPhones and iPads do
//      not, and are told so plainly rather than being shown a button that
//      silently fails.
//   3. Typing the code by hand — always available, always works. This is the
//      path that matters when a client reads their code over the phone.
//
// All three funnel into one lookup. It is deliberately case-tolerant: short
// codes are stored exactly as generated and are displayed uppercase, so a code
// read off paper and typed back in will not match on a case-sensitive compare.
// The in-memory list the planner already holds is checked first; only if that
// misses does this query Firestore, so a scan of next month's ticket still
// resolves even though that appointment isn't on screen.
//
// Short-code uniqueness is not enforced anywhere in the data, so more than one
// appointment CAN come back. That is handled by asking, not by silently taking
// the first one and checking in the wrong client.

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { Camera, CameraOff, Keyboard, Loader2, ScanLine, Search, CheckCircle2, AlertTriangle, Printer, ArrowRight, X } from 'lucide-react';
import { parseScan, codeVariants } from '@/lib/scan-codes';

interface ScanCheckInDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  firestore: any;
  tenantId: string;
  /** Whatever the planner already has in memory. Searched first. */
  appointments?: any[] | null;
  clients?: any[] | null;
  services?: any[] | null;
  staff?: any[] | null;
  /** Open the appointment details sheet. */
  onSelect?: (appointment: any) => void;
  /** Mark the client arrived. Omit to hide the check-in button. */
  onCheckIn?: (appointment: any) => void;
  /** Print the ticket. Omit to hide the print button. */
  onPrintTicket?: (appointment: any) => void;
}

type Phase =
  | { s: 'waiting' }
  | { s: 'looking'; raw: string }
  | { s: 'found'; appointment: any; raw: string }
  | { s: 'choose'; matches: any[]; raw: string }
  | { s: 'miss'; raw: string; reason: string };

const CANCELLED = new Set(['cancelled', 'canceled', 'no_show', 'noshow']);

const safeDate = (val: any): Date | null => {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'object' && typeof val.toDate === 'function') {
    try {
      const d = val.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  if (typeof val === 'object' && typeof val.seconds === 'number') {
    const d = new Date(val.seconds * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

const whenLabel = (val: any): string => {
  const d = safeDate(val);
  if (!d) return 'Time not set';
  try {
    return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return 'Time not set';
  }
};

const titleCase = (v: any): string =>
  String(v ?? '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()).trim();

/**
 * Matches a scanned string against a list of appointments already in memory.
 *
 * Exported because this is the part that decides whether the right client gets
 * checked in, which makes it the part worth testing directly.
 *
 * Cancelled and no-show appointments are ranked last rather than excluded: a
 * cancelled ticket someone still walks in with should surface, so the desk can
 * see WHY nothing is happening instead of being told the code doesn't exist.
 */
export function matchAppointments(raw: string, appointments?: any[] | null): { matches: any[]; kind: string; value: string } {
  const parsed = parseScan(raw);
  const list = Array.isArray(appointments) ? appointments : [];
  if (parsed.kind === 'empty') return { matches: [], kind: 'empty', value: '' };

  const needle = parsed.value.toUpperCase();
  const hits = list.filter((a) => {
    if (!a) return false;
    const code = String(a.shortCode ?? '').trim().toUpperCase();
    const token = String(a.checkInToken ?? '').trim();
    if (parsed.kind === 'token') {
      // A long value is normally a token, but a studio could conceivably issue a
      // long short code, so both fields are compared.
      return token === parsed.value || (!!code && code === needle);
    }
    return (!!code && code === needle) || token.toUpperCase() === needle;
  });

  const rank = (a: any) => (CANCELLED.has(String(a?.status ?? '').toLowerCase()) ? 1 : 0);
  hits.sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    const da = safeDate(a?.startTime)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = safeDate(b?.startTime)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return da - db;
  });

  return { matches: hits, kind: parsed.kind, value: parsed.value };
}

export function ScanCheckInDialog({
  open, onOpenChange, firestore, tenantId,
  appointments, clients, services, staff,
  onSelect, onCheckIn, onPrintTicket,
}: ScanCheckInDialogProps) {
  const [typed, setTyped] = useState('');
  const [phase, setPhase] = useState<Phase>({ s: 'waiting' });
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<any>(null);
  const detectorRef = useRef<any>(null);
  const loopRef = useRef<any>(null);
  // Wedge scanners type unnaturally fast. These track that without interfering
  // with someone typing a code by hand.
  const firstKeyRef = useRef<number>(0);
  const idleRef = useRef<any>(null);
  const busyRef = useRef(false);

  const nameOf = useCallback((apt: any): string => {
    const direct = String(apt?.clientName ?? '').trim();
    if (direct) return direct;
    const c = (clients || []).find((x: any) => x?.id === apt?.clientId);
    return String(c?.name ?? '').trim() || 'Guest';
  }, [clients]);

  const serviceOf = useCallback((apt: any): string => {
    const s = (services || []).find((x: any) => x?.id === apt?.serviceId);
    return String(s?.name ?? '').trim() || 'Appointment';
  }, [services]);

  const staffOf = useCallback((apt: any): string => {
    const s = (staff || []).find((x: any) => x?.id === apt?.staffId);
    return String(s?.name ?? '').trim();
  }, [staff]);

  /** Whether this browser can read a QR from the camera at all. */
  const canUseCamera = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    return !!(nav?.mediaDevices?.getUserMedia) && 'BarcodeDetector' in window;
  }, []);

  const stopCamera = useCallback(() => {
    if (loopRef.current) { clearInterval(loopRef.current); loopRef.current = null; }
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      try { stream.getTracks().forEach((t: any) => { try { t.stop(); } catch { /* noop */ } }); }
      catch { /* noop */ }
    }
    const v = videoRef.current;
    if (v) { try { v.srcObject = null; } catch { /* noop */ } }
  }, []);

  const resolve = useCallback(async (raw: string) => {
    const cleaned = String(raw ?? '');
    if (busyRef.current) return;
    const local = matchAppointments(cleaned, appointments);

    if (local.kind === 'empty') {
      setPhase({ s: 'miss', raw: cleaned, reason: 'That scan came through empty. Try again, or type the code by hand.' });
      return;
    }
    if (local.matches.length === 1) { setPhase({ s: 'found', appointment: local.matches[0], raw: cleaned }); return; }
    if (local.matches.length > 1) { setPhase({ s: 'choose', matches: local.matches, raw: cleaned }); return; }

    // Not on screen. Ask the database directly, so a ticket for another day still
    // resolves instead of reading as an invalid code.
    setPhase({ s: 'looking', raw: cleaned });
    busyRef.current = true;
    try {
      if (!firestore || !tenantId) {
        setPhase({ s: 'miss', raw: cleaned, reason: `No appointment on screen matches ${local.value}.` });
        return;
      }
      const col = collection(firestore, 'tenants', tenantId, 'appointments');
      const found: any[] = [];
      const seen = new Set<string>();
      const push = (snap: any) => {
        snap.forEach((d: any) => {
          if (seen.has(d.id)) return;
          seen.add(d.id);
          found.push({ id: d.id, ...d.data() });
        });
      };

      if (local.kind === 'token') {
        push(await getDocs(query(col, where('checkInToken', '==', local.value), limit(5))));
      } else {
        // Firestore compares strings exactly, so every plausible spelling of the
        // code is asked for at once. codeVariants returns at most three, well
        // inside the ten-value ceiling on an 'in' query.
        const variants = codeVariants(local.value);
        if (variants.length) push(await getDocs(query(col, where('shortCode', 'in', variants), limit(5))));
        if (!found.length) push(await getDocs(query(col, where('checkInToken', '==', local.value), limit(5))));
      }

      if (found.length === 1) setPhase({ s: 'found', appointment: found[0], raw: cleaned });
      else if (found.length > 1) setPhase({ s: 'choose', matches: found, raw: cleaned });
      else setPhase({
        s: 'miss',
        raw: cleaned,
        reason: `Nothing matches ${local.value}. Check you scanned the code on the ticket, or search the client by name in the planner.`,
      });
    } catch (e: any) {
      setPhase({
        s: 'miss',
        raw: cleaned,
        reason: `Could not reach the appointment list just now${e?.message ? ` (${e.message})` : ''}. The code may still be valid — try again.`,
      });
    } finally {
      busyRef.current = false;
    }
  }, [appointments, firestore, tenantId]);

  const submit = useCallback((raw: string) => {
    if (idleRef.current) { clearTimeout(idleRef.current); idleRef.current = null; }
    firstKeyRef.current = 0;
    const value = String(raw ?? '').trim();
    if (!value) return;
    void resolve(value);
  }, [resolve]);

  /* ── Camera ─────────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!open || !camOn) { stopCamera(); return; }
    let cancelled = false;

    (async () => {
      setCamError(null);
      try {
        const win: any = window;
        if (!detectorRef.current) {
          let formats = ['qr_code'];
          try {
            const supported: string[] = await win.BarcodeDetector.getSupportedFormats();
            const wanted = ['qr_code', 'code_128'].filter((f) => supported.includes(f));
            if (wanted.length) formats = wanted;
          } catch { /* keep the default */ }
          detectorRef.current = new win.BarcodeDetector({ formats });
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t: any) => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.muted = true;
          try { await v.play(); } catch { /* autoplay can be refused; the poll still works once playing */ }
        }
        // Four looks a second is plenty and leaves the phone's battery alone.
        loopRef.current = setInterval(async () => {
          const vid = videoRef.current;
          const det = detectorRef.current;
          if (!vid || !det || vid.readyState < 2 || busyRef.current) return;
          try {
            const codes = await det.detect(vid);
            const hit = codes && codes.length ? String(codes[0]?.rawValue ?? '') : '';
            if (hit) {
              setTyped(hit);
              submit(hit);
            }
          } catch { /* a frame that can't be read is not an error worth showing */ }
        }, 250);
      } catch (e: any) {
        if (cancelled) return;
        const msg = String(e?.name || e?.message || '');
        setCamError(
          /NotAllowed|Permission/i.test(msg)
            ? 'Camera access was blocked. Allow it in your browser settings, or use the desk scanner instead.'
            : /NotFound|Devices/i.test(msg)
              ? 'No camera found on this device. Use the desk scanner or type the code.'
              : 'Could not start the camera. Use the desk scanner or type the code.'
        );
        setCamOn(false);
      }
    })();

    return () => { cancelled = true; stopCamera(); };
  }, [open, camOn, stopCamera, submit]);

  /* ── Reset on open/close. The camera must be released either way, or the
        indicator light stays on after the dialog is gone. ─────────────────── */

  useEffect(() => {
    if (open) {
      setTyped('');
      setPhase({ s: 'waiting' });
      setCamError(null);
      const t = setTimeout(() => { try { inputRef.current?.focus(); } catch { /* noop */ } }, 60);
      return () => clearTimeout(t);
    }
    setCamOn(false);
    stopCamera();
    if (idleRef.current) { clearTimeout(idleRef.current); idleRef.current = null; }
    return undefined;
  }, [open, stopCamera]);

  useEffect(() => () => { stopCamera(); if (idleRef.current) clearTimeout(idleRef.current); }, [stopCamera]);

  /* ── The wedge path ─────────────────────────────────────────────────────── */

  const onChange = (value: string) => {
    setTyped(value);
    const now = Date.now();
    if (!firstKeyRef.current || !value) firstKeyRef.current = now;
    if (idleRef.current) { clearTimeout(idleRef.current); idleRef.current = null; }
    if (!value) return;
    const elapsed = now - firstKeyRef.current;
    // A scanner delivers a whole code in a few tens of milliseconds. A person
    // cannot. Only the machine-speed case auto-submits, so typing a code by hand
    // is never cut off half-way through.
    const machineSpeed = value.length >= 6 && elapsed < value.length * 25;
    if (machineSpeed) {
      idleRef.current = setTimeout(() => submit(value), 220);
    }
  };

  /* ── Rendering ──────────────────────────────────────────────────────────── */

  const resultCard = (apt: any) => {
    const cancelled = CANCELLED.has(String(apt?.status ?? '').toLowerCase());
    const arrived = String(apt?.checkInStatus ?? '') === 'arrived' || String(apt?.status ?? '') === 'servicing';
    const provider = staffOf(apt);
    const code = String(apt?.shortCode ?? '').toUpperCase();
    return (
      <div className={`rounded-[1.5rem] border-2 p-4 sm:p-5 ${cancelled ? 'border-amber-300 bg-amber-50' : 'border-foreground bg-background'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-black uppercase tracking-[0.28em] text-muted-foreground">Match found</p>
            {/* Wrapping, not truncating: the desk needs the whole name and the whole
                service to be sure it has the right person, and the card can grow. */}
            <p className="mt-1 break-words text-xl font-black leading-tight tracking-tighter sm:text-2xl">{nameOf(apt)}</p>
            <p className="break-words text-sm font-semibold leading-snug text-muted-foreground">{serviceOf(apt)}</p>
          </div>
          <Badge variant={cancelled ? 'destructive' : arrived ? 'secondary' : 'default'} className="shrink-0 text-[9px] font-black uppercase tracking-[0.2em]">
            {titleCase(apt?.checkInStatus === 'arrived' ? 'checked in' : apt?.status) || 'Confirmed'}
          </Badge>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground">When</p>
            <p className="break-words text-sm font-bold">{whenLabel(apt?.startTime)}</p>
          </div>
          {provider ? (
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground">Provider</p>
              <p className="break-words text-sm font-bold">{provider}</p>
            </div>
          ) : null}
          {code ? (
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground">Code</p>
              <p className="break-all font-mono text-sm font-bold tracking-[0.14em]">{code}</p>
            </div>
          ) : null}
        </div>

        {cancelled ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl border-2 border-amber-300 bg-amber-100/60 p-3 text-xs font-semibold text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            This appointment is {titleCase(apt?.status).toLowerCase()}. Open it to see what happened before you seat anyone.
          </p>
        ) : null}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          {onCheckIn && !arrived && !cancelled ? (
            <Button
              className="h-12 min-h-[44px] flex-1 rounded-2xl text-xs font-black uppercase tracking-[0.16em]"
              onClick={() => { onCheckIn(apt); onOpenChange(false); }}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" /> Check in
            </Button>
          ) : null}
          {onPrintTicket ? (
            <Button
              variant="outline"
              className="h-12 min-h-[44px] flex-1 rounded-2xl border-2 text-xs font-black uppercase tracking-[0.16em]"
              onClick={() => onPrintTicket(apt)}
            >
              <Printer className="mr-2 h-4 w-4" /> Print ticket
            </Button>
          ) : null}
          {onSelect ? (
            <Button
              variant="outline"
              className="h-12 min-h-[44px] flex-1 rounded-2xl border-2 text-xs font-black uppercase tracking-[0.16em]"
              onClick={() => { onSelect(apt); onOpenChange(false); }}
            >
              Open <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto rounded-[1.75rem] border-2 p-5 sm:p-6">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="flex items-center gap-2 text-xl font-black uppercase tracking-tighter sm:text-2xl">
            <ScanLine className="h-5 w-5" /> Scan check-in
          </DialogTitle>
          <DialogDescription className="text-xs font-medium">
            Scan the ticket, or type the confirmation code. Works with a USB desk scanner out of the box.
          </DialogDescription>
        </DialogHeader>

        <form
          className="mt-1 space-y-2"
          onSubmit={(e) => { e.preventDefault(); submit(typed); }}
        >
          <label htmlFor="scan-code-input" className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-muted-foreground">
            <Keyboard className="h-3.5 w-3.5" /> Scan or type
          </label>
          <div className="flex gap-2">
            <Input
              id="scan-code-input"
              ref={inputRef}
              value={typed}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
              placeholder="K7QM4P2X"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="h-12 min-h-[44px] flex-1 rounded-2xl border-2 font-mono text-base tracking-[0.14em]"
            />
            <Button type="submit" className="h-12 min-h-[44px] shrink-0 rounded-2xl px-4" aria-label="Look up code">
              <Search className="h-4 w-4" />
            </Button>
          </div>
        </form>

        {canUseCamera ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setCamOn((v) => !v)}
            className="h-12 min-h-[44px] w-full rounded-2xl border-2 text-xs font-black uppercase tracking-[0.16em]"
          >
            {camOn
              ? <><CameraOff className="mr-2 h-4 w-4" /> Stop camera</>
              : <><Camera className="mr-2 h-4 w-4" /> Use camera</>}
          </Button>
        ) : (
          <p className="rounded-2xl border-2 border-dashed p-3 text-xs font-medium text-muted-foreground">
            This browser can&apos;t read a QR from the camera. Use a USB desk scanner, or type the code — both work here.
          </p>
        )}

        {camError ? (
          <p className="flex items-start gap-2 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {camError}
          </p>
        ) : null}

        {camOn ? (
          <div className="relative overflow-hidden rounded-[1.5rem] border-2 bg-black">
            {/* playsInline keeps iOS from taking the video full-screen. */}
            <video ref={videoRef} playsInline muted autoPlay className="block h-48 w-full object-cover sm:h-56" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-32 w-32 rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
            <p className="absolute bottom-2 left-0 right-0 text-center text-[9px] font-black uppercase tracking-[0.24em] text-white/90">
              Hold the guest&apos;s QR in the box
            </p>
          </div>
        ) : null}

        <div aria-live="polite" className="space-y-3">
          {phase.s === 'waiting' ? (
            <p className="rounded-2xl border-2 border-dashed p-4 text-center text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Waiting for a scan
            </p>
          ) : null}

          {phase.s === 'looking' ? (
            <p className="flex items-center justify-center gap-2 rounded-2xl border-2 p-4 text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Looking up {phase.raw}
            </p>
          ) : null}

          {phase.s === 'found' ? resultCard(phase.appointment) : null}

          {phase.s === 'choose' ? (
            <div className="space-y-2">
              <p className="flex items-start gap-2 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {phase.matches.length} appointments share that code. Pick the right one — checking in the wrong client is worse than asking.
              </p>
              {phase.matches.map((apt: any, i: number) => (
                <button
                  key={apt?.id || i}
                  type="button"
                  onClick={() => setPhase({ s: 'found', appointment: apt, raw: phase.raw })}
                  className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-2xl border-2 p-3 text-left transition-colors hover:bg-muted"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-black tracking-tight">{nameOf(apt)}</span>
                    <span className="block break-words text-xs font-medium text-muted-foreground">
                      {serviceOf(apt)} · {whenLabel(apt?.startTime)}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          ) : null}

          {phase.s === 'miss' ? (
            <div className="rounded-[1.5rem] border-2 border-dashed p-4">
              <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-muted-foreground">
                <X className="h-3.5 w-3.5" /> No match
              </p>
              <p className="mt-2 text-sm font-semibold">{phase.reason}</p>
              {phase.raw ? (
                <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">Scanned: {phase.raw}</p>
              ) : null}
              <Button
                variant="outline"
                className="mt-3 h-11 min-h-[44px] w-full rounded-2xl border-2 text-xs font-black uppercase tracking-[0.16em]"
                onClick={() => { setTyped(''); setPhase({ s: 'waiting' }); try { inputRef.current?.focus(); } catch { /* noop */ } }}
              >
                Try another code
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ScanCheckInDialog;
