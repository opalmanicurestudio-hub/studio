'use client';
// src/components/money/BankScreen.tsx — THE BANK, on the Money page (design board "Bank: lines to sort, sorted for you,
// matched"; api/plaid, lib/plaid-sync, lib/bank-match). Three lists:
//   To sort        — lines waiting for you, each with a category picked: Book it, Match it to what's in your books
//                    already (a sale paid by Zelle or check, a visit's sale with its tax and tip, a cost you logged), or
//                    Skip it. A bill it pays, a receipt, a personal line that was the business's. A line still pending at
//                    the bank waits until it clears.
//   Sorted for you — the last 30 days the app booked on its own; Change one and lines from that payee follow.
//   Matched        — the last 30 days already in your books (card payouts, moves between your accounts, app payouts,
//                    cash deposits, lines matched), never counted twice. A match can be undone.
// Then the payees you've sorted (learned rules), to change or forget. The accounts connected, and one asking to be signed
// in again. The owner's: only the owner reads the bank.
// In Books (`inBooks`, the Money page's design board "One Money page", option A): the lines to sort lead, under "From
// your bank", with checking, connecting and signing in again beside them; Sorted for you, Matched and the payees open
// from one button (and are only read then). On a phone each line shows Book (and It's the same); the rest are a tap
// on More away.
import * as React from 'react';
import { collection, getDocs, limit, onSnapshot, query, where, type Firestore } from 'firebase/firestore';
import { categoriesFor, findCategory, CUSTOM_CATEGORY } from '@/lib/categories';
import { normalizeLine } from '@/lib/books-summary';
import { lineCents, notBankMoney, saleOf } from '@/lib/bank-match';
import { readDatedRange } from '@/hooks/use-transactions';
import { ImageUpload } from '@/components/shared/ImageUpload';

declare global { interface Window { Plaid?: any } }

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86400000;
const usd = (c: number) => `$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (bt: any) => `${bt.direction === 'out' ? '−' : '+'}${usd(Number(bt.amountCents) || 0)}`;
/** A day as this device keeps it (the business's own days, where it's used). */
const ymd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
const dayWords = (d: string) => {
  const t = new Date();
  if (d === ymd(t)) return 'Today'; const y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1); if (d === ymd(y)) return 'Yesterday';
  const [, m, dd] = d.split('-').map(Number); return `${MONTHS[m - 1]} ${dd}`;
};
const lineDay = (date: any) => { const t = new Date(date); return Number.isFinite(t.getTime()) ? dayWords(ymd(t)) : ''; };
const btn = (_primary = false) => `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const btnStyle = (primary = false) => primary ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: `1px solid ${LINE}` };
const quiet = `min-h-[44px] rounded-full px-3 text-[14px] ${RING}`;
const MATCHED = ['payout', 'own_transfer', 'app_payout', 'cash_deposit', 'matched'];

/** Why a matched line needs nothing: what it was matched to. */
function matchedWhy(bt: any): string {
  switch (String(bt.status)) {
    case 'payout': return 'Your card sales, paid out';
    case 'own_transfer': return bt.matchedTxnId ? 'Between your business and personal accounts, booked once' : 'Between your own accounts';
    case 'app_payout': return 'A delivery app’s payout for orders already in your books';
    case 'cash_deposit': return 'Cash and checks from your drawers';
    default: return bt.matchedBy === 'you' ? 'Matched by you to what’s in your books' : 'Already in your books';
  }
}

/** One thing to pick in the match sheet: a line, or one payment's lines together (the sale, its tax and its tip), which
 *  can be opened up to pick them one by one. */
type Pick = { key: string; ids: string[]; label: string; sub: string; cents: number; at: number; many: boolean };
function picksOf(lines: any[], bt: any, apart: string[] = []): Pick[] {
  const dir: 'in' | 'out' = bt.direction === 'out' ? 'out' : 'in'; const cents = Number(bt.amountCents) || 0;
  const ok = lines.map((t) => normalizeLine(t)).filter((t) => !notBankMoney(t, dir, bt.context || 'Business'));
  const groups = new Map<string, any[]>();
  for (const t of ok) { const s = saleOf(t); const k = s && !apart.includes(s) ? s : `line:${t.id}`; groups.set(k, [...(groups.get(k) || []), t]); }
  const at = new Date(`${bt.date}T12:00:00`).getTime();
  return [...groups.entries()].map(([key, ls]) => {
    const main = [...ls].sort((a, b) => lineCents(b) - lineCents(a))[0];
    const others = ls.filter((t) => t !== main).map((t) => String(t.category || '').toLowerCase()).map((c) => c === 'tax collected' ? 'tax' : c === 'tips' ? 'tip' : c);
    return { key, ids: ls.map((t) => String(t.id)), cents: ls.reduce((n, t) => n + lineCents(t), 0), at: new Date(main.date).getTime(), many: ls.length > 1,
      label: String(main.description || main.clientOrVendor || main.category), sub: `${lineDay(main.date)}${main.description || main.clientOrVendor ? `, ${main.category}` : ''}${others.length ? `, with its ${[...new Set(others)].join(' and ')}` : ''}` };
  }).filter((p) => p.cents > 0 && p.cents <= cents)
    .sort((a, b) => (Number(b.cents === cents) - Number(a.cents === cents)) || Math.abs(a.at - at) - Math.abs(b.at - at)).slice(0, 40);
}

