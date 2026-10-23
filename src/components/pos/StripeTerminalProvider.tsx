'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { settleReader } from '@/lib/reader-settle';

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
  | 'cancelled'
  | 'unconfirmed';   // the card may have been charged, but the answer didn't arrive: check before charging again

/** What a reader payment came to. `unknown`: the card may have been charged but we couldn't confirm it (the connection
 *  dropped); check again with confirmPayment, or call it off with releasePayment, before taking another payment.
 *  `already`: an earlier payment for the same sale had gone through, so nothing new was charged. */
export type CollectResult = { ok: boolean; paymentIntentId?: string; error?: string; deposit?: any; captured?: boolean; unknown?: boolean; already?: boolean; code?: string; amountCents?: number; charged?: boolean;
  /** For a sale: how the server marked it on its ticket ('waiting' to be saved, 'recorded', or 'paid_twice': the ticket
   *  was already paid, so this payment is kept apart for a manager and must not be used to save the sale). */
  sale?: string;
  /** The ticket was already paid another way: the payment it was paid with, and what the sale was rung up with then
   *  (the desk saves the sale as it was paid). */
  paidWith?: any;
  paidPayload?: any;
  refunded?: boolean };

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
  /** `deposit`: for a booking's deposit, how the server recorded it when the payment was captured (lib/reader-deposit). */
  collectPayment:    (params: CollectParams) => Promise<CollectResult>;
  /** A new payment is about to start: the last one's status is cleared at once, so it can't show (or act) meanwhile. */
  beginPayment:      () => void;
  cancelPayment:     () => Promise<void>;
  /** Ask again about a payment we couldn't confirm: it's captured if the reader approved it, never twice. */
  confirmPayment:    (p: { tenantId: string; paymentIntentId: string; clientId?: string; saveCard?: boolean }) => Promise<CollectResult>;
  /** Call off a payment we couldn't confirm, so it can't complete later. `charged`: it had already gone through. */
  releasePayment:    (p: { tenantId: string; paymentIntentId: string }) => Promise<CollectResult & { released?: boolean }>;
};

