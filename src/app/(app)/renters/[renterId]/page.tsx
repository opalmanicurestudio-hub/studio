'use client';
// app/(app)/renters/[renterId] — ONE RENTER, ON ONE PAGE (components/renters/RenterPage). The Overview is worked out on
// the server (api/renters/one); the Money, Documents, Messages and Activity tabs are the renter card's own, shown in the
// page. End lease and Edit are the same dialogs the Renters list uses.
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { AppHeader } from '@/components/shared/AppHeader';
import { RenterPage, type RenterTab } from '@/components/renters/RenterPage';
import { RenterProfileDrawer } from '@/components/renters/RenterProfileDrawer';
import { EndLeaseDialog } from '@/components/renters/EndLeaseDialog';
import { RenterEditDialog } from '@/components/renters/RenterEditDialog';
import { contactKey, contactDocId, setContactNote } from '@/lib/booth-contacts';
import { pickLease } from '@/lib/renter-summary';

const TABS: RenterTab[] = ['overview', 'details', 'money', 'documents', 'messages', 'activity'];

export default function RenterOwnPage() {
  const params = useParams() as any;
  const renterId = String(params?.renterId || '');
  // Keyed by renter, so moving from one renter's page to another's starts fresh.
  return <RenterOwn key={renterId} renterId={renterId} />;
}

