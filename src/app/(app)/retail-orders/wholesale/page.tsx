'use client';

import {
  addDoc, collection, doc, onSnapshot, updateDoc, type Firestore,
} from 'firebase/firestore';
import {
  ArrowLeft, Ban, Building2, Check, ClipboardCopy, Loader, Plus, RefreshCw, X,
} from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { clampDiscount, generateAccessCode } from '@/lib/retail-wholesale';
import { cn } from '@/lib/utils';

// ─── Wholesale Accounts ───────────────────────────────────────────────────────
// Per-account B2B: each business gets its own access code (revocable without
// disturbing anyone else), an optional extra discount on top of your
// wholesale prices, and a visible history (created / last used). The legacy
// shared house code in Shop Settings keeps working alongside these.

interface WholesaleAccount {
  id: string;
  businessName: string;
  contactName: string;
  email: string;
  accessCode: string;
  extraDiscountPercent: number;
  status: 'active' | 'suspended';
  notes?: string;
  createdAt: string;
  lastUsedAt?: string;
}

const when = (iso?: string) => {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'never' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function WholesaleAccountsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || '';
  const { toast } = useToast();

  const [accounts, setAccounts] = useState<WholesaleAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [bizName, setBizName] = useState('');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [discount, setDiscount] = useState('');
  const [newCode, setNewCode] = useState(generateAccessCode());

  useEffect(() => {
    if (!firestore || !tenantId) return;
    return onSnapshot(collection(firestore as Firestore, `tenants/${tenantId}/wholesaleAccounts`), (snap: any) => {
      const list = snap.docs
        .map((d: any) => ({ ...(d.data() as WholesaleAccount), id: d.id as string }))
        .sort((a: WholesaleAccount, b: WholesaleAccount) => (a.businessName || '').localeCompare(b.businessName || ''));
      setAccounts(list);
      setLoading(false);
    });
  }, [firestore, tenantId]);

  const codeTaken = useMemo(
    () => accounts.some((a) => a.accessCode === newCode),
    [accounts, newCode]
  );

  const copy = (text: string, label: string) => {
    navigator.clipboard?.writeText(text)
      .then(() => toast({ title: `${label} copied` }))
      .catch(() => toast({ variant: 'destructive', title: 'Could not copy' }));
  };

  const create = async () => {
    if (!firestore || !tenantId || busy) return;
    if (!bizName.trim()) { toast({ variant: 'destructive', title: 'Business name is required' }); return; }
    if (codeTaken) { setNewCode(generateAccessCode()); return; }
    setBusy('create');
    try {
      await addDoc(collection(firestore as Firestore, `tenants/${tenantId}/wholesaleAccounts`), {
        businessName: bizName.trim(),
        contactName: contact.trim(),
        email: email.trim().toLowerCase(),
        accessCode: newCode,
        extraDiscountPercent: clampDiscount(discount),
        status: 'active',
        createdAt: new Date().toISOString(),
      });
      toast({ title: `${bizName.trim()} added`, description: `Code ${newCode} — send it to them.` });
      setBizName(''); setContact(''); setEmail(''); setDiscount('');
      setNewCode(generateAccessCode());
      setAddOpen(false);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not add account', description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (a: WholesaleAccount, status: 'active' | 'suspended') => {
    if (!firestore || !tenantId || busy) return;
    setBusy(a.id);
    try {
      await updateDoc(doc(firestore as Firestore, `tenants/${tenantId}/wholesaleAccounts`, a.id), { status });
      toast({ title: `${a.businessName} ${status === 'active' ? 'reactivated' : 'suspended'}` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Update failed', description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const regenerate = async (a: WholesaleAccount) => {
    if (!firestore || !tenantId || busy) return;
    const code = generateAccessCode();
    setBusy(a.id);
    try {
      await updateDoc(doc(firestore as Firestore, `tenants/${tenantId}/wholesaleAccounts`, a.id), { accessCode: code });
      toast({ title: `New code for ${a.businessName}`, description: `${code} — the old code stops working immediately.` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Update failed', description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const setAccountDiscount = async (a: WholesaleAccount, value: string) => {
    if (!firestore || !tenantId) return;
    const pct = clampDiscount(value);
    try {
      await updateDoc(doc(firestore as Firestore, `tenants/${tenantId}/wholesaleAccounts`, a.id), { extraDiscountPercent: pct });
      toast({ title: `${a.businessName}: ${pct}% extra discount` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Update failed', description: e?.message });
    }
  };

  return (
    <div className="min-h-dvh bg-muted/5 pb-24">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
            <Link href="/retail-orders"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-black uppercase tracking-tighter text-xl leading-none">Wholesale Accounts</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">
              {accounts.filter((a) => a.status === 'active').length} active · each business gets its own code
            </p>
          </div>
          <Button onClick={() => setAddOpen(!addOpen)}
            className="h-11 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-md shadow-primary/20">
            {addOpen ? <X className="mr-1.5 h-4 w-4" /> : <Plus className="mr-1.5 h-4 w-4" />}
            {addOpen ? 'Close' : 'Add account'}
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {addOpen && (
          <Card className="border-2 border-primary rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-6 space-y-3">
              <Input placeholder="Business name" aria-label="Business name" autoComplete="organization" value={bizName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBizName(e.target.value)}
                className="h-12 rounded-xl border-2 font-bold text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Contact name" aria-label="Contact name" autoComplete="name" value={contact}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setContact(e.target.value)}
                  className="h-12 rounded-xl border-2 font-bold text-sm" />
                <Input placeholder="Email" aria-label="Wholesale account email" autoComplete="email" type="email" value={email}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                  className="h-12 rounded-xl border-2 font-bold text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Extra discount % (0–50)</Label>
                  <Input inputMode="numeric" placeholder="0" aria-label="Extra discount percent, 0 to 50" value={discount}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDiscount(e.target.value)}
                    className="h-12 rounded-xl border-2 font-black font-mono text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Access code</Label>
                  <div className="flex gap-1.5">
                    <Input readOnly aria-label="Access code for this account" value={newCode} className="h-12 rounded-xl border-2 font-black font-mono text-xs" />
                    <Button variant="outline" size="icon" className="h-12 w-12 rounded-xl border-2 shrink-0"
                      onClick={() => setNewCode(generateAccessCode())}>
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
              <Button disabled={busy === 'create' || !bizName.trim()} onClick={create}
                className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest">
                {busy === 'create' ? <Loader className="h-4 w-4 animate-spin" /> : 'Create account'}
              </Button>
            </CardContent>
          </Card>
        )}

        {loading && <div className="py-20 text-center"><Loader className="w-7 h-7 mx-auto animate-spin text-primary" /></div>}
        {!loading && accounts.length === 0 && !addOpen && (
          <div className="rounded-2xl border-2 border-dashed py-20 text-center space-y-2">
            <Building2 className="w-8 h-8 mx-auto opacity-20" />
            <p className="text-[10px] font-black uppercase tracking-widest opacity-30">No wholesale accounts yet</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 max-w-xs mx-auto">
              The shared house code in Shop Settings still works — accounts add per-business codes, discounts, and revocation.
            </p>
          </div>
        )}

        {accounts.map((a) => (
          <Card key={a.id} className={cn('border-2 rounded-[2rem] overflow-hidden bg-white', a.status === 'suspended' && 'opacity-70')}>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-black uppercase tracking-tight text-sm truncate">{a.businessName}</p>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground truncate">
                    {a.contactName || '—'}{a.email ? ` · ${a.email}` : ''} · last used {when(a.lastUsedAt)}
                  </p>
                </div>
                <Badge variant="outline" className={cn('h-6 px-2.5 font-black text-[8px] uppercase tracking-widest border-2 shrink-0',
                  a.status === 'active' ? 'bg-green-50 border-green-100 text-green-700' : 'bg-slate-100 border-slate-200 text-slate-500')}>
                  {a.status}
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => copy(a.accessCode, 'Code')}
                  className="h-9 px-3.5 rounded-xl border-2 font-black font-mono text-xs flex items-center gap-2 hover:border-primary/40 transition-all">
                  {a.accessCode} <ClipboardCopy className="w-3.5 h-3.5 opacity-50" />
                </button>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Extra %</span>
                  <Input
                    key={`${a.id}-${a.extraDiscountPercent}`}
                    aria-label={`Extra discount percent for ${a.businessName || 'this account'}`}
                    defaultValue={String(a.extraDiscountPercent || 0)}
                    inputMode="numeric"
                    onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
                      if (clampDiscount(e.target.value) !== clampDiscount(a.extraDiscountPercent)) setAccountDiscount(a, e.target.value);
                    }}
                    className="h-9 w-16 rounded-xl border-2 font-black font-mono text-xs text-center" />
                </div>
                <div className="flex gap-2 ml-auto">
                  <Button variant="outline" size="sm" disabled={busy === a.id} onClick={() => regenerate(a)}
                    className="h-9 rounded-xl border-2 font-black uppercase text-[8px] tracking-widest">
                    <RefreshCw className="mr-1 h-3 w-3" /> New code
                  </Button>
                  {a.status === 'active' ? (
                    <Button variant="outline" size="sm" disabled={busy === a.id} onClick={() => setStatus(a, 'suspended')}
                      className="h-9 rounded-xl border-2 font-black uppercase text-[8px] tracking-widest text-destructive">
                      <Ban className="mr-1 h-3 w-3" /> Suspend
                    </Button>
                  ) : (
                    <Button size="sm" disabled={busy === a.id} onClick={() => setStatus(a, 'active')}
                      className="h-9 rounded-xl font-black uppercase text-[8px] tracking-widest">
                      <Check className="mr-1 h-3 w-3" /> Reactivate
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </main>
    </div>
  );
}
