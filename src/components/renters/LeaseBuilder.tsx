'use client';
// src/components/renters/LeaseBuilder.tsx — A NEW LEASE, IN SIX STEPS, WITH THE LEASE'S WORDS BESIDE THE FIELDS.
// Space and term, rent and money, their own business, insurance and care, when things go wrong, review and send. Each
// step fills in its sections of the lease (lib/lease-builder) from what's chosen here and from the business's rental
// policies; the words are shown as they'll read. On send the lease is made (lib/booth-rental-service createLease) with
// its words frozen, the version of the lease settings it was written from and a fingerprint of its exact text, and the
// renter signs it in their portal. A draft is kept on this device until it's sent.
import * as React from 'react';
import { createPortal } from 'react-dom';
import { collection, doc, getDocs, query, where, updateDoc } from 'firebase/firestore';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { createLease } from '@/lib/booth-rental-service';
import { resolveLeasePolicy, buildLease, leaseChecks, usd, shortDate, type LeaseDraft, type LeaseContext, type LeasePolicy, leaseEndAfter, slotsClash } from '@/lib/lease-builder';
import { resolveOffers, signedOffersFrom } from '@/lib/renter-offers';
import { resolveIncidentalPolicy } from '@/lib/incidentals';
import { responseCommitments } from '@/lib/maintenance';
import { resolveLeavePolicy } from '@/lib/leave-policy';
import { resolveCollectionsPolicy } from '@/lib/collections-policy';
import { firstBill } from '@/lib/rent-schedule';
import { BUILDER_PERK_TYPES, BUILDER_PERK_TRIGGERS, perkWords, type BuilderPerkType, type BuilderPerkTrigger } from '@/lib/lease-perks';
import { sha256Hex } from '@/lib/sha256';

const STEPS = ['Space and term', 'Rent and money', 'Their own business', 'Insurance and care', 'When things go wrong', 'Review and send'];
const STEP_SECTIONS: string[][] = [
  ['parties', 'space', 'term', 'early', 'holdover'],
  ['rent', 'late', 'pay', 'deposit', 'charges'],
  ['independent', 'bookings', 'tools'],
  ['insurance', 'licenses', 'care', 'responsibility', 'clients'],
  ['repairs', 'closures', 'away', 'concerns', 'rulebreaks', 'unpaid', 'business_change'],
  [],
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const card = 'space-y-3 rounded-[20px] border border-[#ececee] bg-white p-5';
const input = 'h-11 w-full rounded-xl border border-[#ececee] bg-white px-3 text-[15px] text-[#16171a]';
const lbl = 'block text-[13px] font-semibold text-[#16171a]';
const hint = 'text-[13px] leading-snug text-[#6d7075]';
const btn = 'h-11 rounded-full border border-[#ececee] bg-white px-4 text-[15px] font-medium text-[#16171a] hover:bg-[#f5f5f7] disabled:opacity-50';
const dark = 'h-11 rounded-full bg-[#16171a] px-5 text-[15px] font-medium text-white disabled:opacity-40';

const dollars = (c: number) => (c ? (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }) : '');
const cents = (v: string) => { const n = Math.round(Number(String(v).replace(/[^0-9.]/g, '')) * 100); return Number.isFinite(n) ? n : 0; };
/** A money field that takes typing as typed ("12.", "0.5") and shows it neatly once you leave it. */
function MoneyInput({ id, value, onChange, placeholder, label }: { id: string; value: number; onChange: (cents: number) => void; placeholder?: string; label?: string }) {
  const [raw, setRaw] = React.useState<string | null>(null);
  return <input id={id} aria-label={label} inputMode="decimal" className={input} placeholder={placeholder} value={raw ?? dollars(value)}
    onFocus={() => setRaw(value ? String(value / 100) : '')}
    onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'); setRaw(v); onChange(cents(v)); }}
    onBlur={() => setRaw(null)} />;
}
/** A number field the same way (a percentage). */
function NumberInput({ id, value, onChange, max }: { id: string; value: number; onChange: (n: number) => void; max: number }) {
  const [raw, setRaw] = React.useState<string | null>(null);
  return <input id={id} inputMode="decimal" className={input} value={raw ?? (value ? String(value) : '')}
    onFocus={() => setRaw(value ? String(value) : '')}
    onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'); setRaw(v); onChange(Math.min(max, Number(v) || 0)); }}
    onBlur={() => setRaw(null)} />;
}
const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

