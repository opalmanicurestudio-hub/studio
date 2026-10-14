'use client';
// The till: open it with a counted float, close it with a count, what stays for tomorrow, the bank deposit,
// PIN and signature (plus a witness when the business asks), and the deposit slip. In the front desk's look.

import { verifyPin } from '@/lib/pin-client';
import { useTenant } from '@/context/TenantContext';
import React, { useState, useMemo, useRef } from 'react';
import { safeNumber } from '@/lib/utils';
import { type TillSession, type Staff } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { format, parseISO, startOfDay, subDays } from 'date-fns';
import SignatureCanvas from 'react-signature-canvas';
import { useInventory } from '@/context/InventoryContext';
import { Drawer, Icon, Seg } from '@/components/pos/desk/kit';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') { try { return parseISO(val); } catch { return new Date(val); } }
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};
const money = (n: any) => `$${safeNumber(n).toFixed(2)}`;

const denominations = [
    { key: 'bills_100', label: '$100', val: 100, kind: 'bill' },
    { key: 'bills_50', label: '$50', val: 50, kind: 'bill' },
    { key: 'bills_20', label: '$20', val: 20, kind: 'bill' },
    { key: 'bills_10', label: '$10', val: 10, kind: 'bill' },
    { key: 'bills_5', label: '$5', val: 5, kind: 'bill' },
    { key: 'bills_1', label: '$1', val: 1, kind: 'bill' },
    { key: 'coins_25', label: '25¢', val: 0.25, kind: 'coin' },
    { key: 'coins_10', label: '10¢', val: 0.10, kind: 'coin' },
    { key: 'coins_05', label: '5¢', val: 0.05, kind: 'coin' },
    { key: 'coins_01', label: '1¢', val: 0.01, kind: 'coin' },
];

const muted = { color: 'var(--muted)' } as React.CSSProperties;
const box = { border: '1px solid var(--line)', background: 'var(--card)' } as React.CSSProperties;

const DenominationInput = ({ denom, count, onChange, disabled, subtitle }: any) => (
    <div className="flex items-center gap-3 rounded-2xl px-3 py-2.5" style={box}>
        <span className="flex h-9 w-12 shrink-0 items-center justify-center rounded-xl text-[13px] font-semibold tabular-nums" style={{ background: 'var(--soft)' }}>{denom.label}</span>
        <span className="min-w-0 flex-1 text-[12.5px]" style={muted}>{subtitle || (denom.kind === 'bill' ? 'Bills' : 'Coins')}</span>
        <div className="flex items-center gap-1">
            <button type="button" disabled={disabled || !count} onClick={() => onChange(denom.key, Math.max(0, safeNumber(count) - 1))} aria-label={`One fewer ${denom.label}`} className="flex h-9 w-9 items-center justify-center rounded-full text-[18px] disabled:opacity-30" style={{ background: 'var(--soft)' }}>−</button>
            <input aria-label={`How many ${denom.label}`} type="number" inputMode="numeric" value={count || ''} onChange={(e) => onChange(denom.key, Math.max(0, parseInt(e.target.value) || 0))} onFocus={(e) => e.currentTarget.select()} placeholder="0" disabled={disabled}
                className="h-9 w-14 rounded-xl text-center text-[15px] font-semibold tabular-nums outline-none" style={{ background: 'var(--paper)', border: '1px solid var(--line)', color: 'var(--ink)' }} />
            <button type="button" disabled={disabled} onClick={() => onChange(denom.key, safeNumber(count) + 1)} aria-label={`One more ${denom.label}`} className="flex h-9 w-9 items-center justify-center rounded-full text-[18px] disabled:opacity-30" style={{ background: 'var(--soft)' }}>+</button>
        </div>
        <span className="w-[72px] shrink-0 text-right text-[14px] tabular-nums">{money(safeNumber(count) * denom.val)}</span>
    </div>
);