type CollectParams = {
  tenantId:     string;
  clientId?:    string;
  amountCents:  number;
  description?: string;
  saveCard?:    boolean;
  /** A booking's deposit taken on the reader: the payment carries the booking, so only it can be recorded with it. */
  appointmentId?: string;
  /** 'sale': a sale at the desk, carrying its started ticket (pendingId), so it's accounted for whatever happens. */
  kind?:        'deposit' | 'sale';
  pendingId?:   string;
  /** The last reader payment for this sale: checked first, so a card is never charged twice. */
  previousPaymentIntentId?: string;
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settleOnServer = (body: any, tries = 4) => settleReader((b) => post('/api/stripe/terminal/capture-payment-intent', b), body, tries);

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
  const customerIdRef         = useRef<string | null>(null);   // the card-saving customer, for asking again about a capture
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

  const collectPayment = useCallback(async (params: CollectParams): Promise<CollectResult> => {
    if (!terminalRef.current || (readerStatus !== 'connected' && readerStatus !== 'busy')) {
      return { ok: false, error: 'No reader connected' };
    }

    setPaymentStatus('creating');
    setPaymentError(null);
    setReaderStatus('busy');
    // The payment's id once it exists: it goes back with any failure after that, so a payment whose answer was lost
    // (the connection dropped as it was captured) can still be checked and recorded by it.
    let piId: string | undefined;
    const unconfirmed = (msg?: string): CollectResult => {
      setPaymentStatus('unconfirmed');
      setPaymentError(msg || 'We couldn’t confirm the payment. Don’t charge the card again yet.');
      return { ok: false, unknown: true, paymentIntentId: piId, error: msg || 'We couldn’t confirm the payment.' };
    };
    const captureBody = () => ({ tenantId: params.tenantId, clientId: params.clientId, paymentIntentId: piId, customerId: customerIdRef.current, saveCard: params.saveCard });
    const succeeded = (data: any): CollectResult => {
      setPaymentStatus('succeeded');
      activePaymentRef.current = null;
      return { ok: true, paymentIntentId: piId, deposit: data?.deposit || null, captured: true, already: !!data?.already, amountCents: data?.amountCents, sale: data?.sale };
    };

    try {
      // 1. Create PaymentIntent on server (a sale checks first for an earlier payment of its own that went through)
      let piRes: Response;
      try { piRes = await post('/api/stripe/terminal/create-payment-intent', params); }
      catch { setPaymentStatus('failed'); setPaymentError('Couldn’t reach payments. Check the internet connection. Nothing was charged.'); return { ok: false, error: 'Couldn’t reach payments. Nothing was charged.' }; }
      const piData = await piRes.json().catch(() => ({}));
      piId = piData.paymentIntentId || undefined;
      customerIdRef.current = piData.customerId || null;
      if (piData.code === 'sale_paid' && piId) {
        setPaymentStatus('succeeded');
        return { ok: true, paymentIntentId: piId, captured: true, already: true, amountCents: piData.amountCents };
      }
      if ((piData.code === 'reader_processing' || piData.code === 'reader_unknown') && piId) return unconfirmed(piData.error);
      if (!piData.clientSecret) {
        setPaymentStatus('failed');
        setPaymentError(piData.error || 'Failed to create payment');
        return { ok: false, error: piData.error, code: piData.code, paymentIntentId: piData.code === 'sale_paid_other_amount' ? piId : undefined, amountCents: piData.amountCents, paidWith: piData.paidWith, paidPayload: piData.paidPayload };
      }

      // 2. Collect payment method on reader
      setPaymentStatus('waiting_for_card');
      const collectResult = await terminalRef.current.collectPaymentMethod(piData.clientSecret);
      activePaymentRef.current = collectResult.paymentIntent;

      if (collectResult.error) {
        setPaymentStatus('failed');
        setPaymentError(collectResult.error.message);
        return { ok: false, error: collectResult.error.message, paymentIntentId: piId, captured: false };
      }

      // 3. Process payment
      setPaymentStatus('processing');
      const processResult = await terminalRef.current.processPayment(collectResult.paymentIntent);

      if (processResult.error) {
        // The reader may have approved the card even so (its answer can be lost too): the server says for sure, and
        // captures it if it was approved.
        const check = await settleOnServer(captureBody(), 2);
        if (check.data?.ok) return succeeded(check.data);
        if (!check.reached) return unconfirmed();
        setPaymentStatus('failed');
        setPaymentError(processResult.error.message);
        return { ok: false, error: processResult.error.message, paymentIntentId: piId, captured: false };
      }

      // 4. Capture on server, asking again if the answer is lost
      setPaymentStatus('capturing');
      const done = await settleOnServer(captureBody(), 4);
      if (done.data?.ok) return succeeded(done.data);
      if (!done.reached) return unconfirmed();
      setPaymentStatus('failed');
      setPaymentError(done.data?.error || 'Capture failed');
      return { ok: false, error: done.data?.error || 'We couldn’t confirm the payment.', paymentIntentId: piId, captured: false, charged: false };

    } catch (err: any) {
      // Something failed on this device after the payment existed: the server says whether the card was charged.
      if (piId) {
        const check = await settleOnServer(captureBody(), 2);
        if (check.data?.ok) return succeeded(check.data);
        if (!check.reached) return unconfirmed();
      }
      setPaymentStatus('failed');
      setPaymentError(err.message);
      return { ok: false, error: err.message, paymentIntentId: piId, captured: false };
    } finally {
      setReaderStatus((s) => (s === 'busy' ? 'connected' : s));
    }
  }, [readerStatus]);

  const confirmPayment = useCallback(async (p: { tenantId: string; paymentIntentId: string; clientId?: string; saveCard?: boolean }): Promise<CollectResult> => {
    setPaymentStatus('capturing'); setPaymentError(null);
    const done = await settleOnServer({ tenantId: p.tenantId, clientId: p.clientId, paymentIntentId: p.paymentIntentId, customerId: customerIdRef.current, saveCard: p.saveCard }, 3);
    if (done.data?.ok) { setPaymentStatus('succeeded'); activePaymentRef.current = null; return { ok: true, paymentIntentId: p.paymentIntentId, captured: true, deposit: done.data.deposit || null, already: !!done.data.already, amountCents: done.data.amountCents, sale: done.data.sale }; }
    if (!done.reached) { setPaymentStatus('unconfirmed'); setPaymentError('We still couldn’t confirm it. Don’t charge the card again yet.'); return { ok: false, unknown: true, paymentIntentId: p.paymentIntentId, error: 'We still couldn’t confirm the payment.' }; }
    setPaymentStatus('failed'); setPaymentError(done.data?.error || 'The card wasn’t charged.');
    return { ok: false, paymentIntentId: p.paymentIntentId, error: done.data?.error || 'The card wasn’t charged.', charged: false, refunded: !!done.data?.refunded };
  }, []);

  const releasePayment = useCallback(async (p: { tenantId: string; paymentIntentId: string }): Promise<CollectResult & { released?: boolean }> => {
    for (let i = 0; i < 3; i++) {
      if (i) await wait(800 * i);
      try {
        const res = await post('/api/stripe/terminal/cancel-payment-intent', p);
        const data = await res.json().catch(() => null);
        if (!data || res.status >= 500) continue;
        if (data.ok) { setPaymentStatus('cancelled'); setPaymentError(null); activePaymentRef.current = null; return { ok: true, released: true, paymentIntentId: p.paymentIntentId }; }
        if (data.refunded) { setPaymentStatus('cancelled'); setPaymentError(null); activePaymentRef.current = null; return { ok: true, released: true, refunded: true, paymentIntentId: p.paymentIntentId, error: data.error }; }
        if (data.charged) { setPaymentStatus('succeeded'); activePaymentRef.current = null; return { ok: false, charged: true, captured: true, paymentIntentId: p.paymentIntentId, amountCents: data.amountCents, sale: data.sale || undefined }; }
        if (res.status === 202) return { ok: false, unknown: true, paymentIntentId: p.paymentIntentId, error: data.error || 'The card payment is still being processed.' };
        return { ok: false, paymentIntentId: p.paymentIntentId, error: data.error || 'The payment couldn’t be cancelled.' };
      } catch { /* ask again */ }
    }
    return { ok: false, unknown: true, paymentIntentId: p.paymentIntentId, error: 'Couldn’t reach payments to cancel it. Check the internet connection.' };
  }, []);

  const beginPayment = useCallback(() => { setPaymentStatus('creating'); setPaymentError(null); }, []);

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
      beginPayment,
      cancelPayment,
      confirmPayment,
      releasePayment,
    }}>
      {children}
    </TerminalContext.Provider>
  );
}