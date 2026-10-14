'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { staffAuthHeader } from '@/lib/staff-fetch';

// Every reader call goes to a staff-only route, so each one carries the signed-in person's proof.
async function post(url: string, body: any) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify(body) });
}

// ─── Types ────────────────────────────────────────────────────────────────────
export type ReaderStatus = 'not_connected' | 'connecting' | 'connected' | 'busy' | 'error';

export type TerminalReader = {
  id:           string;
  label:        string;
  status:       string;
  deviceType:   string;
  ipAddress?:   string;
  serialNumber: string;
};

export type PaymentStatus =
  | 'idle'
  | 'creating'
  | 'waiting_for_card'
  | 'processing'
  | 'capturing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

type TerminalContextValue = {
  isLoaded:          boolean;
  setupError:        string | null;
  isDiscovering:     boolean;
  readerStatus:      ReaderStatus;
  connectedReader:   TerminalReader | null;
  discoveredReaders: TerminalReader[];
  paymentStatus:     PaymentStatus;
  paymentError:      string | null;
  discoverReaders:   () => Promise<TerminalReader[]>;
  connectReader:     (reader: TerminalReader, quiet?: boolean) => Promise<boolean>;
  disconnectReader:  () => Promise<void>;
  collectPayment:    (params: CollectParams) => Promise<{ ok: boolean; paymentIntentId?: string; error?: string }>;
  cancelPayment:     () => Promise<void>;
};

type CollectParams = {
  tenantId:     string;
  clientId?:    string;
  amountCents:  number;
  description?: string;
  saveCard?:    boolean;
};

// ─── Context ──────────────────────────────────────────────────────────────────
const TerminalContext = createContext<TerminalContextValue | null>(null);

/** The reader, or null where no provider is mounted (screens that work without one). */
export function useTerminalOptional() { return useContext(TerminalContext); }

