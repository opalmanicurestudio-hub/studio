'use client';

import { hasRealCard } from '@/lib/card-on-file';
import React, { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { safeNumber } from '@/lib/utils';
import { Icon } from '@/components/pos/desk/kit';

// Colours come from the desk theme (white or black); the fallbacks keep it right anywhere else it's used.
const C = { ink: 'var(--ink, #16171a)', muted: 'var(--muted, #6d7075)', line: 'var(--line, #ececee)', soft: 'var(--soft, #f5f5f7)', card: 'var(--card, #fff)', paper: 'var(--paper, #fff)', ok: 'var(--ok, #1f7a4d)', warn: 'var(--warn, #a15c07)', accent: 'var(--accent, #16171a)', accentInk: 'var(--accent-ink, #fff)' };
const initialsOf = (n: string) => (n || '?').split(' ').filter(Boolean).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
function Face({ client, size = 40, on }: { client: Client; size?: number; on?: boolean }) {
  const url = (client as any).avatarUrl;
  return url ? <img src={url} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
    : <span className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold" style={{ width: size, height: size, fontSize: size > 40 ? 15 : 12.5, background: on ? C.accent : C.soft, color: on ? C.accentInk : C.ink }}>{initialsOf(client.name || '')}</span>;
}
import { type Client } from '@/lib/data';
import { useClient, useClientSearch, useDebounced, useTopClients } from '@/hooks/use-clients';

function ClientBadges({ client }: { client: Client }) {
  const hasCard  = !!hasRealCard(client);
  const hasDebt  = safeNumber(client.outstandingBalance) > 0;
  const isMember = !!client.activeMembershipId || client.subscription?.status === 'active';
  if (!hasCard && !hasDebt && !isMember) return null;
  const chip = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold';
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      {hasCard && <span className={chip} style={{ background: C.soft, color: C.muted }}><Icon name="card" size={12} />Card on file</span>}
      {isMember && <span className={chip} style={{ background: `color-mix(in srgb, ${C.ok} 12%, transparent)`, color: C.ok }}><Icon name="sparkle" size={12} />Member</span>}
      {hasDebt && <span className={chip} style={{ background: `color-mix(in srgb, ${C.warn} 12%, transparent)`, color: C.warn }}><Icon name="alert" size={12} />${safeNumber(client.outstandingBalance).toFixed(0)} owed</span>}
    </span>
  );
}

function ClientCard({ client, compact, selected, onClick }: { client: Client; compact?: boolean; selected?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className={`flex w-full items-center gap-3 rounded-2xl text-left transition active:scale-[.99] ${compact ? 'p-2.5' : 'p-3'}`}
      style={{ border: `1px solid ${selected ? C.ink : C.line}`, background: selected ? C.soft : C.card }}>
      <Face client={client} size={compact ? 34 : 40} on={selected} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-semibold">{client.name}</span>
        {!compact && <span className="block truncate text-[12.5px]" style={{ color: C.muted }}>{client.phone || client.email || 'No contact details'}</span>}
        <ClientBadges client={client} />
      </span>
      <Icon name="chevron" size={16} style={{ color: C.muted }} />
    </button>
  );
}

interface GuestSearchProps {
  clients:          Client[];
  selectedClientId: string | null;
  onSelect:         (clientId: string | null) => void;
  onAddNew:         () => void;
  payerOptions?:    Client[];
  isGroupCheckout?: boolean;
  walkInMode?:      boolean;
}

