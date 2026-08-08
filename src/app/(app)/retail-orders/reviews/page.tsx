'use client';

import { collection, doc, onSnapshot, orderBy, query, updateDoc, deleteDoc, limit, type Firestore } from 'firebase/firestore';
import {
  ArrowLeft, Check, EyeOff, Loader, MessageSquareText, Star, Trash2,
} from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

// ─── Retail review moderation ─────────────────────────────────────────────────
// Every review here was already PROVEN by the API: it can only be written by
// someone holding the order's own QR token, for a product actually on that
// order, once per product per order. So moderation is a judgement on words,
// not a fraud check — publish, hide, or delete. Pending first, because those
// are the ones a shop with auto-publish off is actually waiting on.

type ReviewDoc = {
  id: string;
  productId: string;
  productName?: string;
  orderId?: string;
  rating: number;
  title: string;
  body: string;
  author: string;
  status: 'published' | 'pending' | 'hidden';
  createdAt?: string;
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending:   { label: 'Pending',   cls: 'bg-amber-100 text-amber-900 border-amber-200' },
  published: { label: 'Published', cls: 'bg-emerald-100 text-emerald-900 border-emerald-200' },
  hidden:    { label: 'Hidden',    cls: 'bg-slate-100 text-slate-700 border-slate-200' },
};

export default function RetailReviewsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || '';
  const { toast } = useToast();

  const [reviews, setReviews] = useState<ReviewDoc[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'published' | 'hidden'>('all');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const q = query(
      collection(firestore as Firestore, `tenants/${tenantId}/reviews`),
      orderBy('createdAt', 'desc'),
      limit(200)
    );
    return onSnapshot(
      q,
      (snap: any) => {
        const rows: ReviewDoc[] = snap.docs.map((d: any) => {
          const r = d.data() || {};
          return {
            id: d.id,
            productId: String(r.productId || ''),
            productName: String(r.productName || ''),
            orderId: String(r.orderId || ''),
            rating: Math.max(1, Math.min(5, Number(r.rating) || 0)),
            title: String(r.title || ''),
            body: String(r.body || ''),
            author: String(r.author || 'Verified buyer'),
            status: (['published', 'pending', 'hidden'].includes(r.status) ? r.status : 'pending') as ReviewDoc['status'],
            createdAt: String(r.createdAt || ''),
          };
        });
        setReviews(rows);
        setLoaded(true);
      },
      () => setLoaded(true)
    );
  }, [firestore, tenantId]);

  const setStatus = async (r: ReviewDoc, status: ReviewDoc['status']) => {
    if (!firestore || !tenantId || busy) return;
    setBusy(r.id);
    try {
      await updateDoc(doc(firestore as Firestore, `tenants/${tenantId}/reviews/${r.id}`), { status });
      toast({ title: status === 'published' ? 'Review published' : 'Review hidden', description: `${r.author} \u00b7 ${r.rating}\u2605` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not update review', description: e?.message || 'Try again.' });
    } finally {
      setBusy(null);
    }
  };

  const removeReview = async (r: ReviewDoc) => {
    if (!firestore || !tenantId || busy) return;
    if (!window.confirm('Delete this review permanently? Hiding it keeps a record; deleting does not.')) return;
    setBusy(r.id);
    try {
      await deleteDoc(doc(firestore as Firestore, `tenants/${tenantId}/reviews/${r.id}`));
      toast({ title: 'Review deleted' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not delete review', description: e?.message || 'Try again.' });
    } finally {
      setBusy(null);
    }
  };

  const counts = useMemo(() => ({
    all: reviews.length,
    pending: reviews.filter((r) => r.status === 'pending').length,
    published: reviews.filter((r) => r.status === 'published').length,
    hidden: reviews.filter((r) => r.status === 'hidden').length,
  }), [reviews]);

  const shown = useMemo(() => {
    const list = filter === 'all' ? reviews : reviews.filter((r) => r.status === filter);
    // Pending first inside any view — those are the ones waiting on a human.
    return [...list].sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (b.status === 'pending' && a.status !== 'pending') return 1;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }, [reviews, filter]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 pb-16 sm:p-6">
      <div className="flex h-12 items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to orders board" className="h-10 w-10 shrink-0 rounded-xl">
          <Link href="/retail-orders"><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Link>
        </Button>
        <h1 className="text-xl font-black uppercase tracking-tighter">Product reviews</h1>
        {counts.pending > 0 && (
          <Badge className="ml-auto border-2 bg-amber-100 text-amber-900 border-amber-200 font-black text-[10px] uppercase tracking-widest">
            {counts.pending} pending
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {(['all', 'pending', 'published', 'hidden'] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              'h-9 rounded-xl border-2 px-3 text-[10px] font-black uppercase tracking-widest transition-all',
              filter === f ? 'border-primary bg-primary/5 text-primary' : 'hover:border-primary/30'
            )}
          >
            {f} ({counts[f]})
          </button>
        ))}
      </div>

      {!loaded ? (
        <div className="flex justify-center py-20">
          <Loader className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
          <span className="sr-only">Loading reviews</span>
        </div>
      ) : shown.length === 0 ? (
        <div className="space-y-3 py-20 text-center">
          <MessageSquareText className="mx-auto h-10 w-10 text-primary/30" aria-hidden="true" />
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            {filter === 'all'
              ? 'No reviews yet — customers are invited from their order page after pickup or delivery'
              : `No ${filter} reviews`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => {
            const meta = STATUS_META[r.status];
            return (
              <Card key={r.id} className="rounded-2xl border-2">
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-0.5" role="img" aria-label={`${r.rating} out of 5 stars`}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} className={cn('h-3.5 w-3.5', n <= r.rating ? 'fill-current text-primary' : 'text-muted-foreground/25')} aria-hidden="true" />
                      ))}
                    </div>
                    <Badge className={cn('border-2 font-black text-[9px] uppercase tracking-widest', meta.cls)}>{meta.label}</Badge>
                    <p className="ml-auto text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                      {r.author}
                      {r.createdAt ? ` \u00b7 ${new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                    </p>
                  </div>

                  {(r.productName || r.orderId) && (
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                      {r.productName || r.productId}
                      {r.orderId ? ` \u00b7 order ${r.orderId.slice(0, 8)}` : ''}
                    </p>
                  )}
                  {r.title && <p className="text-xs font-black uppercase tracking-tight">{r.title}</p>}
                  {r.body && <p className="text-sm font-bold leading-relaxed text-muted-foreground">{r.body}</p>}

                  <div className="flex flex-wrap gap-2 pt-1">
                    {r.status !== 'published' && (
                      <Button
                        size="sm"
                        disabled={busy === r.id}
                        onClick={() => setStatus(r, 'published')}
                        className="h-9 rounded-xl font-black uppercase text-[10px] tracking-widest"
                      >
                        {busy === r.id ? <Loader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : (<><Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Publish</>)}
                      </Button>
                    )}
                    {r.status === 'published' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === r.id}
                        onClick={() => setStatus(r, 'hidden')}
                        className="h-9 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest"
                      >
                        <EyeOff className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Hide
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === r.id}
                      onClick={() => removeReview(r)}
                      aria-label={`Delete review by ${r.author}`}
                      className="h-9 rounded-xl font-black uppercase text-[10px] tracking-widest text-destructive hover:text-destructive"
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
