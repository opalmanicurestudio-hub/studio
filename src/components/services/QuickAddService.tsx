'use client';
// src/components/services/QuickAddService.tsx — NEW SERVICE IN FIVE QUESTIONS: name, category, length, price, who can
// book it online. Everything else starts with sensible defaults (timed by the provider, the business's deposit and
// cancellation rules, no products yet) and can be added from the full form afterwards. A business with no services yet
// has no categories to choose from, so it types one (already filled in with "Services", which it can change).
import * as React from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { SettingsStyle } from '@/components/settings/settings-style';

export function QuickAddService({ open, category, categories, onClose, onCreate }: {
  open: boolean; category: string | null; categories: string[]; onClose: () => void;
  onCreate: (svc: { name: string; category: string; duration: number; price: number; online: 'everyone' | 'members' | 'desk' }, thenEdit: boolean) => void;
}) {
  // No categories yet: start on a new one, named "Services" until they change it.
  const firstCat = () => category || categories[0] || '__new'; const firstNew = () => (category || categories.length ? '' : 'Services');
  const [name, setName] = React.useState(''); const [cat, setCat] = React.useState(firstCat); const [newCat, setNewCat] = React.useState(firstNew);
  const [duration, setDuration] = React.useState('60'); const [price, setPrice] = React.useState(''); const [online, setOnline] = React.useState<'everyone' | 'members' | 'desk'>('everyone');
  React.useEffect(() => { if (open) { setName(''); setCat(firstCat()); setNewCat(firstNew()); setDuration('60'); setPrice(''); setOnline('everyone'); } }, [open, category, categories]);   // eslint-disable-line react-hooks/exhaustive-deps
  const finalCat = cat === '__new' ? newCat.trim() : cat; const ready = name.trim().length > 0 && finalCat.length > 0 && Number(duration) > 0 && Number(price) >= 0 && price !== '';
  const submit = (thenEdit: boolean) => { if (!ready) return; onCreate({ name: name.trim(), category: finalCat, duration: Math.round(Number(duration)), price: Math.round(Number(price) * 100) / 100, online }, thenEdit); };
  const field = 'h-12 w-full rounded-xl border px-3 text-[16px]'; const line = { borderColor: 'var(--line)' } as React.CSSProperties;
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="cf-settings cf-legacy w-full p-0 sm:max-w-lg" style={{ background: 'var(--bg, #f7f5f2)' }}>
        <SettingsStyle />
        <SheetHeader className="border-b px-6 pt-6 pb-4" style={{ background: 'var(--card)' }}>
          <SheetTitle className="text-[26px] font-light leading-none">New service</SheetTitle>
          <SheetDescription className="text-[14px] cf-muted">Five things to start. You can add the rest any time.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-6 py-5">
          <label className="block space-y-1.5 text-[13px] font-semibold">What is it called?<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="What clients see when they book" className={field} style={line} /></label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5 text-[13px] font-semibold">Category
              {categories.length > 0 && <select value={cat} onChange={(e) => setCat(e.target.value)} className={field} style={line}>{categories.map((c) => <option key={c} value={c}>{c}</option>)}<option value="__new">New category…</option></select>}
              {cat === '__new' && <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Category name" aria-label={categories.length ? 'New category name' : undefined} className={field} style={line} />}
            </label>
            <label className="block space-y-1.5 text-[13px] font-semibold">How long does it take? (min)<input type="number" inputMode="numeric" min={5} value={duration} onChange={(e) => setDuration(e.target.value)} className={field} style={line} /></label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5 text-[13px] font-semibold">Price ($)<input type="number" inputMode="decimal" step="0.01" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="60.00" className={field} style={line} /></label>
            <label className="block space-y-1.5 text-[13px] font-semibold">Who can book it online?
              <select value={online} onChange={(e) => setOnline(e.target.value as any)} className={field} style={line}><option value="everyone">Everyone</option><option value="members">Members only</option><option value="desk">Nobody — desk only</option></select></label>
          </div>
          <p className="text-[13px] cf-muted">Timed by the provider, with your deposit and cancellation rules and no products yet. You can change all of it afterwards.</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" disabled={!ready} onClick={() => submit(false)} className="h-12 rounded-full px-6 text-[15px] font-semibold disabled:opacity-40" style={{ background: 'hsl(var(--foreground))', color: 'hsl(var(--background))' }}>Create service</button>
            <button type="button" disabled={!ready} onClick={() => submit(true)} className="h-12 rounded-full px-5 text-[15px] font-semibold disabled:opacity-40" style={{ background: 'var(--soft)' }}>Create and add details</button>
          </div>
        </div>
      </SheetContent>
    </Sheet>);
}