export function GuestSearch({ clients, selectedClientId, onSelect, onAddNew, payerOptions, isGroupCheckout = false, walkInMode = false }: GuestSearchProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { client: loadedSelected } = useClient(selectedClientId && !clients.some(c => c.id === selectedClientId) ? selectedClientId : null);
  const selectedClient = useMemo(() => clients.find(c => c.id === selectedClientId) || loadedSelected || undefined, [clients, selectedClientId, loadedSelected]);
  // Anyone can be found by searching on the server (hooks/use-clients); before typing, the biggest spenders.
  const settled = useDebounced(isGroupCheckout ? '' : query, 200);
  const { clients: found } = useClientSearch(settled, 12);
  const { clients: top } = useTopClients(6, !isGroupCheckout);
  const searchPool = isGroupCheckout ? (payerOptions || []) : clients;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    const local = (pool: Client[]) => pool.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      (digits && c.phone?.replace(/\D/g, '').includes(digits)));
    const uniq = (xs: Client[]) => { const m = new Map<string, Client>(); xs.forEach((c) => m.set(c.id, c)); return [...m.values()]; };
    if (isGroupCheckout) return !q ? [...searchPool].sort((a, b) => safeNumber(b.lifetimeValue) - safeNumber(a.lifetimeValue)).slice(0, 6) : local(searchPool).slice(0, 12);
    if (!q) return uniq([...top, ...[...searchPool].sort((a, b) => safeNumber(b.lifetimeValue) - safeNumber(a.lifetimeValue))]).slice(0, 6);
    return uniq([...found, ...local(searchPool)]).slice(0, 12);
  }, [searchPool, query, found, top, isGroupCheckout]);

  const compact = filtered.length > 4;
  const fmtPhone = (p?: string) => { const d = String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p || ''; };

  if (selectedClient) {
    return (
      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 rounded-2xl p-3" style={{ border: `1px solid ${C.line}`, background: C.soft }}>
        <Face client={selectedClient} size={46} on />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold">{selectedClient.name}</p>
          <p className="truncate text-[13px]" style={{ color: C.muted }}>{fmtPhone(selectedClient.phone) || selectedClient.email || 'Guest'}</p>
          <ClientBadges client={selectedClient} />
        </div>
        <button type="button" onClick={() => { onSelect(null); setQuery(''); }} aria-label={`Change who’s paying (now ${selectedClient.name})`}
          className="h-10 shrink-0 rounded-full px-4 text-[13px] font-semibold" style={{ background: C.card, border: `1px solid ${C.line}`, color: C.ink }}>Change</button>
      </motion.div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="flex h-12 items-center gap-2.5 rounded-2xl px-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
        <Icon name="search" size={17} style={{ color: C.muted }} />
        <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, phone or email" aria-label="Find a client"
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" style={{ color: C.ink }} />
        {query && <button type="button" aria-label="Clear the search" onClick={() => { setQuery(''); inputRef.current?.focus(); }} style={{ color: C.muted }}><Icon name="close" size={15} /></button>}
      </label>

      {isGroupCheckout && payerOptions && payerOptions.length > 0 && <p className="flex items-center gap-1.5 px-1 text-[12.5px]" style={{ color: C.muted }}><Icon name="users" size={14} />Clients on this booking</p>}

      <div className="space-y-1.5">
        <AnimatePresence mode="popLayout">
          {filtered.map((client, i) => (
            <motion.div key={client.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ delay: i * 0.02 }}>
              <ClientCard client={client} compact={compact} selected={client.id === selectedClientId} onClick={() => onSelect(client.id)} />
            </motion.div>
          ))}
        </AnimatePresence>

        {query && filtered.length === 0 && <p className="py-3 text-center text-[13px]" style={{ color: C.muted }}>No client matches “{query}”.</p>}

        {walkInMode && !isGroupCheckout && (
          <button type="button" onClick={() => onSelect('walk-in')} className="flex w-full items-center gap-3 rounded-2xl p-3 text-left"
            style={{ border: `1px ${selectedClientId === 'walk-in' ? 'solid' : 'dashed'} ${selectedClientId === 'walk-in' ? C.ink : C.line}` }}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: C.soft }}><Icon name="walk" size={17} /></span>
            <span><span className="block text-[14px] font-semibold">Walk-in, no profile</span><span className="block text-[12.5px]" style={{ color: C.muted }}>Their name isn’t needed for this sale</span></span>
          </button>
        )}

        <button type="button" onClick={onAddNew} className="flex w-full items-center gap-3 rounded-2xl p-3 text-left" style={{ border: `1px dashed ${C.line}` }}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: C.soft }}><Icon name="plus" size={17} /></span>
          <span className="flex-1"><span className="block text-[14px] font-semibold">Add a new client</span><span className="block text-[12.5px]" style={{ color: C.muted }}>Make their profile, then carry on</span></span>
          <Icon name="chevron" size={16} style={{ color: C.muted }} />
        </button>
      </div>

      {!query && filtered.length > 0 && <p className="pt-1 text-center text-[12px]" style={{ color: C.muted }}>Your {filtered.length} most loyal clients · search to find anyone</p>}
    </div>
  );
}
