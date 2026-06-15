'use client';

import React, { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, safeNumber } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Search, UserPlus, X, CreditCard, AlertTriangle,
  Star, ChevronRight, Users, User,
} from 'lucide-react';
import { type Client } from '@/lib/data';

function ClientBadges({ client }: { client: Client }) {
  const hasCard  = !!(client.cardOnFile?.token || client.cardOnFile?.paymentMethodId);
  const hasDebt  = safeNumber(client.outstandingBalance) > 0;
  const isMember = !!client.activeMembershipId || client.subscription?.status === 'active';
  if (!hasCard && !hasDebt && !isMember) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap mt-0.5">
      {hasCard && (
        <span className="inline-flex items-center gap-0.5 text-[8px] font-black uppercase tracking-wider text-primary bg-primary/10 rounded-full px-1.5 py-0.5">
          <CreditCard className="w-2.5 h-2.5" /> Card
        </span>
      )}
      {isMember && (
        <span className="inline-flex items-center gap-0.5 text-[8px] font-black uppercase tracking-wider text-amber-700 bg-amber-100 rounded-full px-1.5 py-0.5">
          <Star className="w-2.5 h-2.5" /> Member
        </span>
      )}
      {hasDebt && (
        <span className="inline-flex items-center gap-0.5 text-[8px] font-black uppercase tracking-wider text-destructive bg-destructive/10 rounded-full px-1.5 py-0.5">
          <AlertTriangle className="w-2.5 h-2.5" /> ${safeNumber(client.outstandingBalance).toFixed(0)} owed
        </span>
      )}
    </div>
  );
}

function ClientCard({ client, compact, selected, onClick }: {
  client: Client; compact?: boolean; selected?: boolean; onClick: () => void;
}) {
  const initials = (client.name || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
  const ltv = safeNumber(client.lifetimeValue);
  return (
    <button onClick={onClick} className={cn(
      'w-full text-left rounded-2xl border-2 transition-all active:scale-[0.98] flex items-center gap-3',
      compact ? 'p-3' : 'p-4',
      selected ? 'border-primary bg-primary/5 shadow-md shadow-primary/10' : 'border-border bg-white hover:border-primary/30 hover:bg-primary/[0.02]'
    )}>
      <Avatar className={cn('border-2 rounded-xl shrink-0', compact ? 'h-9 w-9' : 'h-11 w-11', selected ? 'border-primary/30' : 'border-border')}>
        <AvatarImage src={(client as any).avatarUrl} className="object-cover" />
        <AvatarFallback className={cn('font-black text-xs', selected ? 'bg-primary text-white' : 'bg-primary/10 text-primary')}>{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className={cn('font-black uppercase tracking-tight truncate', compact ? 'text-xs' : 'text-sm', selected ? 'text-primary' : 'text-slate-900')}>{client.name}</p>
          {ltv > 0 && !compact && <span className="text-[9px] font-black text-muted-foreground/50 uppercase shrink-0">${ltv.toFixed(0)} LTV</span>}
        </div>
        {!compact && <p className="text-[10px] text-muted-foreground font-bold uppercase truncate mt-0.5">{client.phone || client.email || 'No contact'}</p>}
        <ClientBadges client={client} />
      </div>
      {selected && <ChevronRight className="w-4 h-4 text-primary shrink-0" />}
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
  const selectedClient = useMemo(() => clients.find(c => c.id === selectedClientId), [clients, selectedClientId]);
  const searchPool = isGroupCheckout ? (payerOptions || []) : clients;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...searchPool].sort((a, b) => safeNumber(b.lifetimeValue) - safeNumber(a.lifetimeValue)).slice(0, 8);
    const digits = q.replace(/\D/g, '');
    return searchPool.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      (digits && c.phone?.replace(/\D/g, '').includes(digits))
    ).slice(0, 12);
  }, [searchPool, query]);

  const compact = filtered.length > 4;

  if (selectedClient) {
    return (
      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border-2 border-primary bg-primary/5 p-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12 border-2 border-primary/20 rounded-xl shrink-0">
            <AvatarImage src={(selectedClient as any).avatarUrl} className="object-cover" />
            <AvatarFallback className="font-black text-sm bg-primary text-white">
              {(selectedClient.name || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-black text-sm uppercase tracking-tight text-primary truncate">{selectedClient.name}</p>
            <p className="text-[10px] font-bold text-muted-foreground uppercase truncate">{selectedClient.phone || selectedClient.email || 'Guest'}</p>
            <ClientBadges client={selectedClient} />
          </div>
          <button onClick={() => { onSelect(null); setQuery(''); }}
            className="p-2 rounded-xl hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/40" />
        <Input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Name, phone, or email..."
          className="h-12 pl-10 pr-10 rounded-2xl border-2 bg-white font-bold text-sm shadow-sm" />
        {query && (
          <button onClick={() => { setQuery(''); inputRef.current?.focus(); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted transition-colors">
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      {isGroupCheckout && payerOptions && payerOptions.length > 0 && (
        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground px-1 flex items-center gap-1.5">
          <Users className="w-3 h-3" /> Clients on this booking
        </p>
      )}

      <div className="space-y-1.5">
        <AnimatePresence mode="popLayout">
          {filtered.map((client, i) => (
            <motion.div key={client.id}
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97 }} transition={{ delay: i * 0.02 }}>
              <ClientCard client={client} compact={compact} selected={client.id === selectedClientId} onClick={() => onSelect(client.id)} />
            </motion.div>
          ))}
        </AnimatePresence>

        {query && filtered.length === 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-4 text-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">No client found for &ldquo;{query}&rdquo;</p>
          </motion.div>
        )}

        {walkInMode && !isGroupCheckout && (
          <button onClick={() => onSelect('walk-in')}
            className={cn('w-full flex items-center gap-3 p-3 rounded-2xl border-2 transition-all active:scale-[0.98]',
              selectedClientId === 'walk-in' ? 'border-primary bg-primary/5' : 'border-dashed border-border hover:border-primary/30')}>
            <div className="h-9 w-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
              <User className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="text-left">
              <p className="text-[11px] font-black uppercase tracking-tight text-slate-700">Anonymous Walk-in</p>
              <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">No profile required</p>
            </div>
          </button>
        )}

        <button onClick={onAddNew}
          className="w-full flex items-center gap-3 p-3 rounded-2xl border-2 border-dashed border-primary/20 bg-primary/[0.02] hover:bg-primary/5 hover:border-primary/40 transition-all active:scale-[0.98] group">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
            <UserPlus className="w-4 h-4 text-primary" />
          </div>
          <div className="text-left flex-1">
            <p className="text-[11px] font-black uppercase tracking-tight text-primary">Add New Client</p>
            <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">Create profile and continue</p>
          </div>
          <ChevronRight className="w-4 h-4 text-primary/30 group-hover:text-primary/60 transition-colors shrink-0" />
        </button>
      </div>

      {!query && (
        <p className="text-[8px] font-bold text-muted-foreground/40 uppercase tracking-widest text-center pt-1">
          Top {filtered.length} clients by lifetime value
        </p>
      )}
    </div>
  );
}
