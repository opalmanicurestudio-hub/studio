'use client';

import {
  Car, Check, CheckCircle2, Clock, LifeBuoy, Loader, Package, PackageCheck,
  QrCode, ShoppingBag, Store, Truck, XCircle,
} from 'lucide-react';
import { Camera } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { customerOutcomeHeadline, fulfilmentSummary } from '@/lib/fulfilment-state';
import { clearCart } from '@/lib/shop-cart';
import { cn } from '@/lib/utils';
import { distanceMetres, roughEtaMinutes, CURBSIDE_GEOFENCE_M } from '@/lib/retail-orders';

// ─── /shop/[tenantId]/order/[orderId]/page.tsx ────────────────────────────────
// The customer's live order tracker — the success URL from Stripe Checkout
// lands here. Handles every stage and edge state:
//
//   placed     → "Confirming payment" (Stripe redirected before the webhook
//                landed — polls every 4s until 'paid' flips; never shows a
//                just-paid customer an unpaid order)
//   paid       → in queue, with live position
//   picking    → being picked
//   packed     → almost ready
//   ready      → BIG pickup QR + counter/curbside instructions
//   arrived    → "we're bringing it out" (curbside)
//   shipped    → tracking link when the label has one
//   handed_off / completed → receipt view
//   cancelled  → clear message + refund note
//
// Partial fulfillment is first-class: shorted/refunded lines are labeled and
// the refund total is shown. Curbside early arrival is supported — the
// "I'm here" card is available from the moment payment confirms.
//
// NOTE: requires the `qrcode` package → add "qrcode": "^1.5.4" plus
// "@types/qrcode": "^1.5.5" in devDependencies to package.json.

interface StatusLine {
  lineId?: string; productId?: string; name: string; qtyOrdered: number; qtyShorted: number; qtyReturned?: number;
  unitPriceCents: number; status: string;
}
interface StatusOrder {
  id: string; orderNumber: number; stage: string; method: string; priceTier: string;
  pickupAt?: string; tipCents?: number;
  businessName: string; poNumber: string; customerName: string;
  lines: StatusLine[];
  subtotalCents: number; taxCents: number; shippingCents: number;
  refundedCents: number; totalCents: number;
  timestamps: Record<string, string | null>;
  curbside: { arrivedAt: string | null; spotOrVehicle: string; onWayAt?: string | null; etaMinutes?: number; bringingOutAt?: string | null; bringingOutBy?: string; bringingOutPhoto?: string | null } | null;
  shipCity: string | null; trackingNumber: string | null; trackingUrl: string | null; carrier: string | null;
}

const fmt = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const ACTIVE_POLL_MS = 4000;