export function BankScreen({ tenantId, firestore, actor, inBooks = false }: { tenantId: string; firestore: Firestore; actor?: { type: 'user'; id?: string; name?: string; role?: string }; inBooks?: boolean }) {
  const [more, setMore] = React.useState(!inBooks); const [rowMore, setRowMore] = React.useState<Record<string, boolean>>({});
  // (In Books, the first few lines to sort, so the books themselves aren't pushed out of sight; the rest a tap away.)
  const [allShown, setAllShown] = React.useState(!inBooks); const FIRST = 3;
  // (A read that failed is said, never taken for nothing to sort.)
  const [readFailed, setReadFailed] = React.useState(false);
  const [inbox, setInbox] = React.useState<any[] | null>(null);
  const [recent, setRecent] = React.useState<any[]>([]);
  const [accounts, setAccounts] = React.useState<any[] | null>(null);
  const [busy, setBusy] = React.useState(''); const [error, setError] = React.useState(''); const [note, setNote] = React.useState('');
  const [labelPick, setLabelPick] = React.useState(false);
  const [cat, setCat] = React.useState<Record<string, string>>({});
  const [receipt, setReceipt] = React.useState<Record<string, string>>({}); const [receiptFor, setReceiptFor] = React.useState('');
  const [billOff, setBillOff] = React.useState<Record<string, boolean>>({});
  const [extraFor, setExtraFor] = React.useState<Record<string, { cents: number; short: boolean; tipOk: boolean }>>({});
  const [matchFor, setMatchFor] = React.useState(''); const [lines, setLines] = React.useState<any[] | null>(null); const [picked, setPicked] = React.useState<string[]>([]);
  const [apart, setApart] = React.useState<string[]>([]);
  const [reach, setReach] = React.useState<0 | 14 | 45>(0);
  const [changing, setChanging] = React.useState(''); const [changeTo, setChangeTo] = React.useState('');
  const [rules, setRules] = React.useState<any[] | null>(null); const [rulesOpen, setRulesOpen] = React.useState(false);
  const [ruleCat, setRuleCat] = React.useState<Record<string, string>>({}); const [ruleOwn, setRuleOwn] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    return onSnapshot(query(collection(firestore, 'tenants', tenantId, 'bankTransactions'), where('status', '==', 'unmatched')),
      (snap) => setInbox(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))),
      () => { setInbox([]); setReadFailed(true); });
  }, [firestore, tenantId]);

  const api = React.useCallback(async (payload: any) => {
    const res = await fetch('/api/plaid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, actor, ...payload }) });
    return res.json().catch(() => ({ ok: false, error: 'No answer. Try again.' }));
  }, [tenantId, actor]);
  // The last 30 days that are sorted or matched, and the accounts connected: read when the screen opens, when it's come
  // back to and after a check. What's done here changes the lists in place, never by reading them all again.
  const loadRecent = React.useCallback(async () => {
    if (!firestore || !tenantId) return;
    const since = ymd(new Date(Date.now() - 30 * DAY));
    try { const q = await getDocs(query(collection(firestore, 'tenants', tenantId, 'bankTransactions'), where('date', '>=', since)));
      setRecent(q.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).filter((b) => b.status !== 'unmatched').sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))); } catch { /* the owner's to read */ }
  }, [firestore, tenantId]);
  const loadAccounts = React.useCallback(async () => { const d = await api({ action: 'status' }).catch(() => null); if (d?.ok) setAccounts(d.items || []); }, [api]);
  React.useEffect(() => { loadAccounts(); }, [loadAccounts]);
  // (In Books, the last 30 days sorted and matched are read only once they're opened.)
  React.useEffect(() => {
    if (!more) return;
    loadRecent();
    const back = () => { if (document.visibilityState === 'visible') loadRecent(); };
    document.addEventListener('visibilitychange', back); return () => document.removeEventListener('visibilitychange', back);
  }, [loadRecent, more]);
  const patch = (id: string, next: any | null) => setRecent((r) => { const rest = r.filter((x) => x.id !== id); return next ? [next, ...rest].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))) : rest; });

  const run = async (key: string, fn: () => Promise<any>, done?: string | ((d: any) => string)) => {
    if (busy) return; setBusy(key); setError(''); setNote('');
    try { const d = await fn(); if (!d?.ok) { if (!d?.ask) setError(d?.error || 'That didn’t go through. Try again.'); } else if (done) setNote(typeof done === 'function' ? done(d) : done); return d; }
    catch { setError('No connection. Try again.'); } finally { setBusy(''); }
  };

  const sync = () => run('sync', () => api({ action: 'sync' }).then((d: any) => {
    if (d?.ok) { setNote(`Checked. ${d.pulled} new line${d.pulled === 1 ? '' : 's'}: ${d.matched} matched, ${d.autoBooked || 0} sorted for you, ${d.needsReview} for you to sort.`); loadRecent(); }
    if (d?.needsLogin?.length || !d?.ok) loadAccounts();
    return d;
  }));
  const plaidOpen = async (token: string, onSuccess: (publicToken: string, md: any) => void) => {
    if (!window.Plaid) await new Promise<void>((ok, bad) => { const s = document.createElement('script'); s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'; s.onload = () => ok(); s.onerror = () => bad(new Error('x')); document.head.appendChild(s); });
    window.Plaid.create({ token, onExit: () => {}, onSuccess }).open();
  };
  const connect = async (label: 'Business' | 'Personal') => {
    setLabelPick(false);
    await run('connect', async () => {
      const lt = await api({ action: 'link-token' }); if (!lt.ok) return lt;
      await plaidOpen(lt.linkToken, async (publicToken, md) => {
        const ex = await api({ action: 'exchange', publicToken, institution: md?.institution?.name || null, label }); if (!ex.ok) { setError(ex.error || 'That account didn’t connect. Try again.'); return; }
        await loadAccounts(); sync();
      });
      return { ok: true };
    });
  };
  // (The bank's own sign-in again, for an account that asked: its lines and payees stay as they are.)
  const relink = (item: any) => run(`relink:${item.id}`, async () => {
    const lt = await api({ action: 'link-token', itemId: item.id }); if (!lt.ok) return lt;
    await plaidOpen(lt.linkToken, async () => { await api({ action: 'relinked', itemId: item.id }); await loadAccounts(); sync(); });
    return { ok: true };
  });

  const book = (bt: any, asBusiness = false) => run(bt.id, () => {
    const p: any = { action: 'resolve', bankTxnId: bt.id, mode: 'create' };
    const chosen = cat[bt.id]; if (chosen && chosen !== bt.suggestedCategory) p.categoryOverride = chosen;
    if (receipt[bt.id]) p.receiptUrl = receipt[bt.id];
    if (bt.suggestedBillInstanceId && !billOff[bt.id]) p.billInstanceId = bt.suggestedBillInstanceId;
    if (asBusiness) p.contextOverride = 'Business';
    return api(p);
  }, asBusiness ? `${bt.merchant || bt.name} is booked as the business’s. Lines from it on your personal account still wait for you.` : `${bt.merchant || bt.name} is booked as ${cat[bt.id] || bt.suggestedCategory || 'a line'}. Lines from it will be sorted for you from now on.`);
  const skip = (bt: any) => run(bt.id, () => api({ action: 'resolve', bankTxnId: bt.id, mode: 'ignore' }), `${bt.merchant || bt.name} is skipped: it isn’t in your books.`);
  const bookAll = () => run('all', () => api({ action: 'accept-all' }), (d) => `${d.booked} line${d.booked === 1 ? ' is' : 's are'} booked as picked.`);

  // Match to a sale (or a cost): the week before it (and a few days after), with lines of the same amount from the two
  // months before it (two small reads); then, on asking, two weeks back, or six. One payment's sale, tax and tip are one
  // pick, which can be opened up. Money the same way, in the same books, not matched to a bank line yet, never a
  // discount or a card sale (lib/bank-match).
  const openMatch = async (bt: any, days: 7 | 14 | 45 = 7) => {
    if (matchFor === bt.id && days === 7) { setMatchFor(''); return; }
    setMatchFor(bt.id); setLines(null); setReach(days === 7 ? 0 : days); if (days === 7) { setPicked([]); setApart([]); }
    const at = new Date(`${bt.date}T12:00:00`); const cents = Number(bt.amountCents) || 0;
    try {
      const col = collection(firestore, 'tenants', tenantId, 'transactions');
      const lo = at.getTime() - 62 * DAY, hi = at.getTime() + 7 * DAY;
      const [w, a, b] = await Promise.all([readDatedRange(firestore, tenantId, 'transactions', 'date', new Date(at.getTime() - days * DAY), new Date(at.getTime() + 3 * DAY)),
        days === 7 ? getDocs(query(col, where('amount', '==', cents / 100), limit(60))) : null, days === 7 ? getDocs(query(col, where('amountCents', '==', cents), limit(30))) : null]);
      const same = [...(a?.docs || []), ...(b?.docs || [])].map((d) => ({ id: d.id, ...(d.data() as any) })).filter((t) => { const x = new Date(t.date).getTime(); return x >= lo && x <= hi; });
      const seen = new Set<string>(); setLines([...w, ...same].filter((t) => !seen.has(t.id) && !!seen.add(t.id)));
    } catch { setLines([]); setError('Your books for those days couldn’t be read. Try again.'); }
  };
  const cands = React.useMemo(() => { const bt = (inbox || []).find((x) => x.id === matchFor); return lines && bt ? picksOf(lines, bt, apart) : null; }, [lines, inbox, matchFor, apart]);
  const pickedOf = (cs: Pick[] | null) => (cs || []).filter((p) => picked.includes(p.key));
  const pickedCents = pickedOf(cands).reduce((a, p) => a + p.cents, 0);
  const match = (bt: any, ids: string[], extra?: 'tip' | 'other' | 'fee' | 'less') => run(bt.id, async () => {
    const d = await api({ action: 'resolve', bankTxnId: bt.id, mode: 'match', ledgerTxnIds: ids, ...(extra ? { extra } : {}) });
    if (d?.ask) setExtraFor((m) => ({ ...m, [bt.id]: { cents: Math.abs(Number(d.extraCents) || 0), short: d.ask === 'short', tipOk: !!d.tipOk } }));
    if (d?.ok) { setMatchFor(''); setPicked([]); setExtraFor((m) => { const x = { ...m }; delete x[bt.id]; return x; }); patch(bt.id, { ...bt, status: 'matched', matchedBy: 'you', matchedTxnId: ids[0] }); }
    return d;
  }, (d) => `${bt.merchant || bt.name} is matched to what’s in your books: nothing new is booked${d.diffCents ? `, except the ${usd(d.diffCents)} difference` : ''}.`);
  const unmatch = (bt: any) => run(bt.id, async () => { const d = await api({ action: 'unmatch', bankTxnId: bt.id }); if (d?.ok) patch(bt.id, null); return d; },
    `${bt.merchant || bt.name} is back in To sort, and its lines in your books are as they were.`);
  const change = (bt: any) => run(bt.id, async () => { const d = await api({ action: 'recategorize', bankTxnId: bt.id, category: changeTo }); if (d?.ok) { setChanging(''); patch(bt.id, { ...bt, appliedRule: changeTo }); } return d; },
    `${bt.merchant || bt.name} is now ${changeTo}. Lines from it follow from now on.`);
  const loadRules = async () => { if (rulesOpen) { setRulesOpen(false); return; } const d = await api({ action: 'rules-list' }); if (d.ok) { setRules(d.rules || []); setRulesOpen(true); } else setError(d.error || 'Those didn’t load. Try again.'); };
  const saveRule = (rl: any) => {
    const v = ruleCat[rl.id] === CUSTOM_CATEGORY ? String(ruleOwn[rl.id] || '').trim() : ruleCat[rl.id]; if (!v || v === rl.category) return;
    return run(`rule:${rl.id}`, async () => { const d = await api({ action: 'rules-update', ruleId: rl.id, category: v, fixPast: true }); if (d.ok) { setRules((rs) => (rs || []).map((x: any) => x.id === rl.id ? { ...x, category: v } : x)); setRuleCat((m) => { const x = { ...m }; delete x[rl.id]; return x; }); } return d; },
      (d) => `${rl.merchant} is now ${v}${d.fixed ? `, and ${d.fixed} of the lines booked from your bank changed with it (none in a closed month)` : ''}.`);
  };

  // (Money out is a cost or a move of money; money in is a sale or other money in, or money back on a cost.)
  const catsFor = (bt: any) => {
    const l = [...categoriesFor(bt.direction === 'out' ? 'expense' : 'income').map((c) => c.name), ...(bt.direction === 'out' ? [] : ['Transfer'])];
    if (bt.suggestedCategory && !l.includes(bt.suggestedCategory) && !backOn(bt).includes(bt.suggestedCategory)) l.unshift(bt.suggestedCategory);
    return l;
  };
  function backOn(bt: any) { return bt.direction === 'out' ? [] : categoriesFor('expense').map((c) => c.name).filter((c) => c !== 'Transfer'); }
  const sorted = recent.filter((b) => b.status === 'auto_categorized');
  const matched = recent.filter((b) => MATCHED.includes(String(b.status)));
  const card = 'rounded-3xl bg-[#fff] px-5 pb-2 pt-4'; const cardStyle = { border: `1px solid ${LINE}`, color: INK };
  const n = inbox?.length || 0;
  // (Lines still pending at the bank can't be booked yet: Book all and the count say what can.)
  const ready = (inbox || []).filter((b) => !b.pending).length; const pendingN = n - ready;
  const none = accounts !== null && accounts.length === 0;
  // (On a phone, a line's other choices wait behind More.)
  const phoneMore = (id: string) => (rowMore[id] ? '' : 'hidden md:inline-flex');

  // (In Books with no bank connected: one quiet line, not a card leading the page.)
  if (inBooks && none && n === 0) return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#fff] px-4 py-2" style={{ border: `1px solid ${LINE}`, color: INK }}>
        <p className="min-w-0 flex-1 text-[14px]" style={{ color: MUTED }}>Connect your bank and its lines come in here, sorted for you where they can be.</p>
        <button type="button" onClick={() => setLabelPick(!labelPick)} disabled={!!busy} aria-expanded={labelPick} className={`${quiet} font-semibold`} style={{ color: INK }}>Connect your bank</button>
      </div>
      {labelPick && (
        <div className={`${card} pb-4`} style={cardStyle}>
          <p className="text-[15px] font-semibold">What kind of account is it?</p>
          <p className="mt-0.5 text-[14px]" style={{ color: MUTED }}>Its lines go in those books. A business cost paid from a personal card can still be booked as the business’s, one line at a time.</p>
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => connect('Business')} className={btn(true)} style={btnStyle(true)}>Business</button><button type="button" onClick={() => connect('Personal')} className={btn()} style={btnStyle()}>Personal</button></div>
        </div>
      )}
      {error && <p role="alert" className="rounded-2xl px-4 py-3 text-[14px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>{error}</p>}
    </div>
  );

  return (
    <div className={inBooks ? 'space-y-3' : 'space-y-5'}>
      {!inBooks && <div className="flex flex-wrap gap-2">
        {!none && <button type="button" onClick={sync} disabled={!!busy} className={btn(true)} style={btnStyle(true)}>{busy === 'sync' ? 'Checking' : 'Check now'}</button>}
        <button type="button" onClick={() => setLabelPick(!labelPick)} disabled={!!busy} aria-expanded={labelPick} className={btn(none)} style={btnStyle(none)}>{none ? 'Connect your bank' : 'Connect an account'}</button>
      </div>}
      {labelPick && (
        <div className={`${card} pb-4`} style={cardStyle}>
          <p className="text-[15px] font-semibold">What kind of account is it?</p>
          <p className="mt-0.5 text-[14px]" style={{ color: MUTED }}>Its lines go in those books. A business cost paid from a personal card can still be booked as the business’s, one line at a time.</p>
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => connect('Business')} className={btn(true)} style={btnStyle(true)}>Business</button><button type="button" onClick={() => connect('Personal')} className={btn()} style={btnStyle()}>Personal</button></div>
        </div>
      )}
      {(accounts || []).filter((a) => a.needsLogin).map((a) => (
        <div key={a.id} role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: AMBER_TINT }}>
          <p className="text-[14px] font-medium" style={{ color: AMBER }}>{a.institution || 'Your bank'} asks you to sign in again. Until you do, its new lines don’t come in.</p>
          <button type="button" onClick={() => relink(a)} disabled={!!busy} className={btn()} style={btnStyle()}>{busy === `relink:${a.id}` ? 'Opening' : 'Sign in again'}</button>
        </div>
      ))}
      {error && <p role="alert" className="rounded-2xl px-4 py-3 text-[14px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>{error}</p>}
      {note && !error && <p role="status" className="text-[14px] font-medium" style={{ color: GREEN }}>{note}</p>}

      <section aria-labelledby="sort-h" className={card} style={cardStyle}>
        <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><h2 id="sort-h" className="text-[17px] font-semibold">{inBooks ? `From your bank${ready ? `, ${ready} to sort` : ''}` : `To sort${n ? `, ${n}` : ''}`}</h2>
            <p className="pb-2 text-[14px]" style={{ color: MUTED }}>{readFailed ? 'Your bank’s lines couldn’t be read just now. Try again in a moment.' : ready ? `Each has a category picked. Check it, then book it.${pendingN ? ` ${pendingN} more still pending at your bank.` : ''}` : n ? `${pendingN} still pending at your bank. They can be sorted once they clear.` : none ? 'No bank connected yet. Connect your business account and its lines show here, sorted for you where they can be.' : inbox === null ? 'Looking at your bank' : 'Nothing to sort. Every line is booked or matched.'}</p></div>
          {ready > 1 && <button type="button" onClick={bookAll} disabled={!!busy} className={btn()} style={btnStyle()}>{busy === 'all' ? 'Booking' : inBooks ? `Book all ${ready} as picked` : 'Book all as picked'}</button>}
        </div>
        {inBooks && !none && <div className="-ml-3 flex flex-wrap items-center pb-1">
          <button type="button" onClick={sync} disabled={!!busy} className={`${quiet} font-medium`} style={{ color: INK }}>{busy === 'sync' ? 'Checking' : 'Check now'}</button>
          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} aria-controls="bank-more" className={`${quiet} font-medium`} style={{ color: INK }}>{more ? 'Hide sorted and matched' : 'Sorted and matched'}</button>
          <button type="button" onClick={() => setLabelPick(!labelPick)} disabled={!!busy} aria-expanded={labelPick} className={`${quiet} font-medium`} style={{ color: INK }}>Add an account</button>
        </div>}
        {(inBooks ? [...(inbox || [])].sort((a, b) => Number(!!a.pending) - Number(!!b.pending)) : inbox || []).slice(0, allShown ? undefined : FIRST).map((bt) => {
          const chosen = cat[bt.id] ?? bt.suggestedCategory ?? catsFor(bt)[0];
          const hint = bt.hint || findCategory(chosen)?.hint || '';
          const warn = !!bt.hint;
          const isIn = bt.direction !== 'out';
          const wait = !!bt.pending;
          return (
            <div key={bt.id} className="py-3" style={{ borderTop: `1px solid ${LINE}` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium">{bt.merchant || bt.name}</p>
                  <p className="text-[13px]" style={{ color: MUTED }}>{dayWords(String(bt.date || ''))}, {String(bt.context || 'Business').toLowerCase()} account</p>
                  {wait && <p className="mt-1 text-[13px]" style={{ color: MUTED }}>Still pending at your bank. It can be sorted once it clears.</p>}
                  {!wait && hint && <p className="mt-1 text-[13px]" style={{ color: warn ? AMBER : MUTED }}>{hint}</p>}
                  {!wait && bt.suggestedMatchTxnId && bt.suggestedMatchLabel && <p className="mt-1 text-[13px]" style={{ color: MUTED }}>The same as {String(bt.suggestedMatchLabel).replace(/ · /g, ', ').replace(/(on )?(\d{4}-\d{2}-\d{2})$/, (_m: string, _on: string, d: string) => `on ${dayWords(d)}`)} in your books?</p>}
                </div>
                <span className="shrink-0 text-[15px] font-semibold tabular-nums" style={{ color: isIn ? GREEN : INK }}>{money(bt)}</span>
              </div>
              {!wait && bt.suggestedBillInstanceId && (
                <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px]" style={{ color: MUTED }}>
                  {billOff[bt.id] ? `${bt.suggestedBillName} stays unpaid when you book it.` : `Booking it marks ${bt.suggestedBillName} paid.`}
                  <button type="button" onClick={() => setBillOff((m) => ({ ...m, [bt.id]: !m[bt.id] }))} className={`min-h-[44px] font-semibold underline underline-offset-2 ${RING}`} style={{ color: INK }}>{billOff[bt.id] ? 'Mark it paid' : 'Keep it unpaid'}</button>
                </p>
              )}
              {extraFor[bt.id] && (
                <div className="mt-2 rounded-2xl p-3" style={{ background: SOFT }}>
                  <p className="text-[14px] font-medium">{extraFor[bt.id].short ? `${usd(extraFor[bt.id].cents)} less than the sale came in. Why?` : `${usd(extraFor[bt.id].cents)} more than the sale came in. What was the extra?`}</p>
                  {!extraFor[bt.id].short && !extraFor[bt.id].tipOk && <p className="text-[13px]" style={{ color: MUTED }}>Nobody is on the sale, so it can’t be a tip for someone.</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {extraFor[bt.id].short ? <>
                      <button type="button" onClick={() => match(bt, [bt.suggestedMatchTxnId], 'fee')} disabled={!!busy} className={btn(true)} style={btnStyle(true)}>A fee was taken</button>
                      <button type="button" onClick={() => match(bt, [bt.suggestedMatchTxnId], 'less')} disabled={!!busy} className={btn()} style={btnStyle()}>They paid less</button>
                    </> : <>
                      {extraFor[bt.id].tipOk && <button type="button" onClick={() => match(bt, [bt.suggestedMatchTxnId], 'tip')} disabled={!!busy} className={btn(true)} style={btnStyle(true)}>A tip</button>}
                      <button type="button" onClick={() => match(bt, [bt.suggestedMatchTxnId], 'other')} disabled={!!busy} className={btn(!extraFor[bt.id].tipOk)} style={btnStyle(!extraFor[bt.id].tipOk)}>Other money in</button>
                    </>}
                    <button type="button" onClick={() => setExtraFor((m) => { const x = { ...m }; delete x[bt.id]; return x; })} className={quiet} style={{ color: MUTED }}>Cancel</button>
                  </div>
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {!wait && <label className="inline-flex items-center gap-2 text-[14px]" style={{ color: MUTED }}>Category
                  <select value={chosen} onChange={(e) => setCat((m) => ({ ...m, [bt.id]: e.target.value }))} disabled={busy === bt.id}
                    className={`h-11 max-w-[220px] rounded-xl bg-[#fff] px-3 text-[14px] ${RING}`} style={{ border: `1px solid ${LINE}`, color: INK }}>
                    {catsFor(bt).map((c) => <option key={c} value={c}>{c}</option>)}
                    {backOn(bt).length > 0 && <optgroup label="Money back on a cost">{backOn(bt).map((c) => <option key={`b:${c}`} value={c}>{c}</option>)}</optgroup>}
                  </select></label>}
                <span className="flex-1" />
                {!wait && <button type="button" onClick={() => book(bt)} disabled={!!busy} className={btn(true)} style={btnStyle(true)}>{busy === bt.id ? 'Saving' : 'Book'}</button>}
                {!wait && bt.suggestedMatchTxnId && <button type="button" onClick={() => match(bt, [bt.suggestedMatchTxnId])} disabled={!!busy} className={btn()} style={btnStyle()}>It’s the same</button>}
                {!wait && <button id={`more-${bt.id}`} type="button" onClick={() => openMatch(bt)} disabled={!!busy} aria-expanded={matchFor === bt.id} className={`${btn()} ${phoneMore(bt.id)}`} style={btnStyle()}>{isIn ? 'Match to a sale' : 'Match to a cost'}</button>}
                {!wait && bt.context === 'Personal' && <button type="button" onClick={() => book(bt, true)} disabled={!!busy} className={`${btn()} ${phoneMore(bt.id)}`} style={btnStyle()}>Book as the business’s</button>}
                {!wait && <button type="button" onClick={() => setReceiptFor(receiptFor === bt.id ? '' : bt.id)} aria-expanded={receiptFor === bt.id} className={`${btn()} ${phoneMore(bt.id)}`} style={btnStyle()}>{receipt[bt.id] ? 'Receipt added' : 'Add a receipt'}</button>}
                <button type="button" onClick={() => skip(bt)} disabled={!!busy} className={`${quiet} ${wait ? '' : phoneMore(bt.id)}`} style={{ color: MUTED }}>Skip</button>
                {!wait && !rowMore[bt.id] && <button type="button" onClick={() => { setRowMore((m) => ({ ...m, [bt.id]: true })); requestAnimationFrame(() => document.getElementById(`more-${bt.id}`)?.focus()); }} aria-label={`More for ${bt.merchant || bt.name}`} className={`${btn()} md:hidden`} style={btnStyle()}>More</button>}
              </div>
              {receiptFor === bt.id && (
                <div className="mt-2 rounded-2xl p-3" style={{ background: SOFT }}>
                  <p className="mb-2 text-[13px]" style={{ color: MUTED }}>It’s kept with the line when you book it.</p>
                  <ImageUpload onImageUploaded={(url: string) => { setReceipt((m) => ({ ...m, [bt.id]: url })); setReceiptFor(''); }} />
                </div>
              )}
              {matchFor === bt.id && (
                <div className="mt-2 rounded-2xl p-3" style={{ background: SOFT }}>
                  <p className="text-[14px] font-medium">{isIn ? 'Which sale is this money for?' : 'Which cost in your books is this?'}</p>
                  <p className="text-[13px]" style={{ color: MUTED }}>Pick one, or several that add up to {usd(Number(bt.amountCents) || 0)} (a check for more than one visit). Nothing new is booked: this is the money for them.</p>
                  {cands === null ? <p className="mt-2 text-[14px]" style={{ color: MUTED }}>Looking in your books</p>
                    : cands.length === 0 ? <p className="mt-2 text-[14px]" style={{ color: MUTED }}>Nothing in your books from the {reach === 45 ? 'six weeks' : reach === 14 ? 'two weeks' : 'week'} before it is waiting for this money.</p>
                    : <div className="mt-2">{cands.map((p) => (
                      <label key={p.key} className="flex min-h-[48px] cursor-pointer items-center gap-3" style={{ borderTop: `1px solid ${LINE}` }}>
                        <input type="checkbox" checked={picked.includes(p.key)} onChange={(e) => setPicked((x) => e.target.checked ? [...x, p.key] : x.filter((k) => k !== p.key))} className="h-5 w-5" style={{ accentColor: INK }} />
                        <span className="min-w-0 flex-1"><span className="block truncate text-[14px]">{p.label}</span>
                          <span className="block text-[13px]" style={{ color: MUTED }}>{p.sub}</span></span>
                        <span className="shrink-0 text-[14px] tabular-nums">{usd(p.cents)}</span>
                        {p.many && <button type="button" onClick={(e) => { e.preventDefault(); setApart((a) => [...a, p.key]); setPicked((x) => x.filter((k) => k !== p.key)); }} className={quiet} style={{ color: MUTED }} aria-label={`Pick ${p.label}’s lines one by one`}>Split</button>}
                      </label>))}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2" style={{ borderTop: `1px solid ${LINE}` }}>
                        <span className="text-[14px]" style={{ color: pickedCents === Number(bt.amountCents) ? GREEN : MUTED }}>{picked.length ? `${usd(pickedCents)} of ${usd(Number(bt.amountCents) || 0)}` : 'None picked yet'}</span>
                        <button type="button" onClick={() => match(bt, pickedOf(cands).flatMap((p) => p.ids))} disabled={!!busy || pickedCents !== Number(bt.amountCents)} className={btn(true)} style={btnStyle(true)}>Match</button>
                      </div></div>}
                  {cands !== null && reach < 45 && (
                    <button type="button" onClick={() => openMatch(bt, reach === 0 ? 14 : 45)} disabled={!!busy} className={`mt-2 ${btn()}`} style={btnStyle()}>
                      {reach === 0 ? 'Look back two weeks' : 'Look back six weeks'}</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!allShown && n > FIRST && <div className="py-2" style={{ borderTop: `1px solid ${LINE}` }}>
          <button type="button" onClick={() => setAllShown(true)} className={btn()} style={btnStyle()}>Show the other {n - FIRST}</button></div>}
      </section>

      {more && <div id="bank-more" className={inBooks ? 'space-y-3' : 'space-y-5'}>
      <section aria-labelledby="auto-h" className={card} style={cardStyle}>
        <h2 id="auto-h" className="text-[17px] font-semibold">Sorted for you</h2>
        <p className="mb-1 text-[14px]" style={{ color: MUTED }}>The last 30 days. Change one and lines from that payee follow.</p>
        {sorted.length === 0 && <p className="py-3 text-[14px]" style={{ color: MUTED, borderTop: `1px solid ${LINE}` }}>Nothing sorted for you in the last 30 days.</p>}
        {sorted.map((bt) => (
          <div key={bt.id} className="py-2.5" style={{ borderTop: `1px solid ${LINE}` }}>
            <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-3">
              <span className="min-w-0"><span className="block truncate text-[15px]">{bt.merchant || bt.name}, {usd(Number(bt.amountCents) || 0)}</span>
                <span className="block text-[13px]" style={{ color: MUTED }}>{bt.appliedRule || 'Sorted'}{bt.changedBy === 'you' ? ', changed by you' : ''}, {dayWords(String(bt.date || ''))}</span></span>
              {changing !== bt.id && <button type="button" onClick={() => { setChanging(bt.id); setChangeTo(bt.appliedRule || catsFor(bt)[0]); }} className={btn()} style={btnStyle()}>Change</button>}
            </div>
            {changing === bt.id && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <select value={changeTo} onChange={(e) => setChangeTo(e.target.value)} aria-label={`New category for ${bt.merchant || bt.name}`} className={`h-11 max-w-[240px] rounded-xl bg-[#fff] px-3 text-[14px] ${RING}`} style={{ border: `1px solid ${LINE}`, color: INK }}>
                  {catsFor(bt).map((c) => <option key={c} value={c}>{c}</option>)}
                  {backOn(bt).length > 0 && <optgroup label="Money back on a cost">{backOn(bt).map((c) => <option key={`b:${c}`} value={c}>{c}</option>)}</optgroup>}</select>
                <button type="button" onClick={() => change(bt)} disabled={!!busy || !changeTo || changeTo === bt.appliedRule} className={btn(true)} style={btnStyle(true)}>Save</button>
                <button type="button" onClick={() => setChanging('')} className={quiet} style={{ color: MUTED }}>Cancel</button>
              </div>
            )}
          </div>
        ))}
      </section>

      <section aria-labelledby="match-h" className={card} style={cardStyle}>
        <h2 id="match-h" className="text-[17px] font-semibold">Matched, nothing to do</h2>
        <p className="mb-1 text-[14px]" style={{ color: MUTED }}>Already in your books, so never counted twice.</p>
        {matched.length === 0 && <p className="py-3 text-[14px]" style={{ color: MUTED, borderTop: `1px solid ${LINE}` }}>Nothing matched in the last 30 days.</p>}
        {matched.map((bt) => (
          <div key={bt.id} className="flex min-h-[56px] items-center justify-between gap-3" style={{ borderTop: `1px solid ${LINE}` }}>
            <span className="min-w-0 flex-1"><span className="block truncate text-[15px]">{bt.merchant || bt.name}</span><span className="block text-[13px]" style={{ color: MUTED }}>{matchedWhy(bt)}, {dayWords(String(bt.date || ''))}</span></span>
            {bt.status === 'matched' && <button type="button" onClick={() => unmatch(bt)} disabled={!!busy} className={quiet} style={{ color: MUTED }}>{busy === bt.id ? 'Undoing' : 'Undo'}</button>}
            <span className="shrink-0 tabular-nums" style={{ color: bt.direction === 'out' ? INK : GREEN }}>{money(bt)}</span>
          </div>
        ))}
      </section>

      <section aria-labelledby="rules-h" className={card} style={cardStyle}>
        <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
          <div><h2 id="rules-h" className="text-[17px] font-semibold">Payees you’ve sorted</h2>
            <p className="text-[14px]" style={{ color: MUTED }}>Lines from them are sorted for you. Sorting bank lines on its own can be turned off on the <a href="/settings/automations#sw:bank-sort" className="underline underline-offset-2" style={{ color: INK }}>Automations page</a>.</p></div>
          <button type="button" onClick={loadRules} aria-expanded={rulesOpen} className={btn()} style={btnStyle()}>{rulesOpen ? 'Hide them' : 'See them'}</button>
        </div>
        {rulesOpen && (rules || []).length === 0 && <p className="py-3 text-[14px]" style={{ color: MUTED, borderTop: `1px solid ${LINE}` }}>None yet. Book a few lines and their payees appear here.</p>}
        {rulesOpen && (rules || []).map((rl: any) => {
          const pick = ruleCat[rl.id] ?? rl.category; const own = pick === CUSTOM_CATEGORY;
          const fromPersonal = String(rl.id).startsWith('personal:') && (rl.context || 'Business') === 'Business';
          return (
            <div key={rl.id} className="py-2.5" style={{ borderTop: `1px solid ${LINE}` }}>
              <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-3">
                <span className="min-w-0"><span className="block truncate text-[15px]">{rl.merchant}</span><span className="block text-[13px]" style={{ color: MUTED }}>{rl.category}, {fromPersonal ? 'from your personal account, booked as the business’s' : String(rl.context || 'Business').toLowerCase()}</span></span>
                <span className="flex flex-wrap items-center gap-2">
                  <select value={pick} aria-label={`Category for ${rl.merchant}`} onChange={(e) => setRuleCat((m) => ({ ...m, [rl.id]: e.target.value }))}
                    className={`h-11 max-w-[220px] rounded-xl bg-[#fff] px-3 text-[14px] ${RING}`} style={{ border: `1px solid ${LINE}`, color: INK }}>
                    {[...new Set([rl.category, ...categoriesFor(rl.type === 'income' ? 'income' : 'expense').map((c) => c.name)])].map((c) => <option key={c} value={c}>{c}</option>)}
                    <option value={CUSTOM_CATEGORY}>Type your own</option></select>
                  {pick !== rl.category && <button type="button" onClick={() => saveRule(rl)} disabled={!!busy || (own && !String(ruleOwn[rl.id] || '').trim())} className={btn(true)} style={btnStyle(true)}>{busy === `rule:${rl.id}` ? 'Saving' : 'Save'}</button>}
                  <button type="button" onClick={async () => { const d = await api({ action: 'rules-delete', ruleId: rl.id }); if (d.ok) setRules((rs) => (rs || []).filter((x: any) => x.id !== rl.id)); }} className={quiet} style={{ color: MUTED }}>Forget</button>
                </span>
              </div>
              {own && <input value={ruleOwn[rl.id] || ''} onChange={(e) => setRuleOwn((m) => ({ ...m, [rl.id]: e.target.value.slice(0, 80) }))} placeholder="Its category" aria-label={`Your own category for ${rl.merchant}`}
                className={`mt-1 h-11 w-full max-w-[320px] rounded-xl bg-[#fff] px-3 text-[14px] ${RING}`} style={{ border: `1px solid ${LINE}`, color: INK }} />}
              {pick !== rl.category && <p className="mt-1 text-[13px]" style={{ color: MUTED }}>Saving changes the lines booked from your bank for it too, except any in a closed month.</p>}
            </div>
          );
        })}
      </section>
      </div>}
    </div>
  );
}