export function useTerminal() {
  const ctx = useContext(TerminalContext);
  if (!ctx) throw new Error('useTerminal must be used inside StripeTerminalProvider');
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export function StripeTerminalProvider({
  tenantId,
  children,
}: {
  tenantId: string;
  children: React.ReactNode;
}) {
  const { toast } = useToast();
  const terminalRef           = useRef<any>(null);
  const [isLoaded,            setIsLoaded]            = useState(false);
  const [readerStatus,        setReaderStatus]        = useState<ReaderStatus>('not_connected');
  const [connectedReader,     setConnectedReader]     = useState<TerminalReader | null>(null);
  const [discoveredReaders,   setDiscoveredReaders]   = useState<TerminalReader[]>([]);
  const [paymentStatus,       setPaymentStatus]       = useState<PaymentStatus>('idle');
  const [paymentError,        setPaymentError]        = useState<string | null>(null);
  const activePaymentRef      = useRef<any>(null);
  const rawReaders            = useRef<Map<string, any>>(new Map());   // the SDK needs its own reader objects back
  const [setupError,          setSetupError]          = useState<string | null>(null);
  const [isDiscovering,       setIsDiscovering]       = useState(false);

  // Load Stripe Terminal JS SDK dynamically
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if ((window as any).StripeTerminal) { initTerminal(); return; }

    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/terminal/v1/';
    script.onload = () => initTerminal();
    script.onerror = () => setSetupError('The card reader service didn’t load. Check the internet connection and reload the page.');
    document.head.appendChild(script);
  }, [tenantId]);

  const initTerminal = useCallback(() => {
    const StripeTerminal = (window as any).StripeTerminal;
    if (!StripeTerminal) return;

    terminalRef.current = StripeTerminal.create({
      onFetchConnectionToken: async () => {
        const res = await post('/api/stripe/terminal/connection-token', { tenantId });
        const data = await res.json().catch(() => ({}));
        if (!data.secret) { const msg = data.error || 'The card reader couldn’t sign in to payments.'; setSetupError(msg); throw new Error(msg); }
        setSetupError(null);
        return data.secret;
      },
      onUnexpectedReaderDisconnect: () => {
        setReaderStatus('error');
        setConnectedReader(null);
        toast({ variant: 'destructive', title: 'The card reader disconnected', description: 'Check it’s on and charged, then connect it again.' });
      },
    });

    setIsLoaded(true);
  }, [tenantId, toast]);

  const discoverReaders = useCallback(async (): Promise<TerminalReader[]> => {
    if (!terminalRef.current) return [];
    setDiscoveredReaders([]); setIsDiscovering(true);
    try {
      const result = await terminalRef.current.discoverReaders({ simulated: process.env.NODE_ENV === 'development' });
      if (result.error) { setSetupError((cur) => cur || result.error.message); return []; }
      rawReaders.current = new Map((result.discoveredReaders || []).map((r: any) => [r.id, r]));
      const readers: TerminalReader[] = (result.discoveredReaders || []).map((r: any) => ({
        id: r.id, label: r.label || r.device_type, status: r.status, deviceType: r.device_type, ipAddress: r.ip_address, serialNumber: r.serial_number,
      }));
      setDiscoveredReaders(readers);
      return readers;
    } catch (err: any) { setSetupError((cur) => cur || err?.message || 'Couldn’t look for readers.'); return []; }
    finally { setIsDiscovering(false); }
  }, []);

  const connectReader = useCallback(async (reader: TerminalReader, quiet = false): Promise<boolean> => {
    if (!terminalRef.current) return false;
    const raw = rawReaders.current.get(reader.id);
    if (!raw) { if (!quiet) toast({ variant: 'destructive', title: 'Look for readers first', description: 'That reader wasn’t found on this network just now.' }); return false; }
    setReaderStatus('connecting');
    const result = await terminalRef.current.connectReader(raw, { fail_if_in_use: true });
    if (result.error) {
      setReaderStatus('error');
      if (!quiet) toast({ variant: 'destructive', title: 'Couldn’t connect', description: result.error.message });
      return false;
    }
    setConnectedReader(reader);
    setReaderStatus('connected');
    try { localStorage.setItem(`terminal_reader_${tenantId}`, JSON.stringify({ id: reader.id, label: reader.label })); } catch {}
    if (!quiet) toast({ title: `${reader.label} is ready` });
    return true;
  }, [tenantId, toast]);

  const disconnectReader = useCallback(async () => {
    if (!terminalRef.current) return;
    await terminalRef.current.disconnectReader();
    setConnectedReader(null);
    setReaderStatus('not_connected');
    try { localStorage.removeItem(`terminal_reader_${tenantId}`); } catch {}
  }, [tenantId]);

  // The reader this device used last reconnects by itself: look for it, then connect.
  useEffect(() => {
    if (!isLoaded) return;
    let saved: { id: string } | null = null;
    try { const v = localStorage.getItem(`terminal_reader_${tenantId}`); saved = v ? JSON.parse(v) : null; } catch {}
    if (!saved?.id) return;
    (async () => { const found = await discoverReaders(); const r = found.find((x) => x.id === saved!.id); if (r) await connectReader(r, true); })().catch(() => {});
  }, [isLoaded, tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const collectPayment = useCallback(async (params: CollectParams): Promise<{ ok: boolean; paymentIntentId?: string; error?: string }> => {
    if (!terminalRef.current || (readerStatus !== 'connected' && readerStatus !== 'busy')) {
      return { ok: false, error: 'No reader connected' };
    }

    setPaymentStatus('creating');
    setPaymentError(null);
    setReaderStatus('busy');

    try {
      // 1. Create PaymentIntent on server
      const piRes = await post('/api/stripe/terminal/create-payment-intent', params);
      const piData = await piRes.json();
      if (!piData.clientSecret) {
        setPaymentStatus('failed');
        setPaymentError(piData.error || 'Failed to create payment');
        return { ok: false, error: piData.error };
      }

      // 2. Collect payment method on reader
      setPaymentStatus('waiting_for_card');
      const collectResult = await terminalRef.current.collectPaymentMethod(piData.clientSecret);
      activePaymentRef.current = collectResult.paymentIntent;

      if (collectResult.error) {
        setPaymentStatus('failed');
        setPaymentError(collectResult.error.message);
        return { ok: false, error: collectResult.error.message };
      }

      // 3. Process payment
      setPaymentStatus('processing');
      const processResult = await terminalRef.current.processPayment(collectResult.paymentIntent);

      if (processResult.error) {
        setPaymentStatus('failed');
        setPaymentError(processResult.error.message);
        return { ok: false, error: processResult.error.message };
      }

      // 4. Capture on server
      setPaymentStatus('capturing');
      const captureRes = await post('/api/stripe/terminal/capture-payment-intent', {
        tenantId:        params.tenantId,
        clientId:        params.clientId,
        paymentIntentId: processResult.paymentIntent.id,
        customerId:      piData.customerId,
        saveCard:        params.saveCard,
      });
      const captureData = await captureRes.json();

      if (!captureData.ok) {
        setPaymentStatus('failed');
        setPaymentError(captureData.error || 'Capture failed');
        return { ok: false, error: captureData.error };
      }

      setPaymentStatus('succeeded');
      activePaymentRef.current = null;
      return { ok: true, paymentIntentId: processResult.paymentIntent.id };

    } catch (err: any) {
      setPaymentStatus('failed');
      setPaymentError(err.message);
      return { ok: false, error: err.message };
    } finally {
      setReaderStatus((s) => (s === 'busy' ? 'connected' : s));
    }
  }, [readerStatus]);

  const cancelPayment = useCallback(async () => {
    if (!terminalRef.current) return;
    try {
      await terminalRef.current.cancelCollectPaymentMethod();
    } catch {}
    setPaymentStatus('cancelled');
    activePaymentRef.current = null;
  }, []);

  return (
    <TerminalContext.Provider value={{
      isLoaded,
      setupError,
      isDiscovering,
      readerStatus,
      connectedReader,
      discoveredReaders,
      paymentStatus,
      paymentError,
      discoverReaders,
      connectReader,
      disconnectReader,
      collectPayment,
      cancelPayment,
    }}>
      {children}
    </TerminalContext.Provider>
  );
}