function Toggle({ on, onChange, label, sub, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; sub?: string; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-[#ececee] py-3 first:border-t-0">
      <div className="min-w-0"><p className="text-[15px] font-medium text-[#16171a]">{label}</p>{sub && <p className={hint}>{sub}</p>}</div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className="grid h-11 w-[60px] shrink-0 place-items-center disabled:opacity-50">
        <span className={`relative block h-[30px] w-[52px] rounded-full ${on ? 'bg-[#1f7a4d]' : 'bg-[#d9d9de]'}`}><span className={`absolute top-[3px] h-6 w-6 rounded-full bg-white ${on ? 'left-[25px]' : 'left-[3px]'}`} /></span>
      </button>
    </div>
  );
}
function Field({ id, label, children, note, warn }: { id: string; label: string; children: React.ReactNode; note?: string; warn?: boolean }) {
  return <div className="space-y-1.5"><label htmlFor={id} className={lbl}>{label}</label>{children}{note && <p className={`text-[13px] leading-snug ${warn ? 'text-[#b45309]' : 'text-[#6d7075]'}`}>{note}</p>}</div>;
}
function Row({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#ececee] py-3"><div className="min-w-0 flex-1"><p className="text-[15px] font-medium text-[#16171a]">{label}</p>{sub && <p className={hint}>{sub}</p>}</div><div className="w-full sm:w-auto">{children}</div></div>;
}

export type LeaseBuilderProps = {
  tenantId: string; tenant: any; firestore: any;
  renter: any;
  booths: any[]; locations?: any[];
  /** Every lease, to see who already uses the space (a shared space's days, or a whole space taken). */
  leases?: any[];
  defaultBoothId?: string | null;
  /** Upload a lease already signed on paper (when they don't sign in the portal); returns its link. */
  uploadSigned?: (file: File) => Promise<string>;
  /** Who's signed in, kept with the business's signature. */
  signer?: { uid: string; email: string | null } | null;
  onClose: () => void;
  onCreated: (leaseId: string, said: string) => void;
};

type BuilderPerk = { id: string; type: BuilderPerkType; label: string; trigger: BuilderPerkTrigger; valueCents?: number; valuePercent?: number };
/** The lease settings a draft keeps (the ones changed on the last step). */
const pickPolicy = (x: any) => ({ legalName: String(x?.legalName ?? ''), governingState: String(x?.governingState ?? ''), county: String(x?.county ?? ''), ...(x?.attorneyReview ? { attorneyReview: x.attorneyReview } : {}) });

export function LeaseBuilder(p: LeaseBuilderProps) {
  const { tenantId, tenant, renter } = p;
  const draftKey = `cf-lease-draft:${tenantId}:${renter?.id || ''}`;
  const basePolicy = React.useMemo(() => resolveLeasePolicy(tenant), [tenant]);
  const [step, setStep] = React.useState(0);
  // A draft kept on this device comes back as it was left: the lease, the space, its length, perks, the signing choice,
  // a pasted attorney's lease and any lease settings changed here.
  const saved = React.useMemo(() => { try { return JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch { return null; } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [policy, setPolicy] = React.useState<LeasePolicy>(() => (saved?.policy ? { ...basePolicy, ...pickPolicy(saved.policy) } : basePolicy));
  const [boothId, setBoothId] = React.useState<string>(p.defaultBoothId || saved?.boothId || '');
  const [length, setLength] = React.useState<'open' | '6' | '12' | '24' | 'custom'>(saved?.length || '12');
  const [perks, setPerks] = React.useState<BuilderPerk[]>(Array.isArray(saved?.perks) ? saved.perks : []);
  const [rules, setRules] = React.useState<{ id: string; label: string }[] | null>(null);
  const [sign, setSign] = React.useState<boolean>(saved?.sign !== false);
  const [invite, setInvite] = React.useState(true);
  const [own, setOwn] = React.useState<{ on: boolean; text: string }>(saved?.own && typeof saved.own.text === 'string' ? { on: !!saved.own.on, text: saved.own.text } : { on: false, text: '' });
  const [paper, setPaper] = React.useState<File | null>(null);
  const [review, setReview] = React.useState<{ open: boolean; at: string; by: string }>({ open: false, at: todayIso(), by: '' });
  const [showText, setShowText] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [bizSig, setBizSig] = React.useState<string>(typeof saved?.bizSig === 'string' ? saved.bizSig : '');
  const busyRef = React.useRef(false);
  const close = () => { if (!busyRef.current) p.onClose(); };
  const [err, setErr] = React.useState('');
  const topRef = React.useRef<HTMLDivElement | null>(null);

  const booth = p.booths.find((b) => b.id === boothId) || null;
  const location = (p.locations || []).find((l) => l.id === booth?.locationId) || null;
  const charges = React.useMemo(() => resolveIncidentalPolicy(tenant), [tenant]);
  const offers = React.useMemo(() => resolveOffers(tenant), [tenant]);
  const today = todayIso();

  const initial = (): LeaseDraft => ({
    renterName: `${renter?.firstName || ''} ${renter?.lastName || ''}`.trim(), renterBusinessName: String(renter?.businessName || ''), renterNoticeAddress: String(renter?.noticeAddress || renter?.address || ''),
    spaceName: '', spaceAddress: '', isShared: false, slot: null,
    accessHours: basePolicy.accessHours, amenities: [], keyType: 'own_code',
    startDate: today, endDate: leaseEndAfter(today, 12), autoRenew: true,
    noticeDays: basePolicy.noticeDays, earlyEndFee: basePolicy.earlyEndFee, holdover: basePolicy.holdover,
    rentCents: 0, frequency: 'monthly', dueDay: 1, prorateFirst: true, rentChangeNoticeDays: basePolicy.rentChangeNoticeDays,
    graceDays: 3, lateFee: { type: 'flat', amountCents: 2500 }, declinedFeeCents: basePolicy.declinedFeeCents,
    payByCard: basePolicy.payByCard, payByAutopay: basePolicy.payByAutopay, payOffline: basePolicy.payOffline,
    depositCents: 0, depositRefundable: true, depositReturnDays: basePolicy.depositReturnDays, depositAsLastMonth: false,
    agreedCharges: charges.map((c) => ({ label: c.label, capCents: c.capCents })),
    sellProducts: true, noPoach: basePolicy.noPoach,
    insurance: { ...basePolicy.insurance }, licenseRequired: basePolicy.licenseRequired, houseRules: null,
    changesNeedOk: basePolicy.changesNeedOk, damageByRenter: basePolicy.damageByRenter, propertyClause: basePolicy.propertyClause,
  });
  const [d, setD] = React.useState<LeaseDraft>(() => (saved?.d ? { ...initial(), ...saved.d } : initial()));
  const set = <K extends keyof LeaseDraft>(k: K, v: LeaseDraft[K]) => { setErr(''); setD((x) => ({ ...x, [k]: v })); };

  // The draft is kept on this device as it changes; a sent lease clears it.
  React.useEffect(() => { try { localStorage.setItem(draftKey, JSON.stringify({ d, boothId, length, perks, sign, own, bizSig, policy: pickPolicy(policy), at: Date.now() })); } catch { /* fine */ } }, [d, boothId, length, perks, sign, own, bizSig, policy, draftKey]);

  // Choosing a space fills in its details, and its rent (its monthly rate if it has one) and a deposit of one period's
  // rent, all still editable. A draft brought back keeps what it had.
  const pickBooth = (id: string) => {
    setBoothId(id); setErr('');
    const b = p.booths.find((x) => x.id === id);
    if (!b) { setD((x) => ({ ...x, spaceName: '', spaceAddress: '', amenities: [], isShared: false, slot: null, rentCents: 0, depositCents: 0 })); return; }
    const loc = (p.locations || []).find((l) => l.id === b.locationId) || null;
    const opts: any[] = Array.isArray(b.pricingOptions) ? b.pricingOptions : [];
    const monthly = opts.find((o) => o.frequency === 'monthly' && Number(o.amountCents) > 0);
    const rent = monthly ? Number(monthly.amountCents) : Number(b.baseRentCents) || 0;
    // Everything from the space before is replaced: a space someone already shares starts shared, with days to choose.
    setD((x) => ({ ...x, spaceName: b.name || '', spaceAddress: loc?.address || '', amenities: Array.isArray(b.amenities) ? b.amenities : [],
      isShared: String(b.status) === 'partial', slot: null,
      rentCents: rent, frequency: rent ? (monthly ? 'monthly' : (b.baseRentFrequency || 'monthly')) : 'monthly', depositCents: rent }));
  };
  React.useEffect(() => { if (boothId && !saved?.d) pickBooth(boothId); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The end date follows the length chosen (a custom one is typed); not on opening, so a draft keeps its own.
  const firstRun = React.useRef(true);
  React.useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (length === 'custom') return;
    setD((x) => ({ ...x, endDate: length === 'open' ? null : leaseEndAfter(x.startDate || today, Number(length)) }));
  }, [length, d.startDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // House rules that can be attached: published documents for renters.
  React.useEffect(() => {
    if (!p.firestore || !tenantId) return;
    getDocs(query(collection(p.firestore, `tenants/${tenantId}/documents`), where('status', '==', 'published'))).then((s) => {
      const rs = s.docs.map((x) => ({ id: x.id, ...(x.data() as any) })).filter((x: any) => Array.isArray(x.assignedRoles) && x.assignedRoles.includes('renter'))
        .map((x: any) => ({ id: x.id, label: `${String(x.title || 'House rules')}, version ${Number(x.version || 1)}` }));
      setRules(rs);
      setD((x) => (x.houseRules || !rs.length ? x : { ...x, houseRules: rs[0].label }));
    }).catch(() => setRules([]));
  }, [p.firestore, tenantId]);

  const ctx: LeaseContext = React.useMemo(() => ({
    businessName: String(tenant?.name || tenant?.businessName || ''), policy,
    repairs: responseCommitments(tenant?.maintenanceRules || null), leave: resolveLeavePolicy(tenant), collections: resolveCollectionsPolicy(tenant), offers,
  }), [tenant, policy, offers]);
  const built = React.useMemo(() => buildLease({ ...d, signedOnPaper: !sign, perks }, ctx), [d, ctx, sign, perks]);
  const checks = leaseChecks(d, ctx, { houseRulesAvailable: !!rules?.length });
  const fb = firstBill({ rentAmountCents: d.rentCents, frequency: d.frequency, dueDay: d.dueDay, firstChargeDate: d.startDate, startDate: d.startDate, prorateFirst: d.prorateFirst, autoRenew: true });
  const freeBooths = p.booths.filter((b) => b.id === boothId || ['vacant', 'partial', 'available'].includes(String(b.status || 'vacant')));
  // Who already uses this space (this renter too): a lease on the whole space blocks any other; a shared one blocks
  // overlapping days and times.
  const others = (p.leases || []).filter((l) => l.boothId === boothId && ['active', 'on_leave', 'pending_signature'].includes(String(l.status)));
  const clash = !boothId ? ''
    : others.some((l) => l.renterId === renter?.id) ? `${d.renterName.split(' ')[0] || 'They'} already ${d.renterName ? 'has' : 'have'} a lease on this space.`
    : others.some((l) => !l.scheduleSlot) ? 'Someone already rents this whole space.'
    : others.length && !d.isShared ? 'Others share this space, so this lease has to be shared too, on days they don’t use.'
    : d.isShared && !d.slot?.days?.length ? 'Choose their days.'
    : d.isShared && !!d.slot?.startTime !== !!d.slot?.endTime ? 'Add both times, or neither for the whole day.'
    : d.isShared && d.slot?.startTime && d.slot?.endTime && d.slot.endTime <= d.slot.startTime ? 'The end time has to be after the start time.'
    : d.isShared && others.some((l) => slotsClash(d.slot as any, l.scheduleSlot)) ? 'Those days and times overlap another renter’s.' : '';

  const valid = [
    !!boothId && !clash && !!d.renterName.trim() && !!d.startDate && (!d.endDate || d.endDate > d.startDate),
    d.rentCents > 0 && (d.frequency !== 'monthly' || (d.dueDay >= 1 && d.dueDay <= 31)),
    true, true, true,
    (!own.on || own.text.trim().length > 40) && (!sign || bizSig.trim().length >= 2),
  ];
  const go = (n: number) => { setStep(n); setErr(''); topRef.current?.scrollIntoView({ block: 'start' }); };
  // A step can be opened once every step before it is filled in.
  const reachable = (i: number) => valid.slice(0, i).every(Boolean);

  // A dialog: the page behind doesn't scroll, Escape closes it (the draft is kept), and Tab stays inside it.
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const titleRef = React.useRef<HTMLHeadingElement | null>(null);
  // The rest of the page is set inert while it's open, and focus goes back where it was when it closes. Nothing closes
  // it while a lease is being made.
  React.useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const box = boxRef.current;
    const quiet = Array.from(document.body.children).filter((el) => el !== box && !el.hasAttribute('inert')) as HTMLElement[];
    quiet.forEach((el) => el.setAttribute('inert', ''));
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab' || !boxRef.current) return;
      const f = Array.from(boxRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], at = document.activeElement as HTMLElement | null;
      const inside = !!at && f.includes(at);
      if (e.shiftKey && (at === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev; document.removeEventListener('keydown', onKey);
      quiet.forEach((el) => el.removeAttribute('inert'));
      try { if (opener && document.contains(opener)) opener.focus(); } catch { /* fine */ }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fingerprint = (text: string) => sha256Hex(text);

  const create = async () => {
    if (!valid.every(Boolean)) { setErr('Something on an earlier step still needs filling in.'); return; }
    if (!sign && !paper && !own.on) { /* a lease started without a signature: their choice, and it's on the lease */ }
    setBusy(true); busyRef.current = true; setErr('');
    try {
      // Business-wide lease settings changed here (legal name, state, county, a review) are kept for every lease.
      // Only the owner can change them; for anyone else they apply to this lease only, and the lease still goes.
      const changed: Record<string, any> = {};
      if (policy.legalName !== basePolicy.legalName) changed['leasePolicy.legalName'] = policy.legalName;
      if (policy.governingState !== basePolicy.governingState) changed['leasePolicy.governingState'] = policy.governingState;
      if (policy.county !== basePolicy.county) changed['leasePolicy.county'] = policy.county;
      if (policy.attorneyReview && JSON.stringify(policy.attorneyReview) !== JSON.stringify(basePolicy.attorneyReview)) changed['leasePolicy.attorneyReview'] = policy.attorneyReview;
      // If they can't be saved, this lease records no settings version: its words came from settings that aren't kept.
      let version: number | null = basePolicy.version; let keptNote = '';
      if (Object.keys(changed).length) {
        try { changed['leasePolicy.version'] = basePolicy.version + 1; await updateDoc(doc(p.firestore, `tenants/${tenantId}`), changed); version = basePolicy.version + 1; }
        catch (e: any) {
          version = null;
          keptNote = String(e?.code || '').includes('permission-denied')
            ? ' Your changes to the lease settings apply to this lease only: the owner keeps them for every lease.'
            : ' Your changes to the lease settings didn’t save, so they apply to this lease only.';
        }
      }
      const text = own.on ? own.text.trim() : built.text;
      const sha = fingerprint(text);
      const signedDocumentUrl = !sign && paper && p.uploadSigned ? await p.uploadSigned(paper) : null;
      const leaseId = await createLease(p.firestore, {
        tenantId, locationId: booth?.locationId || location?.id || '', boothId, renterId: renter.id,
        rentAmountCents: d.rentCents, frequency: d.frequency, dueDay: d.dueDay, firstChargeDate: d.startDate, startDate: d.startDate,
        endDate: d.endDate, autoRenew: d.autoRenew, earlyTerminationNoticeDays: d.noticeDays,
        deposit: d.depositCents > 0 ? { amountCents: d.depositCents, refundable: d.depositRefundable, refundConditions: d.depositRefundable ? `Returned within ${d.depositReturnDays} days of move-out, less any deductions, each listed with its reason.` : '', collectedLedgerEntryId: null, refundedLedgerEntryId: null } : null,
        // Grace days are kept even with no fee: the late notices follow them on a lease from the builder (leaseFrom).
        lateFeePolicy: d.lateFee && ((d.lateFee.type === 'flat' ? d.lateFee.amountCents : d.lateFee.percent) || 0) > 0
          ? { enabled: true, graceDays: d.graceDays, type: d.lateFee.type, ...(d.lateFee.type === 'flat' ? { amountCents: d.lateFee.amountCents } : { percent: d.lateFee.percent }) } as any
          : { enabled: false, graceDays: d.graceDays, type: 'flat', amountCents: 0 },
        scheduleSlot: d.isShared && d.slot?.days?.length ? { days: d.slot.days as any, ...(d.slot.startTime ? { startTime: d.slot.startTime } : {}), ...(d.slot.endTime ? { endTime: d.slot.endTime } : {}) } : null,
        // Each perk is given as a rent credit on the day it's due (lib/lease-perks).
        perks: (own.on ? [] : perks).map((x) => ({ id: x.id, type: x.type, label: x.label, trigger: x.trigger, ...(x.valueCents != null ? { valueCents: x.valueCents } : {}), ...(x.valuePercent != null ? { valuePercent: x.valuePercent } : {}) })) as any,
        includedAmenities: d.amenities, houseRules: d.houseRules || '',
        signedDocumentUrl, isShared: d.isShared,
        leaseTerms: text, requireSignature: sign, renterName: d.renterName, sentBy: ctx.businessName || null,
        prorateFirst: d.frequency === 'monthly' && d.prorateFirst,
        extra: {
          leaseFrom: own.on ? 'own' : 'builder', leaseVersion: own.on ? null : version, termsSha256: sha,
          // The business signs first, as it sends (the renter signs second, in their portal).
          ...(sign ? { businessSignature: { name: bizSig.trim(), at: new Date().toISOString(), termsSha256: sha, uid: p.signer?.uid || null, email: p.signer?.email || null } } : {}),
          // A lease in whole months renews by months (cron/nightly), so a year stays a year.
          ...(d.endDate && ['6', '12', '24'].includes(length) ? { termMonths: Number(length) } : {}),
          attorneyReviewAt: !own.on && policy.attorneyReview ? policy.attorneyReview.at : null,
          // What the lease says that the lease record doesn't otherwise hold, so the app can follow what was signed.
          leaseTermsSnapshot: own.on ? null : {
            noticeAddress: d.renterNoticeAddress, accessHours: d.accessHours, keyType: d.keyType, earlyEndFee: d.earlyEndFee, holdover: d.holdover,
            rentChangeNoticeDays: d.rentChangeNoticeDays, declinedFeeCents: d.declinedFeeCents, payByCard: d.payByCard, payByAutopay: d.payByAutopay, payOffline: d.payOffline,
            depositReturnDays: d.depositReturnDays, depositAsLastMonth: d.depositAsLastMonth, agreedCharges: d.agreedCharges, sellProducts: d.sellProducts, noPoach: d.noPoach,
            insurance: d.insurance, licenseRequired: d.licenseRequired, changesNeedOk: d.changesNeedOk, damageByRenter: d.damageByRenter, propertyClause: d.propertyClause,
            offersModes: offers.modes, offersPrices: offers.prices,
            // What the lease says about late rent and time away, so a later change to those settings can't make it
            // stricter for them (lib/collections-policy, lib/leave-policy).
            collections: { autoBarAfterDaysLate: ctx.collections.autoBarAfterDaysLate ?? null }, leave: { offered: ctx.leave.offered, reducedPercent: ctx.leave.reducedPercent, maxWeeks: ctx.leave.maxWeeks },
          },
        },
      });
      // Signed on paper and started now: what the lease says comes with the space is theirs until its term ends (with no
      // end date, until a change is announced). One signed in the portal is kept as they sign (api/portal/renter).
      if (!sign && !own.on) {
        const so = signedOffersFrom(offers.modes, offers.prices, d.endDate || null, { leaseId, at: new Date().toISOString(), from: 'lease' });
        if (so) await updateDoc(doc(p.firestore, `tenants/${tenantId}/renters/${renter.id}`), { signedOffers: so }).catch(() => { keptNote += ' What comes with their space wasn’t saved with the lease, so a later change to What renters get applies to them straight away.'; });
      }
      // A notice address typed here is kept on the renter for next time.
      if (d.renterNoticeAddress.trim() && d.renterNoticeAddress.trim() !== String(renter?.noticeAddress || '')) {
        await updateDoc(doc(p.firestore, `tenants/${tenantId}/renters/${renter.id}`), { noticeAddress: d.renterNoticeAddress.trim() }).catch(() => {});
      }
      let said = (sign ? 'Sent for their signature. Rent starts billing once they sign.' : 'Lease made. Rent bills on its schedule.') + keptNote;
      if (invite) {
        try {
          const r = await fetch('/api/booths/notify', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) },
            body: JSON.stringify({ action: 'portal-invite', tenantId, renterId: renter.id, reason: sign ? 'lease' : 'welcome' }) });
          const x: any = await r.json().catch(() => ({}));
          const how = [x?.status === 'sent' ? 'email' : '', x?.sms === 'sent' ? 'text' : ''].filter(Boolean).join(' and ');
          said += x?.ok && how ? ` Their portal link went by ${how}.` : ' Their portal link wasn’t sent. Send it from their profile.';
        } catch { said += ' Their portal link wasn’t sent. Send it from their profile.'; }
      }
      try { localStorage.removeItem(draftKey); } catch { /* fine */ }
      p.onCreated(leaseId, said);
    } catch (e: any) {
      setErr(e?.message ? String(e.message) : 'That didn’t save. Try again.');
    }
    setBusy(false); busyRef.current = false;
  };

  const sectionsHere = step < 5 ? built.sections.filter((s) => STEP_SECTIONS[step].includes(s.key)) : [];
  const who = d.renterName.split(' ')[0] || 'them';

  return createPortal(
    <div ref={boxRef} role="dialog" aria-modal="true" aria-labelledby="lb-title" className="fixed inset-0 z-50 overflow-y-auto bg-[#f5f5f7] text-[#16171a]" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div ref={topRef} className="mx-auto max-w-[1120px] px-4 pb-16 pt-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 id="lb-title" ref={titleRef} tabIndex={-1} className="text-[22px] font-bold leading-8 outline-none focus-visible:outline-none">New lease for {d.renterName || 'this renter'}</h1>
            <p className={hint}>Step {step + 1} of 6 · kept as a draft on this device</p>
          </div>
          <button type="button" onClick={close} disabled={busy} className={btn}>Close</button>
        </div>
        <ol className="my-5 grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? 'step' : undefined}>
              <button type="button" disabled={!reachable(i)} onClick={() => go(i)} className={`min-h-[44px] w-full border-t-[3px] pt-2 text-left text-[13px] disabled:cursor-not-allowed ${i === step ? 'border-[#16171a] font-semibold text-[#16171a]' : i < step && valid[i] ? 'border-[#1f7a4d] text-[#6d7075]' : 'border-[#d9d9de] text-[#6d7075]'}`}>{s}{i !== step && i < step && valid[i] && <span className="sr-only">, done</span>}</button>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap items-start gap-6">
          <div className="min-w-0 flex-[999_1_560px] space-y-4">
            {step === 0 && (<>
              <section className={card} aria-labelledby="lb-who">
                <h2 id="lb-who" className="text-[17px] font-bold">Who it’s between</h2>
                <p className={hint}>Legal names matter: use the name on the business license or tax filing.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="lb-biz" label="Your business (legal name)" note="Kept for every lease"><input id="lb-biz" className={input} value={policy.legalName} onChange={(e) => setPolicy({ ...policy, legalName: e.target.value.slice(0, 120) })} /></Field>
                  <Field id="lb-ren" label="Renter"><input id="lb-ren" className={input} value={d.renterName} onChange={(e) => set('renterName', e.target.value.slice(0, 120))} /></Field>
                  <Field id="lb-dba" label="Their business name (if any)"><input id="lb-dba" className={input} value={d.renterBusinessName} onChange={(e) => set('renterBusinessName', e.target.value.slice(0, 120))} /></Field>
                  <Field id="lb-addr" label="Their address for notices" note={d.renterNoticeAddress.trim() ? undefined : 'Needed so written notices have somewhere to go'} warn><input id="lb-addr" className={input} value={d.renterNoticeAddress} placeholder="Street, city, state" onChange={(e) => set('renterNoticeAddress', e.target.value.slice(0, 200))} /></Field>
                </div>
              </section>
              <section className={card} aria-labelledby="lb-space">
                <h2 id="lb-space" className="text-[17px] font-bold">The space</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="lb-sp" label="Space" note={!freeBooths.length ? 'No free spaces right now.' : undefined} warn>
                    <select id="lb-sp" className={input} value={boothId} onChange={(e) => pickBooth(e.target.value)}>
                      <option value="">Choose a space</option>
                      {freeBooths.map((b) => <option key={b.id} value={b.id}>{b.name}{b.type ? ` · ${b.type}` : ''}</option>)}
                    </select>
                  </Field>
                  <Field id="lb-hours" label="Access hours"><input id="lb-hours" className={input} value={d.accessHours} placeholder="Monday to Saturday, 7:00 AM to 10:00 PM" onChange={(e) => set('accessHours', e.target.value.slice(0, 120))} /></Field>
                </div>
                <Toggle on={d.isShared} onChange={(v) => set('isShared', v)} label="Shared with other renters" sub="They use it on set days or times" />
                {clash && <p role="alert" className="text-[14px] text-[#b45309]">{clash}</p>}
                {d.isShared && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Their days">
                      {DAYS.map((n, i) => { const on = !!d.slot?.days?.includes(i); return (
                        <button key={n} type="button" aria-pressed={on} onClick={() => { const cur = d.slot?.days || []; set('slot', { ...(d.slot || {}), days: on ? cur.filter((x) => x !== i) : [...cur, i] }); }}
                          className={`h-11 min-w-[52px] rounded-full border px-3 text-[14px] font-medium ${on ? 'border-[#16171a] bg-[#16171a] text-white' : 'border-[#ececee] bg-white'}`}>{n}</button>); })}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field id="lb-st" label="From (optional)"><input id="lb-st" type="time" className={input} value={d.slot?.startTime || ''} onChange={(e) => set('slot', { days: d.slot?.days || [], ...(d.slot || {}), startTime: e.target.value })} /></Field>
                      <Field id="lb-et" label="To (optional)"><input id="lb-et" type="time" className={input} value={d.slot?.endTime || ''} onChange={(e) => set('slot', { days: d.slot?.days || [], ...(d.slot || {}), endTime: e.target.value })} /></Field>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <p className={lbl}>Comes with it</p>
                  <div className="flex flex-wrap gap-2">
                    {d.amenities.map((a) => <button key={a} type="button" onClick={() => set('amenities', d.amenities.filter((x) => x !== a))} aria-label={`Remove ${a}`} className="h-11 rounded-full border border-[#16171a] bg-[#16171a] px-4 text-[14px] text-white">{a}</button>)}
                    <AddChip onAdd={(v) => set('amenities', [...d.amenities, v])} />
                  </div>
                </div>
                <Row label="Door code or key" sub="Issued to them, never shared">
                  <select aria-label="Door code or key" className={`${input} sm:w-48`} value={d.keyType} onChange={(e) => set('keyType', e.target.value as any)}>
                    <option value="own_code">Own door code</option><option value="own_key">Own key</option><option value="shared_code">Shared code</option><option value="none">Not needed</option>
                  </select>
                </Row>
              </section>
              <section className={card} aria-labelledby="lb-term">
                <h2 id="lb-term" className="text-[17px] font-bold">How long, and how it ends</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="lb-start" label="Starts"><input id="lb-start" type="date" className={input} value={d.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
                  <Field id="lb-len" label="Length">
                    <select id="lb-len" className={input} value={length} onChange={(e) => setLength(e.target.value as any)}>
                      <option value="6">6 months</option><option value="12">12 months</option><option value="24">24 months</option><option value="open">No end date</option><option value="custom">Until a date</option>
                    </select>
                  </Field>
                  {length === 'custom' && <Field id="lb-end" label="Ends"><input id="lb-end" type="date" className={input} value={d.endDate || ''} onChange={(e) => set('endDate', e.target.value || null)} /></Field>}
                </div>
                {d.endDate && <p className={hint}>Runs to {shortDate(d.endDate)}.</p>}
                {d.endDate && <Toggle on={d.autoRenew} onChange={(v) => set('autoRenew', v)} label="Renews on its own" sub="For the same length, unless either side gives notice" />}
                <Row label="Notice to not renew, or to end early" sub="Either side, in writing through the portal or email">
                  <select aria-label="Notice days" className={`${input} sm:w-36`} value={d.noticeDays} onChange={(e) => set('noticeDays', Number(e.target.value))}>{[7, 14, 30, 60, 90].map((n) => <option key={n} value={n}>{n} days</option>)}</select>
                </Row>
                <Row label="Fee for ending early" sub={d.endDate ? 'Only when the renter leaves before the end date without giving the notice' : 'Only when the renter leaves without giving the notice'}>
                  <select aria-label="Early end fee" className={`${input} sm:w-52`} value={d.earlyEndFee} onChange={(e) => set('earlyEndFee', e.target.value as any)}><option value="none">None</option><option value="one_period">One period’s rent</option></select>
                </Row>
                {d.endDate && !d.autoRenew && <Row label="If they stay past the end without renewing" sub="What you may charge for each period they stay, until they leave or sign a renewal">
                  <select aria-label="Holdover rent" className={`${input} sm:w-52`} value={d.holdover} onChange={(e) => set('holdover', e.target.value as any)}><option value="same">Same rent</option><option value="plus10">Rent plus 10%</option></select>
                </Row>}
              </section>
            </>)}

            {step === 1 && (<>
              <section className={card} aria-labelledby="lb-rent">
                <h2 id="lb-rent" className="text-[17px] font-bold">Rent</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field id="lb-amt" label="Amount"><MoneyInput id="lb-amt" value={d.rentCents} placeholder="0" onChange={(c) => set('rentCents', c)} /></Field>
                  <Field id="lb-freq" label="Every"><select id="lb-freq" className={input} value={d.frequency} onChange={(e) => set('frequency', e.target.value as any)}><option value="monthly">Month</option><option value="weekly">Week</option><option value="biweekly">Two weeks</option><option value="daily">Day</option></select></Field>
                  {d.frequency === 'monthly' && <Field id="lb-due" label="Due on"><select id="lb-due" className={input} value={d.dueDay} onChange={(e) => set('dueDay', Number(e.target.value))}>{Array.from({ length: 28 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>The {n}{n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}</option>)}</select></Field>}
                </div>
                {d.frequency === 'monthly' && <Toggle on={d.prorateFirst} onChange={(v) => set('prorateFirst', v)} label="Bill the first part-month by the day" sub={fb && fb.prorated && fb.nextDue ? `First bill ${usd(fb.cents)} on ${shortDate(fb.due)}, then ${usd(d.rentCents)} on ${shortDate(fb.nextDue)}` : 'Off: the first bill is a full month'} />}
                <Row label="Rent changes" sub={d.endDate ? 'Only at renewal, with written notice first' : 'With written notice first'}>
                  <select aria-label="Rent change notice" className={`${input} sm:w-44`} value={d.rentChangeNoticeDays} onChange={(e) => set('rentChangeNoticeDays', Number(e.target.value))}>{[30, 60, 90].map((n) => <option key={n} value={n}>{n} days’ notice</option>)}</select>
                </Row>
              </section>
              <section className={card} aria-labelledby="lb-late">
                <h2 id="lb-late" className="text-[17px] font-bold">Late and missed payments</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field id="lb-grace" label="Grace days"><select id="lb-grace" className={input} value={d.graceDays} onChange={(e) => set('graceDays', Number(e.target.value))}>{[0, 1, 2, 3, 5, 7, 10].map((n) => <option key={n} value={n}>{n === 0 ? 'None' : `${n} day${n === 1 ? '' : 's'}`}</option>)}</select></Field>
                  <Field id="lb-fee" label="Late fee, once per bill">
                    <select id="lb-fee" className={input} value={d.lateFee ? d.lateFee.type : 'none'} onChange={(e) => set('lateFee', e.target.value === 'none' ? null : e.target.value === 'percent' ? { type: 'percent', percent: 5 } : { type: 'flat', amountCents: 2500 })}>
                      <option value="flat">A set amount</option><option value="percent">A percentage</option><option value="none">No late fee</option>
                    </select>
                  </Field>
                  {d.lateFee && <Field id="lb-feeamt" label={d.lateFee.type === 'flat' ? 'Amount' : 'Percent of the bill'}>
                    {d.lateFee.type === 'flat'
                      ? <MoneyInput id="lb-feeamt" value={d.lateFee.amountCents || 0} onChange={(c) => set('lateFee', { type: 'flat', amountCents: c })} />
                      : <NumberInput id="lb-feeamt" value={Number(d.lateFee.percent) || 0} max={50} onChange={(n) => set('lateFee', { type: 'percent', percent: n })} />}
                  </Field>}
                </div>
                <Row label="Declined payment fee" sub="You may add it when a card or bank payment is declined or returned">
                  <select aria-label="Declined payment fee" className={`${input} sm:w-36`} value={d.declinedFeeCents} onChange={(e) => set('declinedFeeCents', Number(e.target.value))}>{[0, 1500, 2500, 3500].map((c) => <option key={c} value={c}>{c ? usd(c) : 'None'}</option>)}</select>
                </Row>
                <p className={hint}>Some states cap late fees on space rentals. Your attorney can confirm the limit where you are.</p>
              </section>
              <section className={card} aria-labelledby="lb-pay">
                <h2 id="lb-pay" className="text-[17px] font-bold">How they pay</h2>
                <Toggle on={d.payByCard} onChange={(v) => set('payByCard', v)} label="Card in their portal" sub="Paid to your own payments account" />
                <Toggle on={d.payByAutopay} onChange={(v) => set('payByAutopay', v)} label="Autopay, if they choose it" sub="They turn it on themselves, which signs a separate authorization" />
                <Toggle on={d.payOffline} onChange={(v) => set('payOffline', v)} label="Cash, check or transfer" sub="You record it; they get a receipt" />
              </section>
              <section className={card} aria-labelledby="lb-dep">
                <h2 id="lb-dep" className="text-[17px] font-bold">Deposit</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field id="lb-depamt" label="Amount"><MoneyInput id="lb-depamt" value={d.depositCents} placeholder="None" onChange={(c) => set('depositCents', c)} /></Field>
                  <Field id="lb-depref" label="Refundable"><select id="lb-depref" className={input} value={d.depositRefundable ? 'yes' : 'no'} onChange={(e) => set('depositRefundable', e.target.value === 'yes')}><option value="yes">Yes</option><option value="no">No</option></select></Field>
                  {d.depositRefundable && <Field id="lb-depdays" label="Returned within"><select id="lb-depdays" className={input} value={d.depositReturnDays} onChange={(e) => set('depositReturnDays', Number(e.target.value))}>{[7, 14, 21, 30, 45].map((n) => <option key={n} value={n}>{n} days of move-out</option>)}</select></Field>}
                </div>
                {d.depositCents > 0 && d.depositRefundable && <Toggle on={d.depositAsLastMonth} onChange={(v) => set('depositAsLastMonth', v)} label="Can be used as the last rent payment, if you both agree" sub="Off: rent is paid as usual and the deposit is settled at move-out" />}
              </section>
              <section className={card} aria-labelledby="lb-chg">
                <h2 id="lb-chg" className="text-[17px] font-bold">Agreed charges</h2>
                <p className={hint}>From your agreed-charges list. Only these can be charged to a saved card, never above the cap, always with a reason.</p>
                <ul className="divide-y divide-[#ececee]">{d.agreedCharges.map((c) => <li key={c.label} className="flex justify-between gap-3 py-2 text-[14px]"><span>{c.label}</span><span className="text-[#6d7075]">up to {usd(c.capCents)}</span></li>)}</ul>
              </section>
              <Perks perks={perks} onChange={setPerks} frequency={d.frequency} />
            </>)}

            {step === 2 && (<>
              <section className={card} aria-labelledby="lb-own">
                <h2 id="lb-own" className="text-[17px] font-bold">What makes it their business</h2>
                <p className={hint}>In every lease, and can’t be switched off. They protect you from the renter being treated as your employee, and protect the renter’s right to run things their way.</p>
                <ul className="space-y-2 text-[15px]">
                  {['They set their own prices and services', 'They choose their own hours, inside the access hours', 'They keep their own clients and client records', 'They take their own payments and pay their own taxes', 'They supply their own tools and products, and use their own name and branding', 'No commission, split or wages either way, and you don’t train or supervise how they work'].map((t) => <li key={t} className="border-t border-[#ececee] pt-2 first:border-t-0 first:pt-0">{t}</li>)}
                </ul>
              </section>
              <section className={card} aria-labelledby="lb-choices">
                <h2 id="lb-choices" className="text-[17px] font-bold">Choices for this lease</h2>
                <Row label="Taking bookings" sub="They can list on your booking page or use their own system. It’s their choice, in their portal."><span className="text-[14px] font-semibold">Their choice</span></Row>
                <Toggle on={d.sellProducts} onChange={(v) => set('sellProducts', v)} label="Selling their own products" sub="In the space, and in your online shop under their name" />
                <Row label="Portal tools" sub="Packages, gift cards, campaigns and swap days, as set in What renters get on the Rent page. Your draft is kept if you go there."><a href="/rent#what-renters-get" className="inline-flex h-11 items-center rounded-full border border-[#ececee] px-4 text-[14px] font-medium">Open What renters get</a></Row>
                <Toggle on={d.noPoach} onChange={(v) => set('noPoach', v)} label="No hiring away your team" sub="Off by default. Some states limit these promises; ask your attorney before turning it on." />
              </section>
              <ClassificationCheck renter={renter} />
            </>)}

            {step === 3 && (<>
              <section className={card} aria-labelledby="lb-ins">
                <h2 id="lb-ins" className="text-[17px] font-bold">Insurance</h2>
                <Toggle on={d.insurance.required} onChange={(v) => set('insurance', { ...d.insurance, required: v })} label="Liability insurance required" sub="Professional and general liability, uploaded in their portal before the start date" />
                {d.insurance.required && (<>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="lb-perc" label="Minimum per claim"><MoneyInput id="lb-perc" value={d.insurance.perClaimCents} onChange={(c) => set('insurance', { ...d.insurance, perClaimCents: c })} /></Field>
                    <Field id="lb-pery" label="Minimum per year"><MoneyInput id="lb-pery" value={d.insurance.perYearCents} onChange={(c) => set('insurance', { ...d.insurance, perYearCents: c })} /></Field>
                  </div>
                  <Toggle on={d.insurance.additionalInsured} onChange={(v) => set('insurance', { ...d.insurance, additionalInsured: v })} label="Name your business as additional insured" sub="Their policy then also covers claims made against you for their work" />
                  <Row label="If coverage lapses" sub="After this much written notice you may pause their bookings, until a current copy is on file">
                    <select aria-label="Lapse notice" className={`${input} sm:w-40`} value={d.insurance.lapseNoticeDays} onChange={(e) => set('insurance', { ...d.insurance, lapseNoticeDays: Number(e.target.value) })}>{[3, 7, 14, 30].map((n) => <option key={n} value={n}>{n} days’ notice</option>)}</select>
                  </Row>
                </>)}
              </section>
              <section className={card} aria-labelledby="lb-lic">
                <h2 id="lb-lic" className="text-[17px] font-bold">Licenses</h2>
                <Toggle on={d.licenseRequired} onChange={(v) => set('licenseRequired', v)} label="Any license their work requires" sub="Kept current, uploaded with its expiry date, and displayed where their board requires it" />
              </section>
              <section className={card} aria-labelledby="lb-care">
                <h2 id="lb-care" className="text-[17px] font-bold">Care of the space</h2>
                <Row label="House rules" sub={rules && !rules.length ? 'None published for renters yet. Publish them in Documents, for renters.' : 'Attached to the lease and signed with it'}>
                  <select aria-label="House rules" className={`${input} sm:w-60`} value={d.houseRules || ''} onChange={(e) => set('houseRules', e.target.value || null)} disabled={!rules?.length}>
                    <option value="">None attached</option>{(rules || []).map((r) => <option key={r.id} value={r.label}>{r.label}</option>)}
                  </select>
                </Row>
                <Toggle on={d.changesNeedOk} onChange={(v) => set('changesNeedOk', v)} label="Changes to the space need your written OK" sub="No painting, fixtures or wiring without it" />
                <Toggle on={d.damageByRenter} onChange={(v) => set('damageByRenter', v)} label="They pay for damage beyond normal wear" sub="From the deposit or as an agreed charge, with photos" />
                <Toggle on={d.propertyClause} onChange={(v) => set('propertyClause', v)} label="Their things left in the space are theirs to look after" sub="Unless lost or damaged through your own carelessness" />
              </section>
              <section className={card} aria-labelledby="lb-resp">
                <h2 id="lb-resp" className="text-[17px] font-bold">Responsibility and client information</h2>
                <Row label="Each side covers its own actions" sub="You answer for your business and team, they answer for their work and clients"><span className="text-[14px] font-semibold">Always in</span></Row>
                <Row label="Their client information stays theirs" sub="You won’t market to their clients or share their records"><span className="text-[14px] font-semibold">Always in</span></Row>
              </section>
            </>)}

            {step === 4 && (
              <section className={card} aria-labelledby="lb-pol">
                <h2 id="lb-pol" className="text-[17px] font-bold">Your policies, written into the lease</h2>
                <p className={hint}>These come from the settings the app runs on, so it does exactly what the lease says. Changing one changes new leases; a signed lease keeps what was signed.</p>
                <ul className="divide-y divide-[#ececee]">
                  {built.sections.filter((s) => STEP_SECTIONS[4].includes(s.key)).map((s) => (
                    <li key={s.key} className="py-3"><p className="text-[15px] font-semibold">{s.title}</p><p className="text-[14px] leading-relaxed text-[#6d7075]">{s.text}</p></li>
                  ))}
                </ul>
                <p className={hint}>Repairs are set in Maintenance; time away, collections and closures on the Rent page; concerns, rule breaks and the rest in your lease settings.</p>
              </section>
            )}

            {step === 5 && (<>
              <section className={card} aria-labelledby="lb-key">
                <h2 id="lb-key" className="text-[17px] font-bold">Key terms</h2>
                <p className={hint}>Printed at the top of the lease, so neither side can miss the main points.</p>
                <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[14px]">
                  {built.keyTerms.map((k) => <React.Fragment key={k.label}><dt className="text-[#6d7075]">{k.label}</dt><dd className="m-0">{k.text}</dd></React.Fragment>)}
                </dl>
              </section>
              <section className={card} aria-labelledby="lb-legal">
                <h2 id="lb-legal" className="text-[17px] font-bold">Legal basics</h2>
                <p className={hint}>Filled in for you. Change them only if your attorney says to. They’re kept for every lease.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="lb-state" label="Which state’s law" note={policy.governingState ? undefined : 'Usually the state where the space is'} warn><input id="lb-state" className={input} value={policy.governingState} placeholder="State" onChange={(e) => setPolicy({ ...policy, governingState: e.target.value.slice(0, 40) })} /></Field>
                  <Field id="lb-county" label="County for any court case"><input id="lb-county" className={input} value={policy.county} placeholder="Where the space is" onChange={(e) => setPolicy({ ...policy, county: e.target.value.slice(0, 60) })} /></Field>
                </div>
                <p className={hint}>Disagreements: {policy.disputeTalkDays} days to talk it through{policy.mediation ? ', then mediation' : ''}, then small claims or the courts. Written notice: a portal message or an email. Signing electronically: they agree to it, can get a paper copy free, and can withdraw that agreement in writing.</p>
              </section>
              <section className={card} aria-labelledby="lb-check">
                <h2 id="lb-check" className="text-[17px] font-bold">Before you send</h2>
                <ul className="space-y-2">
                  {checks.map((c) => (
                    <li key={c.text} className="flex flex-wrap items-center justify-between gap-2 text-[15px]">
                      <span className={c.ok ? 'text-[#16171a]' : 'text-[#b45309]'}>{c.text}</span>
                      {!c.ok && c.fix === 'address' && <button type="button" className={btn} onClick={() => go(0)}>Add it</button>}
                      {!c.ok && c.fix === 'amounts' && <button type="button" className={btn} onClick={() => go(1)}>Fix it</button>}
                      {!c.ok && c.fix === 'rules' && <button type="button" className={btn} onClick={() => go(3)}>Attach them</button>}
                      {!c.ok && c.fix === 'review' && !review.open && <button type="button" className={btn} onClick={() => setReview({ ...review, open: true })}>Record a review</button>}
                    </li>
                  ))}
                </ul>
                {review.open && (
                  <div className="space-y-3 rounded-2xl bg-[#f5f5f7] p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field id="lb-rvby" label="Attorney or firm"><input id="lb-rvby" className={input} value={review.by} onChange={(e) => setReview({ ...review, by: e.target.value.slice(0, 120) })} /></Field>
                      <Field id="lb-rvat" label="Reviewed on"><input id="lb-rvat" type="date" className={input} value={review.at} onChange={(e) => setReview({ ...review, at: e.target.value })} /></Field>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" className={dark} disabled={!review.by.trim() || !review.at} onClick={() => { setPolicy({ ...policy, attorneyReview: { at: review.at, by: review.by.trim() } }); setReview({ ...review, open: false }); }}>Record it</button>
                      <button type="button" className={btn} onClick={() => setReview({ ...review, open: false })}>Not now</button>
                    </div>
                  </div>
                )}
                <p className={hint}>This lease is a starting point, not legal advice. Have an attorney in your state review it once; record the review and it’s noted on every lease made from it.</p>
              </section>
              <section className={card} aria-labelledby="lb-send">
                <h2 id="lb-send" className="text-[17px] font-bold">Signing</h2>
                <Toggle on={sign} onChange={setSign} label={`Ask ${who} to sign before it starts`} sub="They read it and sign in their portal. Nothing is billed until they do." />
                {!sign && p.uploadSigned && (
                  <Field id="lb-paper" label="Signed on paper? Attach it (optional)"><input id="lb-paper" type="file" accept="application/pdf,image/*" className="block w-full text-[14px]" onChange={(e) => setPaper(e.target.files?.[0] || null)} /></Field>
                )}
                <Toggle on={invite} onChange={setInvite} label="Send their portal link now" sub={sign ? 'By email and text: their lease is ready to sign' : 'By email and text: to see their rent and save a card'} />
                <Toggle on={own.on} onChange={(v) => setOwn({ ...own, on: v })} label="Use your attorney’s own lease instead" sub="Paste its words; they’re what gets signed. Perks set here aren’t added, so put any in that lease." />
                {own.on && perks.length > 0 && <p className="text-[14px] text-[#b45309]">The {perks.length === 1 ? 'perk' : `${perks.length} perks`} you set in Rent and money won’t be added. Put {perks.length === 1 ? 'it' : 'them'} in your attorney’s lease if you want {perks.length === 1 ? 'it' : 'them'}.</p>}
                {own.on && <textarea aria-label="Your attorney’s lease" rows={8} className="w-full rounded-xl border border-[#ececee] p-3 text-[14px] leading-relaxed" value={own.text} onChange={(e) => setOwn({ ...own, text: e.target.value.slice(0, 60000) })} placeholder="Paste the whole lease here" />}
                {sign && (
                  <div className="space-y-2 border-t border-[#ececee] pt-4">
                    <Field id="lb-bizsig" label={`Sign for ${ctx.businessName || 'the business'}`}>
                      <input id="lb-bizsig" className={input} value={bizSig} autoComplete="name" placeholder="Type your full name" onChange={(e) => setBizSig(e.target.value.slice(0, 120))} />
                    </Field>
                    <p className={hint}>Typing your name and sending it is the business’s signature, recorded with the time and the lease’s exact words. {who === 'them' ? 'They sign' : `${who} signs`} second, in their portal; then you both get a signed copy by email.</p>
                  </div>
                )}
              </section>
            </>)}

            {err && <p role="alert" className="text-[14px] text-[#b45309]">{err}</p>}
            <div className="flex flex-wrap justify-between gap-3 pt-2">
              {step > 0 ? <button type="button" className={btn} onClick={() => go(step - 1)}>Back</button> : <button type="button" className={btn} onClick={close} disabled={busy}>Save draft and close</button>}
              {step < 5
                ? <button type="button" className={dark} disabled={!valid[step]} onClick={() => go(step + 1)}>Next: {STEPS[step + 1].toLowerCase()}</button>
                : <button type="button" className={dark} disabled={busy || !valid.every(Boolean)} onClick={() => void create()}>{busy ? 'Saving…' : sign ? `Send to ${who} to sign` : 'Create lease'}</button>}
            </div>
            {!valid[step] && step < 5 && <p className={hint}>{step === 0 ? (clash || 'Choose a space and a start date (and an end date after it).') : 'Enter the rent.'}</p>}
            {step === 5 && !valid.every(Boolean) && <p className={hint}>{!valid[0] ? 'Something in Space and term still needs filling in.' : !valid[1] ? 'The rent in Rent and money still needs filling in.' : own.on && own.text.trim().length <= 40 ? 'Paste your attorney’s lease, or switch that off.' : 'Type your name to sign for the business.'}</p>}
          </div>

          <aside aria-label="What the lease will say" className="min-w-0 flex-[1_1_360px] space-y-3 rounded-[20px] border border-[#ececee] bg-white p-5">
            <p className="text-[13px] font-semibold text-[#6d7075]">{step < 5 ? 'What the lease will say' : 'The whole lease'}</p>
            {step < 5 ? sectionsHere.map((s) => (
              <div key={s.key}>
                <h3 className="text-[14px] font-bold">{s.n}. {s.title}</h3>
                <p className="text-[14px] leading-relaxed">{s.text}</p>
                {s.short && <p className="mt-1 text-[13px] text-[#1f7a4d]">{s.short}</p>}
              </div>
            )) : (<>
              <p className="text-[15px] font-semibold">{built.title}</p>
              <p className={hint}>{built.heading}</p>
              <ol className="list-decimal space-y-0.5 pl-5 text-[14px]">{built.sections.map((s) => <li key={s.key}>{s.title}</li>)}</ol>
              <button type="button" className={btn} onClick={() => setShowText(!showText)} aria-expanded={showText}>{showText ? 'Hide the full text' : 'Read the full text'}</button>
              {showText && <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-xl bg-[#f5f5f7] p-3 font-sans text-[13px] leading-relaxed">{own.on ? own.text : built.text}</pre>}
            </>)}
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function AddChip({ onAdd }: { onAdd: (v: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState('');
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="h-11 rounded-full border border-[#ececee] bg-white px-4 text-[14px]">Add item</button>;
  const done = () => { if (v.trim()) onAdd(v.trim().slice(0, 60)); setV(''); setOpen(false); };
  return (
    <span className="flex gap-2">
      <input aria-label="What comes with it" autoFocus className={`${input} w-44`} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') done(); }} />
      <button type="button" className={btn} onClick={done}>Add</button>
    </span>
  );
}

/** How the renter's setup in the app looks against the lease (agencies look at what happens day to day, not only at
 *  the paperwork). */
function ClassificationCheck({ renter }: { renter: any }) {
  const ownPayments = !!renter?.stripeAccountId && renter?.stripeChargesEnabled === true;
  const items: { ok: boolean; text: string; note?: string }[] = [
    { ok: true, text: 'Rent is a flat amount, with no split' },
    { ok: true, text: 'Their prices are set in their own portal, not by you' },
    { ok: true, text: 'They aren’t on your team schedule or payroll' },
    ownPayments
      ? { ok: true, text: 'Their clients’ card payments go to their own account' }
      : { ok: false, text: 'Their clients’ card payments come to your account until they connect their own', note: 'That can read as you collecting their pay. They can connect payments in their portal, under Business setup, in a few minutes.' },
  ];
  return (
    <section className={card} aria-labelledby="lb-class">
      <h2 id="lb-class" className="text-[17px] font-bold">Classification check</h2>
      <p className={hint}>How their setup in the app looks against the lease today.</p>
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.text} className="border-t border-[#ececee] pt-2 text-[15px] first:border-t-0 first:pt-0">
            <span className={i.ok ? 'text-[#16171a]' : 'text-[#b45309]'}>{i.text}</span>
            {i.note && <span className={`block ${hint}`}>{i.note}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Perks written into the lease: a free week, a percentage off one bill, or a set credit, given as a credit on their
 *  rent account when each is due (lib/lease-perks). */
function Perks({ perks, onChange, frequency }: { perks: BuilderPerk[]; onChange: (p: BuilderPerk[]) => void; frequency: string }) {
  const [add, setAdd] = React.useState<{ type: BuilderPerkType; trigger: BuilderPerkTrigger; label: string; cents: number; pct: number } | null>(null);
  const ok = !!add && (add.type === 'free_week' || (add.type === 'rent_discount' ? add.pct > 0 : add.cents > 0));
  return (
    <section className={card} aria-labelledby="lb-perks">
      <h2 id="lb-perks" className="text-[17px] font-bold">Perks</h2>
      <p className={hint}>Optional. Each is a credit on their rent account the day it’s due, and comes off their next bills. The lease lists them.</p>
      {perks.length > 0 && <ul className="divide-y divide-[#ececee]">{perks.map((x) => (
        <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[14px]">
          <span className="min-w-0 flex-1">{perkWords(x, frequency, usd)}</span>
          <button type="button" className={btn} onClick={() => onChange(perks.filter((y) => y.id !== x.id))} aria-label={`Remove ${x.label || 'this perk'}`}>Remove</button>
        </li>))}</ul>}
      {!add ? <button type="button" className={btn} onClick={() => setAdd({ type: 'free_week', trigger: 'on_signup', label: '', cents: 0, pct: 10 })}>Add a perk</button> : (
        <div className="space-y-3 rounded-2xl bg-[#f5f5f7] p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="lb-pk-type" label="Kind"><select id="lb-pk-type" className={input} value={add.type} onChange={(e) => setAdd({ ...add, type: e.target.value as BuilderPerkType })}>{BUILDER_PERK_TYPES.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></Field>
            <Field id="lb-pk-when" label="When"><select id="lb-pk-when" className={input} value={add.trigger} onChange={(e) => setAdd({ ...add, trigger: e.target.value as BuilderPerkTrigger })}>{BUILDER_PERK_TRIGGERS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></Field>
            <Field id="lb-pk-label" label="Name (optional)"><input id="lb-pk-label" className={input} value={add.label} placeholder="Welcome week" onChange={(e) => setAdd({ ...add, label: e.target.value.slice(0, 60) })} /></Field>
            {add.type === 'rent_discount' && <Field id="lb-pk-pct" label="Percent off one bill"><NumberInput id="lb-pk-pct" value={add.pct} max={100} onChange={(n) => setAdd({ ...add, pct: n })} /></Field>}
            {add.type === 'custom' && <Field id="lb-pk-amt" label="Credit"><MoneyInput id="lb-pk-amt" value={add.cents} onChange={(c) => setAdd({ ...add, cents: c })} /></Field>}
          </div>
          <div className="flex gap-2">
            <button type="button" className={dark} disabled={!ok} onClick={() => { if (!ok) return; onChange([...perks, { id: `perk_${Date.now().toString(36)}`, type: add.type, trigger: add.trigger, label: add.label.trim(), ...(add.type === 'rent_discount' ? { valuePercent: add.pct } : {}), ...(add.type === 'custom' ? { valueCents: add.cents } : {}) }]); setAdd(null); }}>Add it</button>
            <button type="button" className={btn} onClick={() => setAdd(null)}>Not now</button>
          </div>
        </div>
      )}
    </section>
  );
}
