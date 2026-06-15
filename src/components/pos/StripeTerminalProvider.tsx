'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';

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
  readerStatus:      ReaderStatus;
  connectedReader:   TerminalReader | null;
  discoveredReaders: TerminalReader[];
  paymentStatus:     PaymentStatus;
  paymentError:      string | null;
  discoverReaders:   () => Promise<void>;
  connectReader:     (reader: TerminalReader) => Promise<boolean>;
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

  // Load Stripe Terminal JS SDK dynamically
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if ((window as any).StripeTerminal) { initTerminal(); return; }

    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/terminal/v1/';
    script.onload = () => initTerminal();
    script.onerror = () => console.error('[Terminal] Failed to load SDK');
    document.head.appendChild(script);
  }, [tenantId]);

  const initTerminal = useCallback(() => {
    const StripeTerminal = (window as any).StripeTerminal;
    if (!StripeTerminal) return;

    terminalRef.current = StripeTerminal.create({
      onFetchConnectionToken: async () => {
        const res = await fetch('/api/stripe/terminal/connection-token', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ tenantId }),
        });
        const data = await res.json();
        if (!data.secret) throw new Error('Could not fetch connection token');
        return data.secret;
      },
      onUnexpectedReaderDisconnect: () => {
        setReaderStatus('error');
        setConnectedReader(null);
        toast({ variant: 'destructive', title: 'Reader Disconnected', description: 'The card reader disconnected unexpectedly.' });
      },
    });

    setIsLoaded(true);
  }, [tenantId, toast]);

  const discoverReaders = useCallback(async () => {
    if (!terminalRef.current) return;
    setDiscoveredReaders([]);

    const result = await terminalRef.current.discoverReaders({
      simulated: process.env.NODE_ENV === 'development',
    });

    if (result.error) {
      toast({ variant: 'destructive', title: 'Discovery Failed', description: result.error.message });
      return;
    }

    const readers: TerminalReader[] = (result.discoveredReaders || []).map((r: any) => ({
      id:           r.id,
      label:        r.label || r.device_type,
      status:       r.status,
      deviceType:   r.device_type,
      ipAddress:    r.ip_address,
      serialNumber: r.serial_number,
    }));

    setDiscoveredReaders(readers);
  }, [toast]);

  const connectReader = useCallback(async (reader: TerminalReader): Promise<boolean> => {
    if (!terminalRef.current) return false;
    setReaderStatus('connecting');

    const result = await terminalRef.current.connectReader(
      // Pass the raw reader object back — the SDK needs its original shape
      { id: reader.id, object: 'terminal.reader', device_type: reader.deviceType, serial_number: reader.serialNumber, ip_address: reader.ipAddress, status: reader.status, label: reader.label },
      { fail_if_in_use: true }
    );

    if (result.error) {
      setReaderStatus('error');
      toast({ variant: 'destructive', title: 'Connection Failed', description: result.error.message });
      return false;
    }

    setConnectedReader(reader);
    setReaderStatus('connected');
    // Persist paired reader so it survives page reloads
    try { localStorage.setItem(`terminal_reader_${tenantId}`, JSON.stringify(reader)); } catch {}
    toast({ title: 'Reader Connected', description: `${reader.label} is ready.` });
    return true;
  }, [tenantId, toast]);

  const disconnectReader = useCallback(async () => {
    if (!terminalRef.current) return;
    await terminalRef.current.disconnectReader();
    setConnectedReader(null);
    setReaderStatus('not_connected');
    try { localStorage.removeItem(`terminal_reader_${tenantId}`); } catch {}
  }, [tenantId]);

  // Auto-reconnect persisted reader on load
  useEffect(() => {
    if (!isLoaded) return;
    try {
      const saved = localStorage.getItem(`terminal_reader_${tenantId}`);
      if (saved) {
        const reader = JSON.parse(saved) as TerminalReader;
        connectReader(reader).catch(() => {});
      }
    } catch {}
  }, [isLoaded, tenantId, connectReader]);

  const collectPayment = useCallback(async (params: CollectParams): Promise<{ ok: boolean; paymentIntentId?: string; error?: string }> => {
    if (!terminalRef.current || readerStatus !== 'connected') {
      return { ok: false, error: 'No reader connected' };
    }

    setPaymentStatus('creating');
    setPaymentError(null);

    try {
      // 1. Create PaymentIntent on server
      const piRes = await fetch('/api/stripe/terminal/create-payment-intent', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(params),
      });
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
      const captureRes = await fetch('/api/stripe/terminal/capture-payment-intent', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          tenantId:        params.tenantId,
          clientId:        params.clientId,
          paymentIntentId: processResult.paymentIntent.id,
          customerId:      piData.customerId,
          saveCard:        params.saveCard,
        }),
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