const DepositSlip = ({ session, staff, business }: { session: any; staff: Staff[]; business?: string | null }) => {
    const nameOf = (id: string) => staff.find((s) => s.id === id)?.name;
    const auditRows = denominations.map((d) => {
        const counted = safeNumber(session.closingDenominations?.[d.key] || (session.status === 'open' ? session.openingDenominations?.[d.key] : 0) || 0);
        const kept = safeNumber(session.nextDayDenominations?.[d.key] || 0);
        return { ...d, counted, kept, deposited: Math.max(0, counted - kept) };
    }).filter((r) => r.counted > 0 || r.deposited > 0);
    const staffTips = Object.entries(session.cashTipsByStaff || {}).map(([id, amount]) => ({ name: nameOf(id) || 'Team member', amount: safeNumber(amount) })).filter((t) => t.amount > 0);
    const row = (l: React.ReactNode, v: React.ReactNode, strong = false) => <div className={`flex justify-between gap-3 ${strong ? 'font-bold' : ''}`}><span>{l}</span><span className="tabular-nums">{v}</span></div>;
    const signer = (label: string, id?: string, sig?: string) => id ? <div className="space-y-1"><div className="flex justify-between"><span style={{ opacity: 0.55 }}>{label}</span><b>{nameOf(id) || '—'}</b></div>{sig && <img src={sig} alt={`${label} signature`} className="h-12 w-full object-contain" style={{ border: '1px solid #e5e5e5' }} />}</div> : null;
    return (
        <div id="deposit-slip-print" className="cf-paper mx-auto w-[320px] space-y-4 rounded-2xl bg-white p-6 text-left font-mono text-[12px] text-black" style={{ border: '1px solid #e5e5e5' }}>
            <div className="space-y-0.5 text-center">
                <p className="text-[14px] font-bold">{business || 'Deposit slip'}</p>
                <p>Till deposit slip</p>
                <p style={{ opacity: 0.55 }}>{format(safeDate(session.closedAt || session.openedAt), 'MMM d, yyyy, h:mm a')} · {String(session.id || '').slice(0, 8)}</p>
            </div>
            <div className="space-y-1 border-y border-dashed border-black py-3">
                <div className="grid grid-cols-4 gap-2 font-bold"><span>Note</span><span className="text-center">Count</span><span className="text-center">Kept</span><span className="text-right">Deposit</span></div>
                {auditRows.map((r) => <div key={r.key} className="grid grid-cols-4 gap-2"><span>{r.label}</span><span className="text-center">{r.counted}</span><span className="text-center">{r.kept}</span><span className="text-right">{money(r.deposited * r.val)}</span></div>)}
                <div className="pt-1">{row('Bank deposit', money(session.cashToDeposit || session.openingFloat), true)}</div>
            </div>
            {staffTips.length > 0 && <div className="space-y-1 border-b border-dashed border-black pb-3"><p className="font-bold">Cash tips</p>{staffTips.map((t, i) => <div key={i}>{row(t.name, money(t.amount))}</div>)}{row('Total cash tips', money(session.totalCashTips), true)}</div>}
            <div className="space-y-1 border-b border-dashed border-black pb-3">
                {row('Opening float', money(session.openingFloat))}
                {row('Cash sales', money(session.totalCashSales))}
                {row('Cash tips', money(session.totalCashTips))}
                {safeNumber(session.totalCashRefunds) > 0 && row('Cash refunds', `−${money(session.totalCashRefunds)}`)}
                {row('Counted in the drawer', money(session.actualCash || session.openingFloat), true)}
                {Math.abs(safeNumber(session.discrepancy)) > 0.01 && row(safeNumber(session.discrepancy) > 0 ? 'Over' : 'Short', `${safeNumber(session.discrepancy) > 0 ? '+' : '−'}${money(Math.abs(safeNumber(session.discrepancy)))}`, true)}
            </div>
            <div className="space-y-3">{signer('Opened by', session.openedBy, session.openedBySignature)}{signer('Closed by', session.closedBy, session.closedBySignature)}{signer('Witness', session.verifiedBy, session.verifiedBySignature)}</div>
        </div>
    );
};