export default function OrderStatusPage() {
  const params = useParams<{ tenantId: string; orderId: string }>();
  const tenantId = String(params?.tenantId || '');
  const orderId = String(params?.orderId || '');

  // Arriving here with a session_id means Stripe just took payment — the cart
  // those items came from is spent. Clearing it here (not before payment)
  // means a cancelled checkout keeps the cart, a paid one retires it, and the
  // customer never returns to a shop still "holding" what they already bought.
  useEffect(() => {
    if (!tenantId) return;
    if (new URLSearchParams(window.location.search).has('session_id')) {
      clearCart(tenantId);
    }
  }, [tenantId]);
  const { toast } = useToast();
  const router = useRouter();

  const [order, setOrder] = useState<StatusOrder | null>(null);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [lanePosition, setLanePosition] = useState<number | null>(null);
  const [curbside, setCurbside] = useState<{ mode: string; spots: string[] }>({ mode: 'freeform', spots: [] });
  const [hereEarly, setHereEarly] = useState(false);
  const [qrValue, setQrValue] = useState<string | null>(null);
  const [selfToken, setSelfToken] = useState<string | null>(null);
  const [shopGeo, setShopGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [helpMsg, setHelpMsg] = useState('');
  const [instantQ, setInstantQ] = useState<string | null>(null);
  const [helpSending, setHelpSending] = useState(false);
  const [helpSent, setHelpSent] = useState(false);
  const [supportThread, setSupportThread] = useState<{
    message: string; createdAt: string | null; status: string; autoReply: string;
    replies: { by: string; text: string; at: string | null }[];
    expectNote?: string;
    photoUrls?: string[];
    pending?: boolean;
  }[]>([]);
  const [helpPhotos, setHelpPhotos] = useState<string[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [onWayBusy, setOnWayBusy] = useState(false);
  const [bringToVehicle, setBringToVehicle] = useState(false);
  const [accessNote, setAccessNote] = useState('');
  const [geoWatching, setGeoWatching] = useState(false);
  const geoIdRef = React.useRef<number | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [retQty, setRetQty] = useState<Record<string, number>>({});
  const [retReason, setRetReason] = useState<Record<string, string>>({});
  const [retResolution, setRetResolution] = useState<'refund' | 'store_credit'>('refund');
  const [retNotes, setRetNotes] = useState('');
  const [retSending, setRetSending] = useState(false);
  const [retDone, setRetDone] = useState(false);
  const [retLabel, setRetLabel] = useState<{ url: string; deductCents: number; carrier: string } | null>(null);
  const [revLine, setRevLine] = useState<string | null>(null);
  const [revRating, setRevRating] = useState(5);
  const [revTitle, setRevTitle] = useState('');
  const [revBody, setRevBody] = useState('');
  const [revSending, setRevSending] = useState(false);
  const [revDone, setRevDone] = useState<Record<string, boolean>>({});
  const [fixOpen, setFixOpen] = useState(false);
  const [fixAddr, setFixAddr] = useState({ name: '', line1: '', line2: '', city: '', state: '', postalCode: '' });
  const [fixSending, setFixSending] = useState(false);
  const [rcptSending, setRcptSending] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimType, setClaimType] = useState('missing');
  const [claimLine, setClaimLine] = useState('');
  const [claimQty, setClaimQty] = useState(1);
  const [claimNote, setClaimNote] = useState('');
  const [photoBusyFor, setPhotoBusyFor] = useState<string | null>(null);
  const [infoAnswer, setInfoAnswer] = useState<Record<string, string>>({});
  const [aiThread, setAiThread] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiDown, setAiDown] = useState(false);
  const [infoBusy, setInfoBusy] = useState<string | null>(null);
  const [claimComponent, setClaimComponent] = useState('');
  const [kitPieces, setKitPieces] = useState<string[]>([]);
  const [pieceOther, setPieceOther] = useState(false);
  const [claimSending, setClaimSending] = useState(false);
  const [claimDone, setClaimDone] = useState('');
  const [myClaims, setMyClaims] = useState<{ id: string; type: string; qty: number; lineName: string | null; status: string; resolution: string | null; resolutionCents: number | null; declineReason: string | null; appealedAt: string | null; photoUrls?: string[]; infoRequestText?: string | null; infoResponseText?: string | null }[]>([]);
  const [appealFor, setAppealFor] = useState<string | null>(null);
  const [appealNote, setAppealNote] = useState('');
  const [appealSending, setAppealSending] = useState(false);
  const activeRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/retail/order-status?tenantId=${tenantId}&orderId=${orderId}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Order not found');
      setOrder(data.order);
      if (Array.isArray(data.support)) setSupportThread(data.support);
      setShopGeo(data.shopGeo || null);
      // Remember this order on THIS phone, so scanning a spot sign in the car
      // park can check the right person in without typing. Stored locally and
      // never sent anywhere except back to their own order — the sign itself
      // knows only a bay number, which is what keeps it safe to hang outside.
      try {
        const tok = data.selfServeToken || (data.qrValue ? String(data.qrValue).split('order/')[1] : null);
        if (tok && data.order?.method === 'curbside') {
          window.localStorage.setItem(
            `clarityflow-last-order-${tenantId}`,
            JSON.stringify({ orderId, token: tok, at: Date.now() }),
          );
        }
      } catch { /* private browsing — the manual button still works */ }
      setQueuePosition(data.queuePosition);
      setLanePosition(data.lanePosition ?? null);
      if (data.curbsideExperience) setCurbside(data.curbsideExperience);
      setQrValue(data.qrValue);
      setSelfToken(data.selfServeToken || (data.qrValue ? String(data.qrValue).split('order/')[1] : null));
      activeRef.current = data.active;
      setLoadError('');
    } catch (e: any) {
      if (!order) setLoadError(e?.message || 'Could not load this order');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, orderId]);

  // Poll while active; pause when the tab is hidden.
  useEffect(() => {
    if (!tenantId || !orderId) return;
    load();
    const t = setInterval(() => {
      if (activeRef.current && document.visibilityState === 'visible') load();
    }, ACTIVE_POLL_MS);
    return () => clearInterval(t);
  }, [tenantId, orderId, load]);

  // Render the QR whenever the value changes.
  useEffect(() => {
    if (!qrValue) { setQrDataUrl(null); return; }
    QRCode.toDataURL(qrValue, { width: 480, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [qrValue]);

  const checkIn = async () => {
    if (!order || !selfToken || checkingIn) return;
    setCheckingIn(true);
    try {
      const qrToken = selfToken;
      const res = await fetch('/api/retail/arrive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, orderId, qrToken, spotOrVehicle: vehicle.trim(), bringToVehicle, accessNote: accessNote.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Check-in failed');
      toast({
        title: data.early ? "We know you're here" : 'Checked in',
        description: data.early
          ? 'Your order is still being prepared — we will bring it right out when it is ready.'
          : 'Someone is on the way out with your order.',
      });
      load();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Check-in problem', description: e?.message });
    } finally {
      setCheckingIn(false);
    }
  };

  /**
   * "On my way" — the head start. Location is OPTIONAL and one-time: if they
   * allow it we turn a straight-line distance into a rough ETA so the shop
   * can time the bag; if they refuse (or the browser has no idea) we send the
   * heads-up anyway with no ETA. The feature must never depend on a
   * permission prompt going the way we hoped.
   */
  const sendOnWay = async () => {
    if (!order || !selfToken || onWayBusy) return;
    setOnWayBusy(true);
    const post = async (etaMinutes?: number) => {
      const res = await fetch('/api/retail/arrive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, orderId, qrToken: selfToken, onWay: true, bringToVehicle, accessNote: accessNote.trim(), ...(etaMinutes ? { etaMinutes } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send that');
      toast({
        title: 'Thanks — we know you’re coming',
        description: etaMinutes
          ? `We’ll have it ready in about ${etaMinutes} minutes.`
          : 'We’ll have it ready and watch for you.',
      });
      load();
    };
    try {
      const geo = (order as any).shopGeo || shopGeo;
      if (geo && typeof navigator !== 'undefined' && navigator.geolocation) {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            async (pos) => {
              try {
                const m = distanceMetres({ lat: pos.coords.latitude, lng: pos.coords.longitude }, geo);
                await post(roughEtaMinutes(m));
              } catch { /* surfaced below */ }
              resolve();
            },
            async () => { try { await post(); } catch { /* surfaced below */ } resolve(); },
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
          );
        });
      } else {
        await post();
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not send that', description: e?.message });
    } finally {
      setOnWayBusy(false);
    }
  };

  /**
   * The geofence, and its honest limits.
   *
   * This can only work while this page is OPEN — a browser cannot watch a
   * position in the background, so a phone in a pocket on a locked screen
   * will not check anyone in. That is a platform fact, not a setting. So the
   * watch starts only after they say they're on the way, stops the moment it
   * fires, and the "I'm here" button never goes away: the geofence is a
   * convenience laid on top of a manual action that always works.
   */
  useEffect(() => {
    const canWatch = !!order && !!selfToken && !!shopGeo
      && order.method === 'curbside'
      && !!(order as any).curbside?.onWayAt
      && !(order as any).curbside?.arrivedAt
      && typeof navigator !== 'undefined' && !!navigator.geolocation;
    if (!canWatch) return;
    setGeoWatching(true);
    const id = navigator.geolocation.watchPosition(
      async (pos) => {
        const m = distanceMetres({ lat: pos.coords.latitude, lng: pos.coords.longitude }, shopGeo as any);
        if (m > CURBSIDE_GEOFENCE_M) return;
        if (geoIdRef.current !== null) { navigator.geolocation.clearWatch(geoIdRef.current); geoIdRef.current = null; }
        setGeoWatching(false);
        try {
          await fetch('/api/retail/arrive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId, orderId, qrToken: selfToken, source: 'geo_auto', distanceM: m, spotOrVehicle: vehicle.trim() }),
          });
          toast({ title: 'We can see you’re here', description: 'Someone is heading out. Add your spot below if you can.' });
          load();
        } catch { /* the manual button is still there */ }
      },
      () => { setGeoWatching(false); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
    geoIdRef.current = id;
    return () => {
      if (geoIdRef.current !== null) navigator.geolocation.clearWatch(geoIdRef.current);
      geoIdRef.current = null;
      setGeoWatching(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.method, (order as any)?.curbside?.onWayAt, (order as any)?.curbside?.arrivedAt, selfToken, shopGeo]);

  const openAccount = async () => {
    if (!selfToken) return;
    try {
      const qrToken = selfToken;
      const res = await fetch('/api/retail/account/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, orderId, qrToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not open your account');
      router.push(`/shop/${tenantId}/account?e=${encodeURIComponent(data.email)}&x=${data.exp}&s=${data.sig}`);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not open your orders', description: e?.message });
    }
  };

  const selfServe = async (payload: any) => {
    const res = await fetch('/api/retail/self-serve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId, orderId, qrToken: selfToken || '', ...payload,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  };

  const submitAddressFix = async () => {
    if (!selfToken || fixSending) return;
    setFixSending(true);
    try {
      const data = await selfServe({ action: 'update_address', address: fixAddr });
      toast({ title: 'Address updated', description: data.message });
      setFixOpen(false);
      load();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not update the address', description: e?.message || 'Try again.' });
    } finally {
      setFixSending(false);
    }
  };

  const loadClaims = React.useCallback(async () => {
    if (!selfToken || !order || !['shipped', 'handed_off', 'completed'].includes(order.stage)) return;
    try {
      const res = await fetch(`/api/retail/claims?tenantId=${encodeURIComponent(tenantId)}&orderId=${encodeURIComponent(orderId)}&t=${encodeURIComponent(selfToken)}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.claims)) setMyClaims(data.claims);
    } catch {
      setMyClaims((c) => c);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfToken, order?.stage, tenantId, orderId]);

  useEffect(() => { loadClaims(); }, [loadClaims]);

  useEffect(() => {
    setKitPieces([]);
    setPieceOther(false);
    setClaimComponent('');
    if (!selfToken || !claimLine || claimType === 'not_received') return;
    let live = true;
    fetch(`/api/retail/claims?tenantId=${encodeURIComponent(tenantId)}&orderId=${encodeURIComponent(orderId)}&t=${encodeURIComponent(selfToken)}&contents=${encodeURIComponent(claimLine)}`)
      .then((r) => r.json())
      .then((data) => { if (live && Array.isArray(data.pieces)) setKitPieces(data.pieces); })
      .catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimLine, claimType, selfToken, tenantId, orderId]);

  const askAi = async () => {
    const q = aiInput.trim();
    if (!q || aiBusy || !selfToken) return;
    const nextThread: { role: 'user' | 'assistant'; content: string }[] = [...aiThread, { role: 'user', content: q }];
    setAiThread(nextThread);
    setAiInput('');
    setAiBusy(true);
    try {
      const res = await fetch('/api/retail/ai-support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, orderId, qrToken: selfToken, messages: nextThread }),
      });
      const data = await res.json();
      if (res.status === 503) {
        setAiDown(true);
        setAiThread(aiThread);
      } else if (!res.ok) {
        setAiThread([...nextThread, { role: 'assistant', content: data.error || 'That didn’t go through — try again, or use Report a problem below.' }]);
      } else {
        setAiThread([...nextThread, { role: 'assistant', content: String(data.reply || '') }]);
      }
    } catch {
      setAiThread([...nextThread, { role: 'assistant', content: 'Connection hiccup — try again, or use Report a problem below.' }]);
    } finally {
      setAiBusy(false);
    }
  };

  const answerInfoRequest = async (claimId: string) => {
    const note = (infoAnswer[claimId] || '').trim();
    if (!selfToken || !note || infoBusy) return;
    setInfoBusy(claimId);
    try {
      const res = await fetch('/api/retail/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, orderId, qrToken: selfToken, action: 'respond_info', claimId, note }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: 'destructive', title: 'Not sent', description: data.error || 'Try again.' });
      } else {
        toast({ title: 'Answer sent', description: 'The shop has it — review continues.' });
        setInfoAnswer({ ...infoAnswer, [claimId]: '' });
        await loadClaims();
      }
    } catch {
      toast({ variant: 'destructive', title: 'Not sent', description: 'Check your connection and try again.' });
    } finally {
      setInfoBusy(null);
    }
  };

  const addClaimPhoto = async (claimId: string, file: File) => {
    if (!selfToken || photoBusyFor) return;
    setPhotoBusyFor(claimId);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const img = new Image();
        const fr = new FileReader();
        fr.onerror = () => reject(new Error('read'));
        fr.onload = () => {
          img.onload = () => {
            const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('canvas')); return; }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.82));
          };
          img.onerror = () => reject(new Error('img'));
          img.src = String(fr.result);
        };
        fr.readAsDataURL(file);
      });
      const res = await fetch('/api/retail/claim-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, orderId, qrToken: selfToken, claimId, image: dataUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: 'destructive', title: 'Photo not added', description: data.error || 'Try again.' });
      } else {
        toast({ title: 'Photo added', description: 'It’s attached to your report for review.' });
        await loadClaims();
      }
    } catch {
      toast({ variant: 'destructive', title: 'Photo not added', description: 'That photo couldn’t be read — try another.' });
    } finally {
      setPhotoBusyFor(null);
    }
  };

  const submitClaim = async () => {
    if (!selfToken || claimSending) return;
    if (claimType !== 'not_received' && !claimLine) {
      toast({ variant: 'destructive', title: 'Pick the affected item' });
      return;
    }
    setClaimSending(true);
    try {
      const res = await fetch('/api/retail/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId, orderId, qrToken: selfToken,
          type: claimType,
          lineId: claimType === 'not_received' ? '' : claimLine,
          qty: claimQty,
          description: claimNote.trim(),
          component: claimComponent.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send the report');
      setClaimDone(data.message || 'Reported — the shop will follow up.');
      setClaimOpen(false);
      loadClaims();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not send the report', description: e?.message || 'Try again.' });
    } finally {
      setClaimSending(false);
    }
  };

  const submitAppeal = async (claimId: string) => {
    if (!selfToken || appealSending || !appealNote.trim()) {
      if (!appealNote.trim()) toast({ variant: 'destructive', title: 'Tell the shop why', description: 'Your note is what a person reads first.' });
      return;
    }
    setAppealSending(true);
    try {
      const res = await fetch('/api/retail/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, orderId, qrToken: selfToken, action: 'appeal', claimId, note: appealNote.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send the appeal');
      toast({ title: 'Appeal received', description: data.message });
      setAppealFor(null);
      setAppealNote('');
      loadClaims();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not send the appeal', description: e?.message || 'Try again.' });
    } finally {
      setAppealSending(false);
    }
  };

  const resendReceipt = async () => {
    if (!selfToken || rcptSending) return;
    setRcptSending(true);
    try {
      const data = await selfServe({ action: 'resend_receipt' });
      toast({ title: 'Receipt re-sent', description: data.message });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not re-send the receipt', description: e?.message || 'Try again.' });
    } finally {
      setRcptSending(false);
    }
  };

  const cancelSelf = async () => {
    if (!selfToken || cancelBusy) return;
    const why = window.prompt('Cancel this order? Tell us why (optional):');
    if (why === null) return;
    setCancelBusy(true);
    try {
      const data = await selfServe({ action: 'cancel', reason: why.trim() });
      toast({ title: 'Order cancelled', description: data.message });
      load();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not cancel', description: e?.message });
    } finally {
      setCancelBusy(false);
    }
  };

  const submitReview = async (productId: string) => {
    if (!selfToken || revSending) return;
    setRevSending(true);
    try {
      const res = await fetch('/api/retail/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId, orderId, productId,
          qrToken: selfToken || '',
          rating: revRating, title: revTitle.trim(), body: revBody.trim(),
          name: order?.customerName || '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save your review');
      setRevDone({ ...revDone, [productId]: true });
      setRevLine(null); setRevTitle(''); setRevBody(''); setRevRating(5);
      toast({ title: 'Thank you', description: data.message });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not post that', description: e?.message });
    } finally {
      setRevSending(false);
    }
  };

  const submitReturn = async () => {
    if (!selfToken || retSending) return;
    const selections = Object.entries(retQty)
      .filter(([, q]) => q > 0)
      .map(([lineId, qty]) => ({ lineId, qty, reason: retReason[lineId] || 'other' }));
    if (selections.length === 0) {
      toast({ variant: 'destructive', title: 'Pick at least one item' });
      return;
    }
    setRetSending(true);
    try {
      const data = await selfServe({ action: 'start_return', selections, resolution: retResolution, notes: retNotes.trim() });
      setRetDone(true);
      toast({ title: 'Return started', description: data.message });
      /* THE LABEL, WITHOUT ASKING. For shipped orders the return starts with
       * a prepaid label in hand: the label route is policy-aware (shop pays /
       * deducted / by fault), emails the PDF itself, and Shippo bills it only
       * when the carrier first scans it — so generating eagerly costs nothing
       * if they change their mind. Pickup orders skip this entirely. */
      if (data.returnId && data.shipped && selfToken) {
        try {
          const lr = await fetch('/api/retail/return-label', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId, orderId, returnId: data.returnId, qrToken: selfToken }),
          });
          const ld = await lr.json().catch(() => ({}));
          if (lr.ok && ld?.labelUrl) {
            setRetLabel({ url: String(ld.labelUrl), deductCents: Number(ld.deductCents) || 0, carrier: String(ld.carrier || '') });
          }
        } catch { /* the staff desk can still send one; the return is open either way */ }
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not start return', description: e?.message });
    } finally {
      setRetSending(false);
    }
  };

  /* PHOTOS BEFORE THE TICKET. Each file uploads through the same validated,
   * link-authorized pipeline the claims flow uses (customer sends bytes, the
   * server chooses the path); the URLs then ride the message that creates
   * the ticket. Capped at 3, compressed by the phone's own picker. */
  const attachHelpPhoto = async (file: File) => {
    if (!selfToken || photoBusy || helpPhotos.length >= 3) return;
    setPhotoBusy(true);
    try {
      const dataUrl: string = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result || ''));
        r.onerror = () => rej(new Error('Could not read that file'));
        r.readAsDataURL(file);
      });
      const resp = await fetch('/api/retail/claim-photo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, orderId, qrToken: selfToken, purpose: 'support', image: dataUrl }),
      });
      const d = await resp.json().catch(() => ({}));
      if (!resp.ok || !d?.url) throw new Error(d?.error || 'Upload failed');
      setHelpPhotos((cur) => [...cur, String(d.url)]);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Photo not added', description: e?.message });
    } finally {
      setPhotoBusy(false);
    }
  };

  const sendHelp = async () => {
    if (!order || !selfToken || helpSending || !helpMsg.trim()) return;
    setHelpSending(true);
    try {
      const qrToken = selfToken;
      const res = await fetch('/api/retail/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, orderId, qrToken, message: helpMsg.trim(), photoUrls: helpPhotos }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send');
      setSupportThread((cur) => [...cur, {
        message: helpMsg.trim(), createdAt: new Date().toISOString(),
        status: 'open', autoReply: '', replies: [], pending: true,
        expectNote: data.expectNote || '', photoUrls: helpPhotos,
      }]);
      setHelpPhotos([]);
      setHelpSent(true);
      setHelpMsg('');
      toast({ title: 'Message received', description: 'It’s with the team — you can watch it right here.' });
      load();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not send', description: e?.message });
    } finally {
      setHelpSending(false);
    }
  };

  if (loadError) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 p-8 text-center bg-muted/5">
        <XCircle className="w-10 h-10 text-muted-foreground opacity-30" />
        <p className="font-black uppercase tracking-tight text-lg">Order not found</p>
        <p className="text-sm text-muted-foreground max-w-sm">{loadError}</p>
      </div>
    );
  }
  if (!order) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 bg-muted/5">
        <Loader className="w-8 h-8 animate-spin text-primary" />
        <p className="text-[10px] font-black uppercase tracking-widest opacity-40">Finding your order…</p>
      </div>
    );
  }

  const isPickup = order.method === 'counter' || order.method === 'curbside';
  const isShip = order.method === 'ship';
  const checkedIn = !!order.curbside?.arrivedAt;

  // Progress model — the customer's drive-thru lane view.
  const steps = isShip
    ? [
        { id: 'paid', label: 'Confirmed' },
        { id: 'picking', label: 'Preparing' },
        { id: 'packed', label: 'Packed' },
        { id: 'shipped', label: 'Shipped' },
      ]
    : [
        { id: 'paid', label: 'Confirmed' },
        { id: 'picking', label: 'Preparing' },
        { id: 'ready', label: 'Ready' },
        { id: 'handed_off', label: 'Picked up' },
      ];
  const stageRank: Record<string, number> = {
    placed: -1, paid: 0, picking: 1, packed: isShip ? 2 : 1.5, ready: 2,
    arrived: 2.5, shipped: 3, handed_off: 3, completed: 3.5, cancelled: -2, refunded: 3.5,
  };
  const rank = stageRank[order.stage] ?? 0;

  const refundedLines = order.lines.filter((l) => l.qtyShorted > 0);
  // Past the date we promised, with nothing shipped: the customer gets an
  // unconditional way out (FTC mail/internet order rule). Derived here rather
  // than trusted from the server alone so the banner and the button agree.
  const promiseLate = !!(order as any).shipPromiseAt
    && ['paid', 'picking', 'packed', 'ready'].includes(order.stage)
    && Date.parse((order as any).shipPromiseAt) < Date.now();

  // What the customer actually received, as opposed to where the order got to.
  const fulfilment = fulfilmentSummary(order.lines);
  const outcome = customerOutcomeHeadline(fulfilment, isShip);

  return (
    <div className="min-h-dvh bg-muted/5 pb-20">
      <header className="bg-white border-b-2">
        <div className="max-w-lg mx-auto px-5 py-5 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-primary/60">
              {isShip ? 'Shipping Order' : order.method === 'curbside' ? 'Curbside Order' : 'Pickup Order'}
            </p>
            <h1 className="font-black uppercase tracking-tighter text-2xl leading-none">
              {typeof order.orderNumber === 'number' && order.orderNumber > 0
                ? `Order #${String(order.orderNumber).padStart(4, '0')}`
                : 'Your order'}
            </h1>
          </div>
          {order.priceTier === 'wholesale' && (
            <Badge className="bg-primary/10 text-primary border-2 border-primary/20 font-black text-[9px] uppercase tracking-widest">
              B2B{order.poNumber ? ` · PO ${order.poNumber}` : ''}
            </Badge>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-5 py-6 space-y-5">
        {order.stage === 'cancelled' && (
          <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-8 text-center space-y-3">
              <XCircle className="w-10 h-10 mx-auto text-destructive/60" />
              <p className="font-black uppercase tracking-tight text-lg">Order cancelled</p>
              <p className="text-sm text-muted-foreground">
                {order.refundedCents > 0
                  ? `${fmt(order.refundedCents)} was refunded to your original payment method. Refunds usually appear in 5–10 business days.`
                  : 'This order was cancelled before payment completed — nothing was charged.'}
              </p>
            </CardContent>
          </Card>
        )}

        {order.stage === 'placed' && (
          <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-8 text-center space-y-4">
              <Loader className="w-8 h-8 mx-auto animate-spin text-primary" />
              <p className="font-black uppercase tracking-tight text-lg">Confirming your payment</p>
              <p className="text-sm text-muted-foreground">
                This usually takes a few seconds and updates automatically. If you didn&apos;t finish
                checking out, you can close this page — nothing has been charged.
              </p>
            </CardContent>
          </Card>
        )}

        {rank >= 0 && order.stage !== 'cancelled' && (
          <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-6">
              <div className="flex items-center">
                {steps.map((s, i) => {
                  const stepRank = stageRank[s.id] ?? i;
                  const done = rank >= stepRank;
                  const current = !done && (i === 0 || rank >= (stageRank[steps[i - 1].id] ?? i - 1));
                  return (
                    <React.Fragment key={s.id}>
                      {i > 0 && <div className={cn('flex-1 h-1 rounded-full mx-1.5', rank >= stepRank ? 'bg-primary' : 'bg-muted')} />}
                      <div className="flex flex-col items-center gap-1.5">
                        <div className={cn(
                          'w-9 h-9 rounded-full border-2 flex items-center justify-center transition-all',
                          done ? 'bg-primary border-primary text-primary-foreground' :
                          current ? 'border-primary text-primary animate-pulse' : 'border-muted text-muted-foreground/40'
                        )}>
                          {done ? <Check className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                        </div>
                        <span className={cn('text-[8px] font-black uppercase tracking-widest', done || current ? 'text-foreground' : 'text-muted-foreground/40')}>
                          {s.label}
                        </span>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>

              {order.stage === 'paid' && queuePosition != null && (
                <p className="text-center text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-4">
                  {queuePosition === 1 ? "You're next in line" : `#${queuePosition} in the queue`}
                </p>
              )}
              {order.stage === 'arrived' && (
                <p className="text-center text-[10px] font-black uppercase tracking-widest text-primary mt-4 animate-pulse">
                  {curbside.mode === 'drive_thru' && lanePosition != null
                    ? lanePosition <= 1 ? 'You’re next — pull forward' : `#${lanePosition} in the lane — we’re moving fast`
                    : order.curbside?.bringingOutBy ? `${order.curbside.bringingOutBy} is bringing your order out now` : 'We’re bringing your order out now'}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {isPickup && qrDataUrl && !['handed_off', 'completed'].includes(order.stage) && (
          <Card className={cn(
            'border-2 rounded-[2rem] overflow-hidden bg-white transition-all',
            order.stage === 'ready' || order.stage === 'arrived' ? 'border-primary shadow-xl shadow-primary/10' : ''
          )}>
            <CardContent className="p-6 text-center space-y-3">
              <div className="flex items-center justify-center gap-2">
                <QrCode className="w-4 h-4 text-primary" />
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  {order.stage === 'ready' || order.stage === 'arrived'
                    ? 'Show this to pick up'
                    : 'Your pickup code — ready when you are'}
                </p>
              </div>
              <img src={qrDataUrl} alt={`Pickup QR for order ${order.orderNumber}`} className="w-56 h-56 mx-auto rounded-2xl border-2" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                Backup: give your name and order #{String(order.orderNumber).padStart(4, '0')} at the counter
              </p>
            </CardContent>
          </Card>
        )}

        {order.method === 'curbside' && !['handed_off', 'completed', 'cancelled', 'placed'].includes(order.stage) && (
          <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-6 space-y-3">
              <div className="flex items-center gap-2">
                <Car className="w-4 h-4 text-primary" />
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Curbside</p>
              </div>
              {checkedIn && order.stage !== 'arrived' ? (
                <p className="text-sm font-bold text-muted-foreground">
                  We know you&apos;re here{order.curbside?.spotOrVehicle ? ` (${order.curbside.spotOrVehicle})` : ''} —
                  your order is still being prepared and we&apos;ll bring it straight out.
                  {curbside.mode === 'drive_thru' && lanePosition != null ? ` You're #${lanePosition + 1} in line.` : ''}
                </p>
              ) : order.stage === 'arrived' ? (
                order.curbside?.bringingOutAt ? (
                  <div className="flex items-center gap-4 rounded-2xl border-2 border-primary/30 bg-primary/[0.05] p-4">
                    <span className="relative shrink-0">
                      <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" aria-hidden="true" />
                      {order.curbside?.bringingOutPhoto ? (
                        <img
                          src={order.curbside.bringingOutPhoto}
                          alt={`${order.curbside.bringingOutBy || 'A team member'} from the shop`}
                          className="relative h-16 w-16 rounded-full border-2 border-white object-cover shadow-lg ring-4 ring-primary/20"
                        />
                      ) : (
                        <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-primary text-xl font-black text-primary-foreground shadow-lg ring-4 ring-primary/20">
                          {(order.curbside?.bringingOutBy || 'S').slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <span className="absolute -bottom-1 -right-1 flex h-7 w-7 animate-bounce items-center justify-center rounded-full border-2 border-white bg-primary shadow-md" aria-hidden="true">
                        <ShoppingBag className="h-3.5 w-3.5 text-primary-foreground" />
                      </span>
                    </span>
                    <span className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-widest text-primary">On the way to you</p>
                      <p className="mt-0.5 text-base font-black leading-tight text-foreground">
                        {order.curbside.bringingOutBy || 'A team member'} is walking out with your order
                      </p>
                      {order.curbside?.spotOrVehicle && (
                        <p className="mt-0.5 text-[11px] font-bold text-muted-foreground">
                          Heading to {order.curbside.spotOrVehicle} — no need to do anything.
                        </p>
                      )}
                    </span>
                  </div>
                ) : (
                  <p className="text-sm font-bold text-muted-foreground">
                    Checked in{order.curbside?.spotOrVehicle ? ` — ${order.curbside.spotOrVehicle}` : ''}. Hang tight!
                  </p>
                )
              ) : (
                !order.curbside?.onWayAt && !hereEarly ? (
                  <>
                    <p className="text-sm font-bold text-muted-foreground">
                      Tap when you leave and we&apos;ll have it ready the moment you pull in.
                    </p>
                    <Button
                      disabled={onWayBusy}
                      onClick={sendOnWay}
                      className="w-full h-14 rounded-2xl font-black uppercase text-[11px] tracking-widest shadow-lg shadow-primary/20 transition-all active:scale-[0.98]"
                    >
                      {onWayBusy
                        ? <span className="flex items-center gap-2"><Loader className="h-4 w-4 animate-spin" /> Letting them know…</span>
                        : <span className="flex items-center gap-2"><Car className="h-4 w-4" /> I&apos;m on my way</span>}
                    </Button>
                    <button
                      type="button"
                      onClick={() => setHereEarly(true)}
                      className="w-full py-2 text-center text-[11px] font-black uppercase tracking-widest text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                    >
                      Already parked outside? Check in →
                    </button>
                  </>
                ) : (
                  <>
                    {order.curbside?.onWayAt && (
                      <p className="rounded-2xl border-2 border-primary/20 bg-primary/[0.04] p-3 text-[11px] font-bold text-muted-foreground">
                        We know you&apos;re coming{order.curbside?.etaMinutes ? ` — about ${order.curbside.etaMinutes} min` : ''}. We&apos;ll have it ready.
                        {geoWatching ? ' Keep this page open and we’ll spot you when you pull in.' : ''}
                      </p>
                    )}
                    {curbside.mode === 'spots' && curbside.spots.length > 0 ? (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Which spot are you in?</p>
                        <div className="grid grid-cols-3 gap-2">
                          {curbside.spots.map((s) => (
                            <button
                              key={s}
                              type="button"
                              aria-pressed={vehicle === s}
                              onClick={() => setVehicle(vehicle === s ? '' : s)}
                              className={cn(
                                'rounded-2xl border-2 p-4 text-[11px] font-black uppercase tracking-widest transition-all active:scale-95',
                                vehicle === s
                                  ? 'border-primary bg-primary text-primary-foreground shadow-md'
                                  : 'bg-white hover:border-primary/40'
                              )}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : curbside.mode === 'drive_thru' ? (
                      <p className="text-sm font-bold text-muted-foreground">
                        Pull into the pickup lane, then tap below — you&apos;ll see your live spot in line.
                      </p>
                    ) : (
                      <Input
                        placeholder="Spot number or car description"
                        aria-label="Spot number or car description"
                        value={vehicle}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVehicle(e.target.value)}
                        className="h-12 rounded-xl border-2 font-bold text-sm"
                      />
                    )}
                    <label className={cn(
                      'flex items-start gap-3 rounded-2xl border-2 p-3 cursor-pointer transition-all',
                      bringToVehicle && 'border-primary/50 bg-primary/[0.04]'
                    )}>
                      <input
                        type="checkbox"
                        className="mt-0.5 h-5 w-5 shrink-0 rounded border-2 accent-current"
                        checked={bringToVehicle}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBringToVehicle(e.target.checked)}
                        aria-label="Please bring my order to my vehicle"
                      />
                      <span className="min-w-0">
                        <span className="block text-xs font-black uppercase tracking-tight">Please bring it to my vehicle</span>
                        <span className="mt-0.5 block text-[11px] font-bold text-muted-foreground">
                          Tick this if coming inside is difficult for any reason. We&apos;ll come to you — no explanation needed.
                        </span>
                      </span>
                    </label>
                    {bringToVehicle && (
                      <Input
                        placeholder="Anything that helps us find you? (optional)"
                        aria-label="Anything that helps us find you"
                        value={accessNote}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAccessNote(e.target.value)}
                        className="h-11 rounded-xl border-2 font-bold text-sm"
                      />
                    )}
                    <Button
                      disabled={checkingIn || (curbside.mode === 'spots' && curbside.spots.length > 0 && !vehicle)}
                      onClick={checkIn}
                      className="w-full h-14 rounded-2xl font-black uppercase text-[11px] tracking-widest shadow-lg shadow-primary/20 transition-all active:scale-[0.98]"
                    >
                      {checkingIn
                        ? <span className="flex items-center gap-2"><Loader className="h-4 w-4 animate-spin" /> Checking you in…</span>
                        : curbside.mode === 'drive_thru' ? "I'm in the lane" : "I'm here"}
                    </Button>
                    {curbside.mode === 'spots' && curbside.spots.length > 0 && !vehicle && (
                      <p className="text-center text-[10px] font-bold text-muted-foreground">Pick your spot first so we walk to the right car.</p>
                    )}
                  </>
                )
              )}
            </CardContent>
          </Card>
        )}

        {isShip && (
          <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-6 space-y-2">
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-primary" />
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Shipping to {order.shipCity || 'you'}
                </p>
              </div>
              {order.trackingNumber ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono font-black text-xs truncate">{order.carrier ? `${order.carrier} · ` : ''}{order.trackingNumber}</p>
                  {order.trackingUrl && (
                    <Button asChild variant="outline" size="sm" className="h-9 rounded-xl font-black uppercase text-[9px] tracking-widest border-2">
                      <a href={order.trackingUrl} target="_blank" rel="noreferrer">Track</a>
                    </Button>
                  )}
                </div>
              ) : (
                <p className="text-sm font-bold text-muted-foreground">
                  Tracking will appear here as soon as your order ships.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {['handed_off', 'completed'].includes(order.stage) && (
          <Card className={cn(
            'border-2 rounded-[2rem] overflow-hidden',
            outcome.tone === 'good' ? 'border-green-200 bg-green-50/50' : 'border-amber-200 bg-amber-50/50'
          )}>
            <CardContent className="p-6 text-center space-y-2">
              {outcome.tone === 'good'
                ? <CheckCircle2 className="w-8 h-8 mx-auto text-green-600" />
                : <PackageCheck className="w-8 h-8 mx-auto text-amber-600" />}
              <p className="font-black uppercase tracking-tight">{outcome.title}</p>
              {outcome.detail && (
                <p className="text-xs font-bold text-muted-foreground leading-relaxed">{outcome.detail}</p>
              )}
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                Thanks, {order.customerName.split(' ')[0]}
              </p>
            </CardContent>
          </Card>
        )}

        <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-primary" />
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Your items</p>
            </div>
            {(() => {
              const totOrdered = order.lines.reduce((a, l) => a + l.qtyOrdered, 0);
              const totBack = order.lines.filter((l) => l.status === 'backordered').reduce((a, l) => a + l.qtyShorted, 0);
              const totRefunded = order.lines.filter((l) => l.status === 'refunded').reduce((a, l) => a + l.qtyShorted, 0);
              const totNow = totOrdered - totBack - totRefunded;
              if (totBack === 0 && totRefunded === 0) return null;
              return (
                <div className="grid grid-cols-3 gap-2 rounded-2xl border-2 border-amber-200 bg-amber-50/50 p-3 text-center">
                  <div>
                    <p className="font-mono text-base font-black">{totOrdered}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Ordered</p>
                  </div>
                  <div>
                    <p className="font-mono text-base font-black">{totNow}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">{isShip ? 'In this shipment' : 'Ready with this order'}</p>
                  </div>
                  <div>
                    <p className="font-mono text-base font-black text-amber-700">{totBack > 0 ? totBack : totRefunded}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-amber-700">{totBack > 0 ? 'Backordered' : 'Refunded'}</p>
                  </div>
                  {totBack > 0 && (
                    <p className="col-span-3 text-[9px] font-bold text-amber-800">
                      {isShip
                        ? 'Backordered units ship separately at no extra shipping cost — we’ll email tracking when they’re on the way.'
                        : 'Backordered units will be ready for pickup when restocked — we’ll let you know.'}
                      {totRefunded > 0 ? ` ${totRefunded} unavailable unit(s) were refunded.` : ''}
                    </p>
                  )}
                </div>
              );
            })()}
            <div className="space-y-2.5">
              {order.lines.map((l, i) => (
                <div key={i} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-black uppercase tracking-tight text-xs">
                      {l.qtyOrdered - l.qtyShorted > 0 ? `${l.qtyOrdered - l.qtyShorted} × ` : ''}{l.name}
                    </p>
                    {l.qtyShorted > 0 && (
                      <p className="text-[9px] font-black uppercase tracking-widest text-amber-600">
                        {l.status === 'backordered'
                          ? `${l.qtyShorted} on backorder — ships separately`
                          : `${l.qtyShorted} unavailable — refunded`}
                      </p>
                    )}
                    {Array.isArray((l as any).documents) && (l as any).documents.length > 0 && (
                      <p className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                        {(l as any).documents.map((d: { name: string; url: string }, k: number) => (
                          <a
                            key={k} href={d.url} target="_blank" rel="noreferrer"
                            className="text-[9px] font-black uppercase tracking-widest text-primary underline underline-offset-2"
                          >
                            {d.name} ↓
                          </a>
                        ))}
                      </p>
                    )}
                  </div>
                  <p className="font-black font-mono text-xs shrink-0">{fmt(l.unitPriceCents * (l.qtyOrdered - l.qtyShorted))}</p>
                </div>
              ))}
            </div>
            <Separator />
            <div className="space-y-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              <div className="flex justify-between"><span>Subtotal</span><span className="font-mono">{fmt(order.subtotalCents)}</span></div>
              {order.taxCents > 0 && <div className="flex justify-between"><span>Tax</span><span className="font-mono">{fmt(order.taxCents)}</span></div>}
              {order.shippingCents > 0 && <div className="flex justify-between"><span>Shipping</span><span className="font-mono">{fmt(order.shippingCents)}</span></div>}
              {order.refundedCents > 0 && (
                <div className="flex justify-between text-amber-600"><span>Refunded</span><span className="font-mono">-{fmt(order.refundedCents)}</span></div>
              )}
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-[10px] font-black uppercase tracking-widest">Total paid</span>
              <span className="font-black font-mono text-lg text-primary">{fmt(order.totalCents)}</span>
            </div>
          </CardContent>
        </Card>

        {selfToken && (
          <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-6 space-y-3">
              <div className="flex items-center gap-2">
                <LifeBuoy className="w-4 h-4 text-primary" />
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Need help with this order?</p>
              </div>
              {order && order.stage !== 'placed' && order.stage !== 'cancelled' && (
                <Button
                  variant="outline"
                  disabled={rcptSending}
                  onClick={resendReceipt}
                  className="w-full h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest"
                >
                  {rcptSending ? <Loader className="h-4 w-4 animate-spin" /> : 'Email my receipt again'}
                </Button>
              )}
              {order && selfToken && (order.lines || []).some((l: any) => l.digital === true) && order.stage !== 'placed' && order.stage !== 'cancelled' && (
                <a
                  href={`/shop/${tenantId}/library/${orderId}?t=${encodeURIComponent(selfToken)}`}
                  className="flex w-full h-10 items-center justify-center rounded-xl border-2 font-black uppercase text-[10px] tracking-widest hover:bg-muted"
                >
                  Open my library
                </a>
              )}
              {order && selfToken && order.stage !== 'placed' && order.stage !== 'cancelled' && (
                <a
                  href={`/shop/${tenantId}/invoice/${orderId}?t=${encodeURIComponent(selfToken)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-full h-10 items-center justify-center rounded-xl border-2 font-black uppercase text-[10px] tracking-widest hover:bg-muted"
                >
                  Download invoice
                </a>
              )}
              {supportThread.length > 0 && (
                <div className="space-y-2 rounded-2xl border-2 border-primary/20 bg-primary/[0.02] p-3">
                  <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/60">Your messages</p>
                  <div className="max-h-72 space-y-2 overflow-y-auto">
                    {supportThread.map((t, i) => (
                      <div key={i} className="space-y-2">
                        <div className="ml-6">
                          <p className="rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground whitespace-pre-wrap">{t.message}</p>
                          {(t.photoUrls || []).length > 0 && (
                            <div className="mt-1 flex justify-end gap-1.5">
                              {(t.photoUrls || []).map((u, k) => (
                                <a key={k} href={u} target="_blank" rel="noreferrer">
                                  <img src={u} alt={`Attached photo ${k + 1}`} className="h-14 w-14 rounded-lg border-2 object-cover" />
                                </a>
                              ))}
                            </div>
                          )}
                          <p className="mt-0.5 text-right text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                            ✓ Received{t.createdAt ? ` · ${new Date(t.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
                          </p>
                        </div>
                        {t.autoReply && (
                          <div className="mr-6">
                            <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/60">Instant answer</p>
                            <p className="rounded-xl bg-muted px-3 py-2 text-sm font-bold whitespace-pre-wrap">{t.autoReply}</p>
                          </div>
                        )}
                        {t.replies.map((r, j) => (
                          <div key={j} className="mr-6">
                            <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/60">{r.by}</p>
                            <p className="rounded-xl bg-muted px-3 py-2 text-sm font-bold whitespace-pre-wrap">{r.text}</p>
                            {r.at && (
                              <p className="mt-0.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                                {new Date(r.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  {(() => {
                    const last = supportThread[supportThread.length - 1];
                    const answered = last.replies.length > 0 || last.status === 'resolved';
                    return (
                      <p className={cn('rounded-xl border-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest',
                        answered ? 'border-green-600/40 bg-green-500/10 text-green-700' : 'border-primary/30 bg-primary/[0.05] text-primary')}>
                        {last.status === 'resolved' ? '✓ Resolved — reply below if anything’s still off'
                          : last.replies.length > 0 ? '✓ The team replied — answer below any time'
                          : `With the team — ${last.expectNote || 'replies land right here (and by email)'}. This page checks automatically.`}
                      </p>
                    );
                  })()}
                </div>
              )}
              {(
                <>
                  {selfToken && !aiDown && (
                    <div className="space-y-2 rounded-2xl border-2 p-3">
                      <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/60">Ask about this order</p>
                      {aiThread.length > 0 && (
                        <div className="max-h-56 space-y-2 overflow-y-auto">
                          {aiThread.map((m, i) => (
                            <p key={i} className={cn('rounded-xl px-3 py-2 text-sm font-bold whitespace-pre-wrap',
                              m.role === 'user' ? 'bg-primary text-primary-foreground ml-6' : 'bg-muted mr-6')}>
                              {m.content}
                            </p>
                          ))}
                          {aiBusy && <p className="mr-6 rounded-xl bg-muted px-3 py-2 text-sm font-bold text-muted-foreground">Reading your order…</p>}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Input
                          aria-label="Ask a question about this order"
                          placeholder="e.g. When will it arrive? Can I still change the address?"
                          value={aiInput}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAiInput(e.target.value)}
                          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') askAi(); }}
                          className="h-11 rounded-xl border-2 font-bold text-sm"
                        />
                        <Button disabled={aiBusy || !aiInput.trim()} onClick={askAi}
                          className="h-11 rounded-xl px-4 font-black uppercase text-[10px] tracking-widest">
                          Ask
                        </Button>
                      </div>
                      <p className="text-[9px] font-bold text-muted-foreground/70">
                        Answers come straight from this order’s record. It can’t change your order or promise refunds — the buttons below do the real work, and a person reviews anything important.
                      </p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/60">Instant answers</p>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        ['status', 'Where’s my order?'],
                        ['refund', 'Refund status'],
                        ['change', 'Cancel or change'],
                        ['return', 'Returns'],
                      ].map(([k, label]) => (
                        <button key={k} type="button" aria-expanded={instantQ === k}
                          onClick={() => setInstantQ(instantQ === k ? null : k)}
                          className={cn('h-8 px-3 rounded-full border-2 text-[8px] font-black uppercase tracking-widest transition-all',
                            instantQ === k ? 'bg-foreground text-background border-foreground' : 'bg-white hover:border-primary/40')}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {instantQ && order && (
                      <div className="rounded-2xl border-2 border-primary/20 bg-primary/[0.03] p-3">
                        <p className="text-xs font-bold text-muted-foreground leading-relaxed">
                          {instantQ === 'status' && (
                            order.stage === 'ready' ? 'Your order is READY — pickup details are at the top of this page.'
                            : order.stage === 'shipped' ? (order.trackingNumber ? `Shipped via ${order.carrier || 'carrier'} — tracking ${order.trackingNumber}. Link is above.` : 'Shipped — tracking will appear here once available.')
                            : ['handed_off', 'completed'].includes(order.stage) ? 'This order is complete — the receipt is on this page.'
                            : ['picking', 'packed'].includes(order.stage) ? 'Your order is being packed right now — this page updates live.'
                            : order.stage === 'paid' ? 'Confirmed and in the packing queue — this page updates live as it moves.'
                            : 'This page always shows the live status of your order.'
                          )}
                          {instantQ === 'refund' && (
                            (order.refundedCents || 0) > 0
                              ? `A refund of ${fmt(order.refundedCents)} has been issued. Card refunds typically appear in 5–10 business days.`
                              : 'No refund is recorded on this order yet. If one is processed, it will show here and typically reaches your card in 5–10 business days.'
                          )}
                          {instantQ === 'change' && (
                            ['placed', 'paid'].includes(order.stage)
                              ? 'You can cancel yourself — the “Cancel this order” button is just below. For item changes, cancel and re-order, or send us a note.'
                              : 'Packing has already started, so changes need a human — send us a note below and we’ll sort it out.'
                          )}
                          {instantQ === 'return' && (
                            ['shipped', 'handed_off', 'completed'].includes(order.stage)
                              ? 'Tap “Start a return” below — pick your items and reason, and we’ll take it from there.'
                              : 'Returns open once your order is picked up or delivered — the button will appear right on this page.'
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                  <Textarea
                    placeholder="Still need us? Tell us what's going on…"
                    aria-label="Message to the shop"
                    value={helpMsg}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setHelpMsg(e.target.value)}
                    className="rounded-2xl border-2 min-h-[80px] font-bold text-sm"
                  />
                  <div className="flex items-center gap-2">
                    <label className={cn('flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border-2 px-3 text-[9px] font-black uppercase tracking-widest transition-all',
                      (photoBusy || helpPhotos.length >= 3) ? 'opacity-50' : 'hover:border-primary/40 active:scale-95')}>
                      <Camera className="h-3.5 w-3.5" />
                      {photoBusy ? 'Adding…' : helpPhotos.length >= 3 ? '3 photo max' : 'Add photo'}
                      <input
                        type="file" accept="image/*" className="hidden"
                        disabled={photoBusy || helpPhotos.length >= 3}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          const f = e.target.files?.[0];
                          if (f) void attachHelpPhoto(f);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {helpPhotos.map((u, i) => (
                      <span key={i} className="relative">
                        <img src={u} alt={`Photo ${i + 1} ready to send`} className="h-9 w-9 rounded-lg border-2 object-cover" />
                        <button
                          type="button" aria-label={`Remove photo ${i + 1}`}
                          onClick={() => setHelpPhotos((cur) => cur.filter((_, k) => k !== i))}
                          className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-[9px] font-black text-background"
                        >×</button>
                      </span>
                    ))}
                  </div>
                  <Button
                    disabled={!helpMsg.trim() || helpSending}
                    onClick={sendHelp}
                    variant="outline"
                    className="w-full h-11 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest"
                  >
                    {helpSending ? <Loader className="h-4 w-4 animate-spin" /> : supportThread.length > 0 ? 'Send another message' : 'Send to the shop'}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {selfToken && order && order.method === 'ship' && ['placed', 'paid'].includes(order.stage) && (
          <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-black uppercase tracking-widest">Shipping to the right place?</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFixOpen((v) => !v)}
                  className="h-9 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest"
                >
                  {fixOpen ? 'Never mind' : 'Correct address'}
                </Button>
              </div>
              <p className="text-[11px] font-bold text-muted-foreground">
                {order.shipCity ? `Currently headed to ${order.shipCity}. ` : ''}Typos happen — you can fix the address any time before packing starts.
              </p>
              {fixOpen && (
                <div className="space-y-2">
                  <Input placeholder="Recipient name" aria-label="Recipient name" autoComplete="name" value={fixAddr.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFixAddr({ ...fixAddr, name: e.target.value })} className="h-11 rounded-xl border-2 font-bold text-sm" />
                  <Input placeholder="Street address" aria-label="Street address" autoComplete="address-line1" value={fixAddr.line1} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFixAddr({ ...fixAddr, line1: e.target.value })} className="h-11 rounded-xl border-2 font-bold text-sm" />
                  <Input placeholder="Apt / suite (optional)" aria-label="Apartment or suite, optional" autoComplete="address-line2" value={fixAddr.line2} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFixAddr({ ...fixAddr, line2: e.target.value })} className="h-11 rounded-xl border-2 font-bold text-sm" />
                  <div className="grid grid-cols-3 gap-2">
                    <Input placeholder="City" aria-label="City" autoComplete="address-level2" value={fixAddr.city} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFixAddr({ ...fixAddr, city: e.target.value })} className="h-11 rounded-xl border-2 font-bold text-sm" />
                    <Input placeholder="State" aria-label="State" autoComplete="address-level1" value={fixAddr.state} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFixAddr({ ...fixAddr, state: e.target.value })} className="h-11 rounded-xl border-2 font-bold text-sm" />
                    <Input placeholder="ZIP" aria-label="ZIP code" autoComplete="postal-code" inputMode="numeric" value={fixAddr.postalCode} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFixAddr({ ...fixAddr, postalCode: e.target.value })} className="h-11 rounded-xl border-2 font-bold text-sm" />
                  </div>
                  <Button
                    disabled={fixSending}
                    onClick={submitAddressFix}
                    className="w-full h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest"
                  >
                    {fixSending ? <Loader className="h-4 w-4 animate-spin" /> : 'Save corrected address'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {selfToken && order && promiseLate && (
          <Card className="border-2 border-amber-200 rounded-[2rem] overflow-hidden bg-amber-50/60">
            <CardContent className="p-5 space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-800">Running late</p>
              <p className="text-xs font-bold text-amber-900">
                We said this would be on its way by {new Date((order as any).shipPromiseAt).toLocaleDateString()} and it isn&apos;t yet. You can wait — we&apos;ll email as soon as it ships — or cancel right now for a full refund, no questions asked.
              </p>
            </CardContent>
          </Card>
        )}

        {selfToken && order && (['placed', 'paid'].includes(order.stage) || promiseLate) && (
          <Button
            variant="outline"
            disabled={cancelBusy}
            onClick={cancelSelf}
            className="w-full h-11 rounded-2xl border-2 border-destructive/30 text-destructive font-black uppercase text-[10px] tracking-widest"
          >
            {cancelBusy ? <Loader className="h-4 w-4 animate-spin" /> : promiseLate ? 'Cancel and refund me' : 'Cancel this order'}
          </Button>
        )}

        {selfToken && order && ['shipped', 'handed_off', 'completed'].includes(order.stage) && (
          <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-black uppercase tracking-widest">Something wrong with your order?</p>
                {!claimDone && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setClaimOpen((v) => !v)}
                    className="h-9 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest"
                  >
                    {claimOpen ? 'Never mind' : 'Report a problem'}
                  </Button>
                )}
              </div>

              {myClaims.length > 0 && (
                <div className="space-y-2">
                  {myClaims.map((mc) => {
                    const label =
                      mc.type === 'missing' ? 'Missing item' :
                      mc.type === 'damaged' ? 'Damaged' :
                      mc.type === 'wrong_item' ? 'Wrong item' : 'Never arrived';
                    const statusLine =
                      mc.status === 'in_review' ? (mc.appealedAt ? 'Appeal in review — a person is on it' : 'In review with the packing record') :
                      mc.status === 'auto_resolved' || mc.status === 'resolved'
                        ? `Approved${mc.resolutionCents ? ` — $${(mc.resolutionCents / 100).toFixed(2)} refund queued` : ''}`
                        : 'Declined';
                    const good = mc.status === 'auto_resolved' || mc.status === 'resolved';
                    return (
                      <div key={mc.id} className={cn('rounded-2xl border-2 p-3 space-y-1.5', good ? 'border-primary/30 bg-primary/[0.03]' : mc.status === 'declined' ? 'border-slate-200' : 'border-amber-200 bg-amber-50/40')}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-black uppercase tracking-tight">
                            {label}{mc.lineName ? ` · ${mc.lineName}` : ''}{mc.qty > 1 ? ` ×${mc.qty}` : ''}
                          </p>
                          <p className={cn('text-[9px] font-black uppercase tracking-widest', good ? 'text-primary' : 'text-muted-foreground')}>{statusLine}</p>
                        </div>
                        {(mc as any).infoRequestText && (
                          <div className="rounded-xl border-2 border-amber-200 bg-amber-50/60 p-2.5 space-y-1.5">
                            <p className="text-[9px] font-black uppercase tracking-widest text-amber-800">The shop asked</p>
                            <p className="text-[11px] font-bold text-amber-900">{(mc as any).infoRequestText}</p>
                            {(mc as any).infoResponseText ? (
                              <p className="text-[11px] font-bold text-foreground border-t-2 border-amber-100 pt-1.5">You answered: {(mc as any).infoResponseText}</p>
                            ) : (
                              <div className="space-y-1.5">
                                <Textarea
                                  aria-label="Answer the shop's request"
                                  placeholder="Type your answer — add photos below if they asked for pictures"
                                  value={infoAnswer[mc.id] ?? ''}
                                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInfoAnswer({ ...infoAnswer, [mc.id]: e.target.value })}
                                  className="min-h-[54px] rounded-xl border-2 bg-white font-bold text-sm"
                                />
                                <Button size="sm" disabled={infoBusy === mc.id || !(infoAnswer[mc.id] || '').trim()}
                                  onClick={() => answerInfoRequest(mc.id)}
                                  className="h-9 w-full rounded-xl font-black uppercase text-[10px] tracking-widest">
                                  {infoBusy === mc.id ? 'Sending…' : 'Send my answer'}
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                        {Array.isArray(mc.photoUrls) && mc.photoUrls.length > 0 && (
                          <div className="flex gap-2 pt-1">
                            {mc.photoUrls.slice(0, 4).map((u: string) => (
                              <img key={u} src={u} alt="Photo attached to this report" className="h-12 w-12 rounded-lg border-2 object-cover" />
                            ))}
                          </div>
                        )}
                        {mc.status !== 'approved' && (mc.photoUrls?.length || 0) < 4 && (
                          <label className="inline-flex items-center gap-1.5 pt-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground cursor-pointer">
                            <input
                              type="file"
                              accept="image/*"
                              className="sr-only"
                              aria-label="Add a photo to this report"
                              disabled={photoBusyFor === mc.id}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                const f = e.target.files?.[0];
                                e.target.value = '';
                                if (f) addClaimPhoto(mc.id, f);
                              }}
                            />
                            <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                            {photoBusyFor === mc.id ? 'Adding photo…' : 'Add a photo (helps the review)'}
                          </label>
                        )}
                        {mc.status === 'declined' && mc.declineReason && (
                          <p className="text-[11px] font-bold text-muted-foreground">{mc.declineReason}</p>
                        )}
                        {mc.status === 'declined' && !mc.appealedAt && (
                          appealFor === mc.id ? (
                            <div className="space-y-2 pt-1">
                              <Textarea
                                aria-label="Why should this be looked at again"
                                placeholder="Anything the shop should know — a person reads this"
                                value={appealNote}
                                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAppealNote(e.target.value)}
                                className="min-h-20 rounded-xl border-2 font-bold text-sm"
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  disabled={appealSending}
                                  onClick={() => submitAppeal(mc.id)}
                                  className="h-9 rounded-xl font-black uppercase text-[10px] tracking-widest"
                                >
                                  {appealSending ? <Loader className="h-3.5 w-3.5 animate-spin" /> : 'Send appeal'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => { setAppealFor(null); setAppealNote(''); }}
                                  className="h-9 rounded-xl font-black uppercase text-[10px] tracking-widest"
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setAppealFor(mc.id)}
                              className="h-9 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest"
                            >
                              Think we got it wrong? Appeal
                            </Button>
                          )
                        )}
                        {mc.status === 'declined' && mc.appealedAt && (
                          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Appealed — awaiting a second look</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {claimDone ? (
                <p className="rounded-2xl border-2 border-primary/30 bg-primary/[0.03] p-3 text-xs font-bold text-primary">{claimDone}</p>
              ) : claimOpen ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {([['missing', 'Item missing'], ['damaged', 'Arrived damaged'], ['wrong_item', 'Wrong item'], ['not_received', 'Never arrived']] as const).map(([v, label]) => (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={claimType === v}
                        onClick={() => setClaimType(v)}
                        className={cn(
                          'h-9 rounded-xl border-2 px-3 text-[10px] font-black uppercase tracking-widest transition-all',
                          claimType === v ? 'border-primary bg-primary/5 text-primary' : 'bg-white'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {claimType !== 'not_received' && (
                    <div className="flex gap-2">
                      <select
                        aria-label="Which item"
                        value={claimLine}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setClaimLine(e.target.value)}
                        className="h-11 flex-1 rounded-xl border-2 bg-white px-2 text-xs font-black uppercase tracking-widest"
                      >
                        <option value="">Which item?</option>
                        {order.lines.filter((l) => l.lineId).map((l) => (
                          <option key={l.lineId} value={l.lineId}>{l.name}</option>
                        ))}
                      </select>
                      <select
                        aria-label="How many"
                        value={claimQty}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setClaimQty(Number(e.target.value))}
                        className="h-11 w-20 rounded-xl border-2 bg-white px-2 text-xs font-black uppercase tracking-widest"
                      >
                        {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                  )}
                  {claimType !== 'not_received' && kitPieces.length > 0 && (
                    <select
                      aria-label="Which piece of the set"
                      value={pieceOther ? '__other' : claimComponent}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                        if (e.target.value === '__other') { setPieceOther(true); setClaimComponent(''); }
                        else { setPieceOther(false); setClaimComponent(e.target.value); }
                      }}
                      className="h-11 w-full rounded-xl border-2 bg-white px-2 text-xs font-black uppercase tracking-widest"
                    >
                      <option value="">Which piece of the set?</option>
                      {kitPieces.map((p) => <option key={p} value={p}>{p}</option>)}
                      <option value="__other">Something else / not listed</option>
                    </select>
                  )}
                  {claimType !== 'not_received' && (kitPieces.length === 0 || pieceOther) && (
                    <Input
                      aria-label="Which piece of the item, if it's a set"
                      placeholder="A set or collection? Name the exact piece"
                      value={claimComponent}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setClaimComponent(e.target.value)}
                      className="h-11 rounded-xl border-2 font-bold text-sm"
                    />
                  )}
                  <Textarea
                    aria-label="Tell us what happened"
                    placeholder={claimType === 'damaged' ? 'Describe the damage — required, it’s what the shop reviews first' : claimType === 'wrong_item' ? 'What arrived instead? Required' : 'Anything that helps — what you found when you opened it'}
                    value={claimNote}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setClaimNote(e.target.value)}
                    className="min-h-20 rounded-xl border-2 font-bold text-sm"
                  />
                  <Button
                    disabled={claimSending}
                    onClick={submitClaim}
                    className="w-full h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest"
                  >
                    {claimSending ? <Loader className="h-4 w-4 animate-spin" /> : 'Send report'}
                  </Button>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">
                    Checked against the packing record — clear cases resolve automatically.
                  </p>
                </div>
              ) : myClaims.length === 0 ? (
                <p className="text-[11px] font-bold text-muted-foreground">
                  Missing, damaged, wrong, or never arrived — report it here and it goes straight to the shop with your order&apos;s packing record attached.
                </p>
              ) : null}
            </CardContent>
          </Card>
        )}

        {selfToken && order && ['shipped', 'handed_off', 'completed'].includes(order.stage) && (
          <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-5 space-y-3">
              <p className="text-[11px] font-black uppercase tracking-widest">How did it go?</p>
              <p className="text-[11px] font-bold text-muted-foreground">
                Your review helps the next person decide — and only people who actually bought it can leave one.
              </p>
              {order.lines.filter((l) => l.lineId).map((l) => {
                const pid = String((l as any).productId || l.lineId);
                const open = revLine === pid;
                if (revDone[pid]) {
                  return (
                    <p key={pid} className="rounded-2xl border-2 border-primary/30 bg-primary/[0.03] p-3 text-xs font-bold text-primary">
                      Thanks for reviewing {l.name}
                    </p>
                  );
                }
                return (
                  <div key={pid} className="rounded-2xl border-2 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-xs font-black uppercase tracking-tight">{l.name}</p>
                      {!open && (
                        <Button
                          variant="outline" size="sm"
                          onClick={() => { setRevLine(pid); setRevRating(5); }}
                          className="h-8 shrink-0 rounded-xl border-2 text-[11px] font-black uppercase tracking-widest"
                        >
                          Write a review
                        </Button>
                      )}
                    </div>

                    {open && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5" role="group" aria-label="Star rating">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              type="button"
                              aria-label={`${n} star${n === 1 ? '' : 's'}`}
                              aria-pressed={revRating === n}
                              onClick={() => setRevRating(n)}
                              className={cn(
                                'h-10 w-10 rounded-xl border-2 text-base font-bold transition-colors',
                                n <= revRating ? 'bg-foreground text-background border-foreground' : 'bg-white'
                              )}
                            >
                              ★
                            </button>
                          ))}
                        </div>
                        <Input
                          placeholder="Sum it up (optional)"
                          aria-label="Review title, optional"
                          value={revTitle}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRevTitle(e.target.value)}
                          className="h-11 rounded-2xl border-2 font-bold text-sm"
                        />
                        <Textarea
                          placeholder="What did you think?"
                          aria-label="Your review"
                          value={revBody}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRevBody(e.target.value)}
                          className="min-h-[70px] rounded-2xl border-2 font-bold text-sm"
                        />
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            onClick={() => setRevLine(null)}
                            className="h-11 flex-1 rounded-2xl border-2 text-[11px] font-black uppercase tracking-widest"
                          >
                            Cancel
                          </Button>
                          <Button
                            disabled={revSending || revBody.trim().length < 4}
                            onClick={() => submitReview(pid)}
                            className="h-11 flex-1 rounded-2xl text-[11px] font-black uppercase tracking-widest"
                          >
                            {revSending ? <Loader className="h-4 w-4 animate-spin" /> : 'Post review'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {selfToken && order && ['shipped', 'handed_off', 'completed'].includes(order.stage) && (
          <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-5 space-y-3">
              {retDone ? (
                <div className="space-y-2">
                  {retLabel && (
                    <div className="space-y-2 rounded-2xl border-2 border-primary/30 bg-primary/[0.05] p-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-primary">Your prepaid return label is ready</p>
                      <a
                        href={retLabel.url} target="_blank" rel="noreferrer"
                        className="flex h-11 w-full items-center justify-center rounded-xl bg-primary font-black uppercase text-[10px] tracking-widest text-primary-foreground shadow-md transition-all active:scale-[0.98]"
                      >
                        Open my return label{retLabel.carrier ? ` — ${retLabel.carrier}` : ''}
                      </a>
                      <p className="text-[10px] font-bold text-muted-foreground">
                        {retLabel.deductCents > 0
                          ? `Return shipping of $${(retLabel.deductCents / 100).toFixed(2)} will be deducted from your refund or credit — you'll see the exact amount in the confirmation.`
                          : 'Return shipping is on us — the label costs you nothing.'}{' '}
                        It's also in your email. Tape it over the old label on any box.
                      </p>
                    </div>
                  )}
                  <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-4 text-center">
                    <p className="text-sm font-bold text-primary">
                      Return started — {retLabel ? 'ship the items back with the label above' : 'bring the items by (or ship them back)'} and we&rsquo;ll take it from there.
                    </p>
                  </div>
                </div>
              ) : !returnOpen ? (
                <Button
                  variant="outline"
                  onClick={() => setReturnOpen(true)}
                  className="w-full h-11 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest"
                >
                  Start a return
                </Button>
              ) : (
                <>
                  <p className="text-[10px] font-black uppercase tracking-widest">Start a return</p>
                  {(order.lines || []).some((l: any) => l.digital === true) && (
                    <p className="rounded-2xl border-2 border-amber-200 bg-amber-50/60 p-2.5 text-[11px] font-bold text-amber-900">
                      Digital items aren&apos;t listed — there&apos;s nothing to post back. If something’s wrong with one, use &ldquo;Report a problem&rdquo; and the shop will sort it with you.
                    </p>
                  )}
                  <div className="space-y-2">
                    {order.lines.filter((l) => l.lineId && (l as any).digital !== true && (l.qtyOrdered - l.qtyShorted - (l.qtyReturned || 0)) > 0).map((l) => {
                      const max = l.qtyOrdered - l.qtyShorted - (l.qtyReturned || 0);
                      const q = retQty[l.lineId as string] || 0;
                      return (
                        <div key={l.lineId} className="rounded-2xl border-2 p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-black uppercase tracking-tight text-xs min-w-0 truncate">{l.name}</p>
                            <div className="flex items-center gap-2 shrink-0">
                              <Button variant="outline" size="icon" aria-label={`Return fewer of ${l.name}`} className="h-8 w-8 rounded-lg border-2"
                                disabled={q <= 0}
                                onClick={() => setRetQty({ ...retQty, [l.lineId as string]: q - 1 })}>−</Button>
                              <span className="font-black font-mono text-sm w-6 text-center">{q}<span className="text-muted-foreground text-[9px]">/{max}</span></span>
                              <Button variant="outline" size="icon" aria-label={`Return more of ${l.name}`} className="h-8 w-8 rounded-lg border-2"
                                disabled={q >= max}
                                onClick={() => setRetQty({ ...retQty, [l.lineId as string]: q + 1 })}>+</Button>
                            </div>
                          </div>
                          {q > 0 && (
                            <select
                              aria-label={`Reason for returning ${l.name}`}
                              value={retReason[l.lineId as string] || 'changed_mind'}
                              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setRetReason({ ...retReason, [l.lineId as string]: e.target.value })}
                              className="w-full h-10 rounded-xl border-2 bg-white px-3 text-[10px] font-black uppercase tracking-widest"
                            >
                              <option value="changed_mind">Changed my mind</option>
                              <option value="damaged_in_transit">Arrived damaged</option>
                              <option value="defective">Defective</option>
                              <option value="wrong_item">Wrong item</option>
                              <option value="other">Other</option>
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(['refund', 'store_credit'] as const).map((r) => (
                      <button key={r} type="button" aria-pressed={retResolution === r}
                        onClick={() => setRetResolution(r)}
                        className={cn('h-10 rounded-xl border-2 text-[9px] font-black uppercase tracking-widest transition-all',
                          retResolution === r ? 'bg-foreground text-background border-foreground' : 'bg-white')}>
                        {r === 'refund' ? 'Refund' : 'Store credit'}
                      </button>
                    ))}
                  </div>
                  <Textarea
                    placeholder="Anything we should know? (optional)"
                    aria-label="Notes for the shop, optional"
                    value={retNotes}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRetNotes(e.target.value)}
                    className="rounded-2xl border-2 min-h-[60px] font-bold text-sm"
                  />
                  <Button
                    disabled={retSending}
                    onClick={submitReturn}
                    className="w-full h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest"
                  >
                    {retSending ? <Loader className="h-4 w-4 animate-spin" /> : 'Submit return'}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {selfToken && (
          <Button variant="outline" onClick={openAccount}
            className="w-full h-12 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest">
            View all my orders
          </Button>
        )}
      </main>
    </div>
  );
}