function RenterOwn({ renterId }: { renterId: string }) {
  const { firestore } = useFirebase() as any;
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;
  const { toast } = useToast();
  const router = useRouter();
  const [tab, setTab] = useState<RenterTab>('overview');
  // ?tab=money (and the others) opens on that tab.
  useEffect(() => { try { const t = new URLSearchParams(window.location.search).get('tab') as RenterTab; if (TABS.includes(t)) setTab(t); } catch { /* overview */ } }, []);
  const [renter, setRenter] = useState<any | null | undefined>(undefined);
  const [loadErr, setLoadErr] = useState(false);
  const [leases, setLeases] = useState<any[]>([]);
  const [allLeases, setAllLeases] = useState<any[]>([]);
  const [booths, setBooths] = useState<any[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [amenity, setAmenity] = useState<any[]>([]);
  const [w9, setW9] = useState<any>(undefined);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [cardLink, setCardLink] = useState('');
  const [cardBusy, setCardBusy] = useState(false);
  const [ending, setEnding] = useState<false | { owedCents?: number; depositsByLease?: Record<string, number> }>(false);

  useEffect(() => {
    if (!firestore || !tenantId || !renterId) return;
    const T = ['tenants', tenantId] as const;
    const un = [
      onSnapshot(doc(firestore, ...T, 'renters', renterId), (d) => { setLoadErr(false); setRenter(d.exists() ? { id: d.id, ...(d.data() as any) } : null); }, () => setLoadErr(true)),
      onSnapshot(collection(firestore, ...T, 'leases'), (s) => { const all = s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })); setAllLeases(all); setLeases(all.filter((l) => l.renterId === renterId)); }, () => {}),
      onSnapshot(collection(firestore, ...T, 'booths'), (s) => setBooths(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))), () => {}),
      onSnapshot(query(collection(firestore, ...T, 'amenityRequests'), where('renterId', '==', renterId)), (s) => setAmenity(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))), () => {}),
    ];
    return () => un.forEach((u) => u());
  }, [firestore, tenantId, renterId]);
  // Their guests are matched by phone or email, as the renter card does.
  const phone = renter?.phone || ''; const email = renter?.email || '';
  useEffect(() => {
    if (!firestore || !tenantId || (!phone && !email)) return;
    const got: Record<string, any[]> = {};
    const push = () => setReservations(Array.from(new Map([...(got.p || []), ...(got.e || [])].map((r) => [r.id, r])).values()));
    const un = [
      phone ? onSnapshot(query(collection(firestore, 'tenants', tenantId, 'boothReservations'), where('phone', '==', phone)), (s) => { got.p = s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })); push(); }, () => {}) : null,
      email ? onSnapshot(query(collection(firestore, 'tenants', tenantId, 'boothReservations'), where('email', '==', email)), (s) => { got.e = s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })); push(); }, () => {}) : null,
    ];
    return () => un.forEach((u) => u && u());
  }, [firestore, tenantId, phone, email]);
  // Their private notes, kept on their contact record (the same notes Pipeline shows).
  useEffect(() => {
    const key = contactKey(phone, email);
    if (!firestore || !tenantId || !key) return;
    return onSnapshot(doc(firestore, 'tenants', tenantId, 'contacts', contactDocId(key)), (d) => setNote(String((d.data() as any)?.ownerNotes || '')), () => setNote(''));
  }, [firestore, tenantId, phone, email]);
  // A link for them to save a card for rent (on their own phone; it opens the business's card page).
  const sendCardLink = async () => {
    if (!tenantId || cardBusy) return;
    setCardBusy(true);
    try {
      const h = await staffAuthHeader();
      const res = await fetch('/api/booths/setup-card', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, renterId, returnUrl: `${window.location.origin}/card-setup/${tenantId}` }) });
      const d = await res.json();
      if (d?.ok && d.url) setCardLink(d.url); else toast({ title: 'No card link made', description: d?.error || 'Card payments may not be set up yet.' });
    } catch { toast({ title: 'No card link made', description: 'Check your connection and try again.' }); }
    finally { setCardBusy(false); }
  };
  useEffect(() => {
    if (!tenantId || !renterId) return;
    staffAuthHeader().then((h) => fetch(`/api/booths/w9?tenantId=${encodeURIComponent(tenantId)}&renterId=${encodeURIComponent(renterId)}`, { headers: h }))
      .then((r) => r.json()).then((d) => { if (d?.ok) setW9(d.w9 || null); }).catch(() => undefined);
  }, [tenantId, renterId]);

  // The same lease the page's summary is about (lib/renter-summary pickLease): after a lease ends, its deposit can still
  // be settled from Money.
  const lease = useMemo(() => pickLease(leases, renterId) || undefined, [leases, renterId]);
  const booth = lease ? booths.find((b) => b.id === lease.boothId) : undefined;
  // Details (the card's own overview) is about a lease they hold now: no autopay switch or End lease for one that ended.
  // Money keeps the ended one, so its deposit can still be settled.
  const heldLease = lease && ['active', 'on_leave', 'pending_signature'].includes(String(lease.status)) ? lease : undefined;
  const refreshKey = useMemo(() => [renter?.updatedAt, renter?.status, renter?.portalLastSeenAt, ...leases.map((l) => `${l.id}:${l.status}:${l.updatedAt || ''}`)].join('|'), [renter, leases]);
  const chooseTab = (t: RenterTab) => {
    setTab(t);
    try { const u = new URL(window.location.href); if (t === 'overview') u.searchParams.delete('tab'); else u.searchParams.set('tab', t); window.history.replaceState(null, '', u.toString()); } catch { /* stays as it is */ }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#f5f5f7] text-[#16171a]">
      <AppHeader title="Renter" />
      <main className="mx-auto w-full max-w-[1100px] min-w-0 px-4 py-6 sm:px-6">
        {!tenantId ? <p className="text-[15px] text-[#6d7075]">Choose a business first.</p>
          : loadErr && !renter ? (
            <div role="alert" className="rounded-[20px] border border-[#ececee] bg-white p-5">
              <p className="text-[15px] text-[#b45309]">This renter didn’t load. Check your connection, then reload the page.</p>
            </div>
          ) : renter === null ? (
            <div className="rounded-[20px] border border-[#ececee] bg-white p-5">
              <p className="text-[15px] font-semibold">That renter isn’t here.</p>
              <p className="mt-1 text-[14px] text-[#6d7075]">They may have been removed, or the link is from another business.</p>
              <a href="/renters" className="mt-3 inline-flex min-h-[44px] items-center rounded-xl bg-[#16171a] px-4 text-[14px] font-semibold text-white">Back to Renters</a>
            </div>
          ) : (
            <RenterPage tenantId={tenantId} renterId={renterId} phone={renter?.phone} refreshKey={refreshKey} tab={tab} onTab={chooseTab}
              onEdit={() => setEditing(true)} onEndLease={(left) => setEnding(left)}
              renderTab={(t) => renter ? (
                <RenterProfileDrawer inPage pageTab={t === 'details' ? 'overview' : (t as any)} renter={renter}
                  lease={t === 'details' ? heldLease : lease} booth={booth} reservations={reservations} amenityRequests={amenity} w9={w9}
                  tenantId={tenantId} firestore={firestore} onClose={() => chooseTab('overview')} onEdit={() => setEditing(true)}
                  onLease={() => router.push(`/booths?lease=${encodeURIComponent(renterId)}`)} onEndLease={() => setEnding({})}
                  onRecordPayment={() => router.push(`/rent?pay=${encodeURIComponent(renterId)}`)} onAddCard={sendCardLink}
                  {...(note !== undefined ? { contactNote: note, onSaveNote: (n: string) => { void setContactNote(firestore, tenantId, { name: `${renter.firstName || ''} ${renter.lastName || ''}`.trim(), phone, email }, n).then(() => toast({ title: 'Note saved' })).catch(() => toast({ title: 'Note not saved', description: 'Try again.' })); } } : {})} />
              ) : <p className="text-[13px] text-[#6d7075]">Loading…</p>} />
          )}
      </main>
      {cardLink && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={() => setCardLink('')} onKeyDown={(e) => { if (e.key === 'Escape') setCardLink(''); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="card-link-title" className="w-full max-w-md space-y-3 rounded-[20px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h2 id="card-link-title" className="text-[19px] font-bold leading-7">A link to save their card</h2>
            <p className="text-[14px] leading-relaxed text-[#6d7075]">Send it to {renter?.firstName || 'them'} by text or email. They open it on their own phone and save a card for rent.</p>
            <input readOnly autoFocus value={cardLink} onFocus={(e) => e.currentTarget.select()} aria-label="Card link" className="h-11 w-full rounded-xl border border-[#ececee] bg-[#f5f5f7] px-3 text-[14px]" />
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="inline-flex min-h-[44px] items-center rounded-xl border border-[#ececee] bg-white px-4 text-[15px] font-medium" onClick={() => setCardLink('')}>Done</button>
              <button type="button" className="inline-flex min-h-[44px] items-center rounded-xl bg-[#16171a] px-4 text-[15px] font-semibold text-white" onClick={() => { navigator.clipboard?.writeText(cardLink).then(() => toast({ title: 'Link copied' })).catch(() => toast({ title: 'Select the link and copy it' })); }}>Copy link</button>
            </div>
          </div>
        </div>
      )}
      {editing && renter && tenantId && <RenterEditDialog tenantId={tenantId} firestore={firestore} renter={renter} onClose={() => setEditing(false)} onSaved={(said) => toast({ title: said })} />}
      {ending && renter && tenantId && <EndLeaseDialog tenantId={tenantId} firestore={firestore} renter={renter} leases={allLeases.map((l) => ({ ...l, boothName: booths.find((b) => b.id === l.boothId)?.name }))} owedCents={ending.owedCents} depositsByLease={ending.depositsByLease} onClose={() => setEnding(false)} onEnded={(said) => toast({ title: said })} />}
    </div>
  );
}