export const TillManagement = ({
    open,
    onOpenChange,
    activeTill,
    staff,
    onOpenTill,
    onCloseTill,
    requireTillWitness = true,
}: {
    open: boolean,
    onOpenChange: (open: boolean) => void,
    activeTill: TillSession | null,
    staff: Staff[],
    onOpenTill: (data: any) => void,
    onConfirmCloseTill?: (data: any) => void,
    onCloseTill: (data: any) => void,
    requireTillWitness?: boolean
}) => {
    const { toast } = useToast();
    // PINs are checked on the server; the people confirmed at "verify" are remembered here for the signature step.
    const { selectedTenant } = useTenant() as any;
    const verified = useRef<{ primary: Staff | null; witness: Staff | null }>({ primary: null, witness: null });
    const { tillSessions } = useInventory();
    
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [floatCounts, setFloatCounts] = useState<Record<string, number>>({});
    const [primaryPin, setPrimaryPin] = useState('');
    const [witnessPin, setWitnessPin] = useState('');
    const [step, setStep] = useState<'count' | 'float_select' | 'allocation' | 'verify' | 'sign' | 'success'>('count');
    const [nextDayFloat, setNextDayFloat] = useState<number>(0);
    const [finalSessionData, setFinalSessionData] = useState<any | null>(null);
    const [mainView, setMainView] = useState<'active' | 'history'>('active');
    const [historicalSession, setHistoricalSession] = useState<TillSession | null>(null);

    const [historySearch, setHistorySearch] = useState('');
    const [historyDateFilter, setHistoryDateFilter] = useState('all');

    const sigCanvasRef = useRef<SignatureCanvas | null>(null);
    const witnessSigCanvasRef = useRef<SignatureCanvas | null>(null);

    const actualTotal = useMemo(() => {
        return denominations.reduce((acc, d) => acc + (safeNumber(counts[d.key]) * d.val), 0);
    }, [counts]);

    const floatTotal = useMemo(() => {
        return denominations.reduce((acc, d) => acc + (safeNumber(floatCounts[d.key]) * d.val), 0);
    }, [floatCounts]);

    const filteredSessions = useMemo(() => {
        if (!tillSessions) return [];
        let list = [...tillSessions];

        if (historySearch.trim()) {
            const search = historySearch.toLowerCase();
            list = list.filter(s => 
                s.id.toLowerCase().includes(search) || 
                staff.find(sm => sm.id === s.openedBy)?.name.toLowerCase().includes(search) ||
                staff.find(sm => sm.id === s.closedBy)?.name.toLowerCase().includes(search)
            );
        }

        if (historyDateFilter !== 'all') {
            let cutoff = startOfDay(new Date());
            if (historyDateFilter === '7days') cutoff = subDays(cutoff, 7);
            if (historyDateFilter === '30days') cutoff = subDays(cutoff, 30);
            list = list.filter(s => safeDate(s.openedAt) >= cutoff);
        }

        return list.sort((a,b) => safeDate(b.openedAt).getTime() - safeDate(a.openedAt).getTime());
    }, [tillSessions, historySearch, historyDateFilter, staff]);

    const handleCountChange = (key: string, val: number) => {
        setCounts(prev => ({ ...prev, [key]: val }));
    };

    const handleFloatChange = (key: string, val: number) => {
        const totalInDrawer = safeNumber(counts[key]) || 0;
        if (val > totalInDrawer) {
            toast({ variant: 'destructive', title: 'More than was counted', description: `Only ${totalInDrawer} of those were counted in the drawer.` });
            return;
        }
        setFloatCounts(prev => ({ ...prev, [key]: val }));
    };

    const handleStepTransition = async () => {
        if (step === 'count') {
            setStep(activeTill ? 'float_select' : 'verify');
        } else if (step === 'float_select') {
            setNextDayFloat(floatTotal);
            setStep('allocation');
        } else if (step === 'allocation') {
            setStep('verify');
        } else if (step === 'verify') {
            const pv = await verifyPin(selectedTenant?.id || '', primaryPin);
            const authorizedStaff: Staff | null = pv.ok ? ((staff.find((s) => s.id === pv.staff.id) || (pv.staff as any)) as Staff) : null;
            if (!authorizedStaff) {
                toast({ variant: 'destructive', title: 'That PIN didn’t match', description: pv.ok ? 'We couldn’t tell who that is.' : pv.error });
                return;
            }
            verified.current = { primary: authorizedStaff, witness: null };
            if (activeTill && requireTillWitness) {
                const wv = await verifyPin(selectedTenant?.id || '', witnessPin);
                const witnessStaff: Staff | null = wv.ok ? ((staff.find((s) => s.id === wv.staff.id) || (wv.staff as any)) as Staff) : null;
                verified.current.witness = witnessStaff;
                if (!witnessStaff) {
                    toast({ variant: 'destructive', title: 'The witness PIN didn’t match' });
                    return;
                }
                if (witnessStaff.id === authorizedStaff.id) {
                    toast({ variant: 'destructive', title: 'The witness has to be someone else', description: 'Ask a different team member to watch the count.' });
                    return;
                }
            }
            setStep('sign');
        }
    };

    const handleAction = () => {
        const authorizedStaff = verified.current.primary;   // confirmed by the server at the verify step
        if (!authorizedStaff) return;

        const mainSig = sigCanvasRef.current?.getTrimmedCanvas().toDataURL('image/png');
        if (!mainSig) {
            toast({ variant: 'destructive', title: 'Add your signature' });
            return;
        }

        if (activeTill) {
            const witnessStaff = requireTillWitness ? verified.current.witness : null;
            const witnessSig = requireTillWitness ? witnessSigCanvasRef.current?.getTrimmedCanvas().toDataURL('image/png') : null;
            
            if (requireTillWitness && !witnessSig) {
                toast({ variant: 'destructive', title: 'The witness needs to sign too' });
                return;
            }

            const discrepancy = actualTotal - activeTill.expectedCash;
            
            const depositDenoms: Record<string, number> = {};
            denominations.forEach(d => {
                const remaining = safeNumber(counts[d.key]) - safeNumber(floatCounts[d.key]);
                if (remaining > 0) depositDenoms[d.key] = remaining;
            });

            const closingData = {
                actualCash: actualTotal,
                cashToDeposit: actualTotal - floatTotal,
                nextDayFloat: floatTotal,
                closingDenominations: counts,
                nextDayDenominations: floatCounts,
                depositDenominations: depositDenoms,
                closedBy: authorizedStaff.id,
                verifiedBy: witnessStaff?.id,
                closedBySignature: mainSig,
                verifiedBySignature: witnessSig,
                discrepancy,
                closedAt: new Date().toISOString()
            };
            setFinalSessionData({ ...activeTill, ...closingData });
            onCloseTill(closingData);
            setStep('success');
        } else {
            onOpenTill({
                openingFloat: actualTotal,
                openingDenominations: counts,
                openedBy: authorizedStaff.id,
                openedBySignature: mainSig,
            });
            onOpenChange(false);
            resetState();
        }
    };

    const resetState = () => {
        setCounts({});
        setFloatCounts({});
        setPrimaryPin('');
        setWitnessPin('');
        setStep('count');
        setFinalSessionData(null);
        setMainView('active');
        setHistoricalSession(null);
        setHistorySearch('');
        setHistoryDateFilter('all');
    };

    const handleClose = () => {
        onOpenChange(false);
        setTimeout(resetState, 300);
    };

    const business = (selectedTenant as any)?.name || null;
    const title = step === 'success' ? 'Till closed' : mainView === 'history' ? 'Past tills' : activeTill ? 'Close the till' : 'Open the till';
    const STEPS = activeTill ? ['count', 'float_select', 'allocation', 'verify', 'sign'] : ['count', 'verify', 'sign'];
    const stepNo = STEPS.indexOf(step);
    const btn = 'flex h-12 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-semibold transition active:scale-[.98] disabled:opacity-40';
    const primary = { background: 'var(--accent)', color: 'var(--accent-ink)' } as React.CSSProperties;
    const quiet = { background: 'var(--soft)', color: 'var(--ink)' } as React.CSSProperties;
    const pinInput = (label: string, val: string, set: (v: string) => void, hint: string) => (
        <label className="block space-y-1.5">
            <span className="flex items-center gap-2 text-[14px] font-semibold"><Icon name="user" size={16} />{label}</span>
            <span className="block text-[12.5px]" style={muted}>{hint}</span>
            <input aria-label={label} type="password" inputMode="numeric" maxLength={8} value={val} onChange={(e) => set(e.target.value.replace(/\D/g, ''))} placeholder="••••"
                className="h-14 w-full rounded-2xl text-center text-[26px] tracking-[0.4em] outline-none" style={{ background: 'var(--paper)', border: '1px solid var(--line)', color: 'var(--ink)' }} />
        </label>);
    const pad = (label: string, ref: React.MutableRefObject<SignatureCanvas | null>) => (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between"><span className="text-[14px] font-semibold">{label}</span><button type="button" onClick={() => ref.current?.clear()} className="text-[13px] font-semibold underline underline-offset-4" style={muted}>Clear</button></div>
            <div className="cf-paper relative h-44 overflow-hidden rounded-2xl" style={{ background: '#fff', border: '1px dashed var(--line)' }}>
                <SignatureCanvas ref={ref as any} penColor="#16171a" canvasProps={{ className: 'h-full w-full', 'aria-label': label } as any} />
                <div className="pointer-events-none absolute inset-x-5 bottom-5 border-b" style={{ borderColor: '#d4d4d8' }} />
            </div>
        </div>);
    const back = (to: typeof step) => <button type="button" onClick={() => setStep(to)} className={btn} style={quiet}>Back</button>;
    const next = (label: string, onClick: () => void, disabled = false) => <button type="button" onClick={onClick} disabled={disabled} className={`${btn} flex-1`} style={primary}>{label}<Icon name="arrow" size={17} /></button>;
    const over = activeTill ? actualTotal - safeNumber(activeTill.expectedCash) : 0;

    return (
        <Drawer open={open} onClose={handleClose} title={title}>
            <div className="space-y-5">
                {step === 'count' && <Seg label="Till" value={mainView} onChange={(v) => { setMainView(v as any); setHistoricalSession(null); }} options={[['active', activeTill ? 'Today' : 'Open'], ['history', 'Past tills']]} />}
                {mainView === 'active' && step !== 'success' && <ol className="flex gap-1.5" aria-label="Steps">{STEPS.map((k, i) => <li key={k} className={`h-1 flex-1 rounded-full ${i === stepNo ? 'd-breathe' : ''}`} style={{ background: i <= stepNo ? 'var(--ok)' : 'var(--line)' }} />)}</ol>}
                <AnimatePresence mode="wait">
                    {mainView === 'history' ? (
                        <motion.div key="history" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                            {historicalSession ? <div className="space-y-4">
                                <button type="button" onClick={() => setHistoricalSession(null)} className="flex items-center gap-1.5 text-[14px] font-semibold"><Icon name="back" size={16} />All past tills</button>
                                <DepositSlip session={historicalSession} staff={staff} business={business} />
                                <button type="button" onClick={() => window.print()} className={`${btn} w-full`} style={primary}><Icon name="printer" size={18} />Print the slip</button>
                            </div> : <>
                                <label className="flex h-11 items-center gap-2.5 rounded-full px-4" style={{ background: 'var(--soft)', border: '1px solid var(--line)' }}>
                                    <Icon name="search" size={17} style={muted} />
                                    <input aria-label="Search past tills by person or reference" placeholder="Search by person or reference" value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[14px] outline-none" />
                                </label>
                                <Seg label="Period" value={historyDateFilter} onChange={setHistoryDateFilter} options={[['all', 'All'], ['today', 'Today'], ['7days', '7 days'], ['30days', '30 days']]} />
                                <div className="space-y-2">
                                    {filteredSessions.length === 0 && <p className="py-6 text-center text-[13px]" style={muted}>No tills match.</p>}
                                    {filteredSessions.map((session) => { const who = staff.find((s) => s.id === session.openedBy); const diff = safeNumber(session.discrepancy);
                                        return <button key={session.id} type="button" onClick={() => setHistoricalSession(session)} className="d-row flex w-full items-center gap-3 rounded-2xl p-3.5 text-left" style={box}>
                                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--soft)' }}><Icon name="till" size={18} /></span>
                                            <span className="min-w-0 flex-1"><span className="block text-[14.5px] font-semibold">{format(safeDate(session.openedAt), 'EEE, MMM d')}</span>
                                                <span className="block text-[12.5px]" style={muted}>{session.status === 'open' ? 'Open now' : 'Closed'}{who ? ` · opened by ${String(who.name).split(' ')[0]}` : ''}</span></span>
                                            <span className="text-right"><span className="block text-[15px] tabular-nums">{money(session.actualCash || session.openingFloat)}</span>
                                                {Math.abs(diff) > 0.01 && <span className="block text-[12px] font-semibold" style={{ color: 'var(--warn)' }}>{diff > 0 ? 'Over' : 'Short'} {money(Math.abs(diff))}</span>}</span>
                                        </button>; })}
                                </div>
                            </>}
                        </motion.div>
                    ) : step === 'count' ? (
                        <motion.div key="count" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-4">
                            {activeTill && <div className="grid grid-cols-2 gap-2">
                                <div className="rounded-2xl p-4" style={{ background: 'var(--soft)' }}><p className="text-[12px]" style={muted}>Should be in the drawer</p><p className="text-[26px] font-light tabular-nums tracking-tight">{money(activeTill.expectedCash)}</p>
                                    <p className="text-[12px]" style={muted}>Sales {money(activeTill.totalCashSales)} · tips {money(activeTill.totalCashTips)}{safeNumber(activeTill.totalCashRefunds) > 0 ? ` · refunds −${money(activeTill.totalCashRefunds)}` : ''}</p></div>
                                <div className="rounded-2xl p-4" style={{ background: 'var(--soft)' }}><p className="text-[12px]" style={muted}>Opened</p><p className="text-[26px] font-light tracking-tight">{format(safeDate(activeTill.openedAt), 'h:mm a')}</p></div>
                            </div>}
                            <div className="flex items-end justify-between"><p className="text-[14px] font-semibold">{activeTill ? 'Count everything in the drawer' : 'Count the starting cash'}</p><p className="text-[22px] font-light tabular-nums">{money(actualTotal)}</p></div>
                            <div className="space-y-1.5">{denominations.map((d) => <DenominationInput key={d.key} denom={d} count={counts[d.key] || 0} onChange={handleCountChange} />)}</div>
                        </motion.div>
                    ) : step === 'float_select' ? (
                        <motion.div key="float" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-4">
                            <div className="rounded-2xl p-5 text-center" style={{ background: 'var(--soft)' }}><p className="text-[12px]" style={muted}>Staying in the drawer for tomorrow</p><p className="text-[38px] font-light tabular-nums tracking-tight">{money(floatTotal)}</p>
                                <p className="text-[13px]" style={muted}>Choose the notes and coins to leave. The rest goes to the bank.</p></div>
                            <div className="space-y-1.5">{denominations.map((d) => <DenominationInput key={d.key} denom={d} count={floatCounts[d.key] || 0} onChange={handleFloatChange} subtitle={`${counts[d.key] || 0} counted`} />)}</div>
                        </motion.div>
                    ) : step === 'allocation' ? (
                        <motion.div key="alloc" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-3">
                            <div className="rounded-3xl p-6 text-center" style={box}><p className="text-[12px]" style={muted}>Counted in the drawer</p><p className="text-[44px] font-light tabular-nums tracking-tight">{money(actualTotal)}</p>
                                {activeTill && <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold" style={Math.abs(over) < 0.01 ? { background: 'color-mix(in srgb, var(--ok) 12%, transparent)', color: 'var(--ok)' } : { background: 'color-mix(in srgb, var(--warn) 12%, transparent)', color: 'var(--warn)' }}>
                                    <Icon name={Math.abs(over) < 0.01 ? 'check' : 'alert'} size={14} />{Math.abs(over) < 0.01 ? 'Matches what should be there' : over > 0 ? `${money(over)} over` : `${money(-over)} short`}</span>}</div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="rounded-2xl p-4" style={{ background: 'var(--soft)' }}><p className="text-[12px]" style={muted}>Cash sales</p><p className="text-[20px] font-light tabular-nums">{money(activeTill?.totalCashSales)}</p></div>
                                <div className="rounded-2xl p-4" style={{ background: 'var(--soft)' }}><p className="text-[12px]" style={muted}>Cash tips</p><p className="text-[20px] font-light tabular-nums">{money(activeTill?.totalCashTips)}</p></div>
                            </div>
                            <div className="flex items-center justify-between rounded-2xl p-4" style={{ background: 'color-mix(in srgb, var(--accent) 8%, var(--card))', border: '1px solid var(--line)' }}>
                                <span className="flex items-center gap-2.5"><Icon name="arrow" size={18} /><span><span className="block text-[14px] font-semibold">To the bank</span><span className="block text-[12.5px]" style={muted}>Leaving {money(floatTotal)} for tomorrow</span></span></span>
                                <span className="text-[28px] font-light tabular-nums">{money(Math.max(0, actualTotal - floatTotal))}</span></div>
                        </motion.div>
                    ) : step === 'verify' ? (
                        <motion.div key="verify" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-6">
                            {pinInput('Your PIN', primaryPin, setPrimaryPin, activeTill ? 'You counted the drawer.' : 'You counted the starting cash.')}
                            {activeTill && requireTillWitness && pinInput('Witness PIN', witnessPin, setWitnessPin, 'A different team member who watched the count.')}
                        </motion.div>
                    ) : step === 'sign' ? (
                        <motion.div key="sign" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-6">
                            {pad(`${verified.current.primary?.name || 'Your'} signature`, sigCanvasRef)}
                            {activeTill && requireTillWitness && pad(`${verified.current.witness?.name ? `${verified.current.witness.name}’s` : 'Witness'} signature`, witnessSigCanvasRef)}
                        </motion.div>
                    ) : step === 'success' && finalSessionData ? (
                        <motion.div key="done" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="space-y-5">
                            <div className="space-y-1 text-center"><span className="d-rise mx-auto flex h-16 w-16 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, var(--ok) 14%, transparent)', color: 'var(--ok)' }}><Icon name="check" size={30} stroke={2} /></span>
                                <p className="pt-2 text-[22px] font-light tracking-tight">The till is closed</p><p className="text-[13.5px]" style={muted}>Print the slip to go with the bank deposit.</p></div>
                            <DepositSlip session={finalSessionData} staff={staff} business={business} />
                        </motion.div>
                    ) : null}
                </AnimatePresence>
                {mainView === 'active' && <div className="sticky bottom-0 -mx-5 flex gap-2 px-5 pb-1 pt-3" style={{ background: 'var(--paper)', borderTop: '1px solid var(--line)' }}>
                    {step === 'count' && <><button type="button" onClick={handleClose} className={btn} style={quiet}>Cancel</button>{next(activeTill ? 'Choose tomorrow’s float' : 'Next', handleStepTransition, actualTotal <= 0)}</>}
                    {step === 'float_select' && <>{back('count')}{next('See the deposit', handleStepTransition)}</>}
                    {step === 'allocation' && <>{back('float_select')}{next('Confirm with PINs', handleStepTransition)}</>}
                    {step === 'verify' && <>{back(activeTill ? 'allocation' : 'count')}{next('Sign', handleStepTransition, primaryPin.length < 4 || !!(activeTill && requireTillWitness && witnessPin.length < 4))}</>}
                    {step === 'sign' && <>{back('verify')}<button type="button" onClick={handleAction} className={`${btn} flex-1`} style={primary}><Icon name="check" size={18} />{activeTill ? 'Close the till' : 'Open the till'}</button></>}
                    {step === 'success' && <><button type="button" onClick={handleClose} className={btn} style={quiet}>Done</button><button type="button" onClick={() => window.print()} className={`${btn} flex-1`} style={primary}><Icon name="printer" size={18} />Print the slip</button></>}
                </div>}
            </div>
            <style>{`@media print { body * { visibility: hidden; } #deposit-slip-print, #deposit-slip-print * { visibility: visible; } #deposit-slip-print { position: absolute; left: 0; top: 0; width: 3.5in; margin: 0; border: none; padding: 0.25in; } }`}</style>
        </Drawer>
    );
};
