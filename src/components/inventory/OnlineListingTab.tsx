'use client';

// ─── src/components/inventory/OnlineListingTab.tsx ───────────────────────────
// Everything about how a product appears in the shop, on the product's OWN
// page — where a product's other facts already live.
//
// Why this exists: the same nineteen fields lived in Shop Settings, so you had
// to know which half of a product you wanted before you knew which screen to
// open. And several were edited as a private little syntax — "Size: 15 mL"
// per line, "Size | Small:0, Large:8", and worst, a raw database id typed by
// hand to link a variant. Those fail SILENTLY: a missing colon produces
// nothing, with no error and no hint. Structured rows can't fail that way.
//
// Saving is per section, not one button at the bottom of a long page: a phone
// that rings mid-edit shouldn't cost you the work you already did.

import { Check, ChevronDown, Loader, Plus, Trash2 } from 'lucide-react';
import React, { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { storefrontBlockers, parseOptionGroups, optionGroupsToText, type OptionGroup } from '@/lib/retail-orders';
import { seoTitle, seoDescription, SEO_TITLE_MAX, SEO_DESC_MAX } from '@/lib/shop-seo';
import { cn } from '@/lib/utils';

type Item = any;

interface Props {
  product: Item;
  /** Every retail item, for the variant picker. */
  inventory: Item[];
  onSave: (patch: Record<string, any>) => Promise<void> | void;
}

/** One collapsible section with its own save — the unit of work. */
function Section({
  title, hint, children, onSave, dirty,
}: { title: string; hint: string; children: React.ReactNode; onSave: () => void; dirty: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-[1.5rem] border-2 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-black uppercase tracking-tight text-sm">{title}</span>
          <span className="mt-0.5 block text-[11px] font-bold text-muted-foreground">{hint}</span>
        </span>
        {dirty && (
          <Badge className="bg-amber-500 text-white border-none h-5 px-2 font-black text-[8px] uppercase tracking-widest">
            Unsaved
          </Badge>
        )}
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && (
        <div className="space-y-3 border-t-2 px-5 py-4">
          {children}
          <Button
            disabled={!dirty || busy}
            onClick={async () => { setBusy(true); try { await onSave(); } finally { setBusy(false); } }}
            className="h-11 w-full rounded-xl font-black uppercase text-[10px] tracking-widest"
          >
            {busy ? <Loader className="h-4 w-4 animate-spin" /> : dirty ? 'Save this section' : 'Saved'}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Repeatable rows — the structured replacement for "one per line" text. */
function RowList({
  rows, onChange, placeholders, addLabel,
}: {
  rows: string[][];
  onChange: (rows: string[][]) => void;
  placeholders: string[];
  addLabel: string;
}) {
  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2">
          {row.map((cell, j) => (
            <Input
              key={j}
              value={cell}
              placeholder={placeholders[j]}
              aria-label={`${placeholders[j]} ${i + 1}`}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const next = rows.map((r) => [...r]);
                next[i][j] = e.target.value;
                onChange(next);
              }}
              className="h-11 flex-1 rounded-xl border-2 font-bold text-xs"
            />
          ))}
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove row ${i + 1}`}
            onClick={() => onChange(rows.filter((_, k) => k !== i))}
            className="h-11 w-11 shrink-0 rounded-xl text-muted-foreground"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        onClick={() => onChange([...rows, placeholders.map(() => '')])}
        className="h-10 w-full rounded-xl border-2 border-dashed font-black uppercase text-[10px] tracking-widest"
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {addLabel}
      </Button>
    </div>
  );
}

export function OnlineListingTab({ product, inventory, onSave }: Props) {
  // Draft state per section, seeded from the product. Sections are saved
  // independently, so an unfinished one can't hold another hostage.
  const [desc, setDesc] = useState<string>(product.onlineDescription || '');
  const [howTo, setHowTo] = useState<string>(product.howToUse || '');
  const [specs, setSpecs] = useState<string[][]>(
    (Array.isArray(product.specs) ? product.specs : [])
      .map((sp: any) => (typeof sp === 'string'
        ? [sp.split(':')[0]?.trim() || '', sp.split(':').slice(1).join(':').trim()]
        : [String(sp?.label || ''), String(sp?.value || '')]))
      .filter((r: string[]) => r[0] || r[1]),
  );
  const [kit, setKit] = useState<string[][]>(
    (Array.isArray(product.kitContents) ? product.kitContents : []).map((k: string) => [String(k)]),
  );
  const [showOnline, setShowOnline] = useState<boolean>(product.showOnline === true);
  const [seoT, setSeoT] = useState<string>(product.seoTitle || '');
  const [seoD, setSeoD] = useState<string>(product.seoDescription || '');
  const [groups, setGroups] = useState<OptionGroup[]>(
    Array.isArray(product.optionGroups) ? product.optionGroups : [],
  );

  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const flash = (what: string) => { setSavedFlash(what); setTimeout(() => setSavedFlash(null), 2000); };

  // Live blockers, from the SAME rules the server enforces, so the toggle can
  // explain itself instead of silently doing nothing.
  const blockers = useMemo(
    () => storefrontBlockers({ ...product, showOnline }),
    [product, showOnline],
  );

  // Candidates for a variant link: retail items that aren't this product and
  // aren't themselves parents — variants must never nest.
  const variantCandidates = useMemo(
    () => (inventory || [])
      .filter((i) => i.type === 'retail' && i.id !== product.id && !(Array.isArray(i.optionGroups) && i.optionGroups.some((g: any) => g.choices?.some((c: any) => c.variantProductId))))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [inventory, product.id],
  );

  const dirty = {
    copy: desc !== (product.onlineDescription || '') || howTo !== (product.howToUse || ''),
    specs: JSON.stringify(specs) !== JSON.stringify(
      (Array.isArray(product.specs) ? product.specs : []).map((sp: any) => (typeof sp === 'string'
        ? [sp.split(':')[0]?.trim() || '', sp.split(':').slice(1).join(':').trim()]
        : [String(sp?.label || ''), String(sp?.value || '')])).filter((r: string[]) => r[0] || r[1])),
    kit: JSON.stringify(kit) !== JSON.stringify((Array.isArray(product.kitContents) ? product.kitContents : []).map((k: string) => [String(k)])),
    options: optionGroupsToText(groups) !== optionGroupsToText(Array.isArray(product.optionGroups) ? product.optionGroups : []),
    publish: showOnline !== (product.showOnline === true),
    seo: seoT !== (product.seoTitle || '') || seoD !== (product.seoDescription || ''),
  };

  // What a search result will actually look like. Both fields fall back to
  // copy that already exists, so leaving them blank is a valid answer rather
  // than a missing chore.
  const previewTitle = seoTitle({ shopName: '', productName: product.name, seoTitle: seoT });
  const previewDesc = seoDescription({ shopName: '', productName: product.name, description: desc, seoDescription: seoD });

  return (
    <div className="space-y-4 text-left">
      <div className={cn('rounded-[1.5rem] border-2 p-5',
        blockers.length === 0 ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={cn('text-[10px] font-black uppercase tracking-widest',
              blockers.length === 0 ? 'text-emerald-700' : 'text-amber-800')}>
              {blockers.length === 0 ? 'Live in your shop' : 'Not online yet'}
            </p>
            <p className="mt-1 text-xs font-bold text-muted-foreground">
              {blockers.length === 0
                ? 'Customers can find and buy this right now.'
                : blockers.join(' · ')}
            </p>
          </div>
          <Switch
            aria-label="Show this product in the online shop"
            checked={showOnline}
            onCheckedChange={(v: boolean) => setShowOnline(v)}
          />
        </div>
        {dirty.publish && (
          <Button
            onClick={async () => { await onSave({ showOnline }); flash('publish'); }}
            className="mt-3 h-11 w-full rounded-xl font-black uppercase text-[10px] tracking-widest"
          >
            {showOnline ? 'Publish to the shop' : 'Take it off the shop'}
          </Button>
        )}
      </div>

      <Section
        title="What customers read"
        hint="The description and how-to-use on the product page."
        dirty={dirty.copy}
        onSave={async () => { await onSave({ onlineDescription: desc.trim(), howToUse: howTo.trim() }); flash('copy'); }}
      >
        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Description</Label>
        <Textarea
          aria-label="Online description"
          placeholder="What is it, who is it for, why does it work?"
          value={desc}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDesc(e.target.value)}
          className="min-h-[110px] rounded-xl border-2 font-bold text-sm"
        />
        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">How to use</Label>
        <Textarea
          aria-label="How to use"
          placeholder="Steps, timings, anything that saves them a message later."
          value={howTo}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setHowTo(e.target.value)}
          className="min-h-[90px] rounded-xl border-2 font-bold text-sm"
        />
      </Section>

      <Section
        title="Specs"
        hint="Size, ingredients, finish — shown as a table."
        dirty={dirty.specs}
        onSave={async () => {
          await onSave({
            specs: specs.filter((r) => r[0].trim() || r[1].trim()).map((r) => `${r[0].trim()}: ${r[1].trim()}`),
          });
          flash('specs');
        }}
      >
        <RowList rows={specs} onChange={setSpecs} placeholders={['Label (e.g. Size)', 'Value (e.g. 15 mL)']} addLabel="Add a spec" />
      </Section>

      <Section
        title="What's inside"
        hint="For kits and sets — each piece a customer could report a problem with."
        dirty={dirty.kit}
        onSave={async () => {
          await onSave({ kitContents: kit.map((r) => r[0].trim()).filter(Boolean).slice(0, 40) });
          flash('kit');
        }}
      >
        <RowList rows={kit} onChange={setKit} placeholders={['Piece (e.g. Base coat 15 mL)']} addLabel="Add a piece" />
      </Section>

      <Section
        title="Choices &amp; variants"
        hint="Sizes and shades that hold their own stock, or extras that only change the price."
        dirty={dirty.options}
        onSave={async () => { await onSave({ optionGroups: groups }); flash('options'); }}
      >
        {groups.length === 0 && (
          <p className="text-[11px] font-bold text-muted-foreground">
            No choices yet. Add one if this product comes in sizes or shades.
          </p>
        )}
        {groups.map((g, gi) => (
          <div key={g.id || gi} className="rounded-2xl border-2 p-3 space-y-2">
            <div className="flex gap-2">
              <Input
                value={g.name}
                aria-label={`Choice group ${gi + 1} name`}
                placeholder="Group name (e.g. Size)"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const next = [...groups];
                  next[gi] = { ...g, name: e.target.value };
                  setGroups(next);
                }}
                className="h-11 flex-1 rounded-xl border-2 font-bold text-xs"
              />
              <Button
                variant="ghost" size="icon"
                aria-label={`Remove choice group ${gi + 1}`}
                onClick={() => setGroups(groups.filter((_, k) => k !== gi))}
                className="h-11 w-11 shrink-0 rounded-xl text-muted-foreground"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {g.choices.map((c, ci) => (
              <div key={c.id || ci} className="grid grid-cols-1 gap-2 rounded-xl border-2 border-dashed p-2 sm:grid-cols-[1fr_120px]">
                <Input
                  value={c.label}
                  aria-label={`Choice ${ci + 1} label`}
                  placeholder="Choice (e.g. 30 mL)"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const next = [...groups];
                    const choices = [...g.choices];
                    choices[ci] = { ...c, label: e.target.value };
                    next[gi] = { ...g, choices };
                    setGroups(next);
                  }}
                  className="h-11 rounded-xl border-2 font-bold text-xs"
                />
                <Input
                  value={c.deltaCents ? (c.deltaCents / 100).toFixed(2) : ''}
                  aria-label={`Choice ${ci + 1} extra cost`}
                  inputMode="decimal"
                  placeholder="+$0.00"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const next = [...groups];
                    const choices = [...g.choices];
                    choices[ci] = { ...c, deltaCents: Math.round((Number(e.target.value) || 0) * 100) };
                    next[gi] = { ...g, choices };
                    setGroups(next);
                  }}
                  className="h-11 rounded-xl border-2 font-bold text-xs"
                />
                <select
                  aria-label={`Which product is choice ${ci + 1}`}
                  value={c.variantProductId || ''}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                    const next = [...groups];
                    const choices = [...g.choices];
                    const v = e.target.value;
                    choices[ci] = v ? { ...c, variantProductId: v } : { id: c.id, label: c.label, deltaCents: c.deltaCents };
                    next[gi] = { ...g, choices };
                    setGroups(next);
                  }}
                  className="h-11 rounded-xl border-2 bg-white px-2 text-xs font-bold sm:col-span-2"
                >
                  <option value="">Just changes the price (no stock of its own)</option>
                  {variantCandidates.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} — {Math.max(0, Number(v.totalStock) || 0)} in stock
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  onClick={() => {
                    const next = [...groups];
                    next[gi] = { ...g, choices: g.choices.filter((_, k) => k !== ci) };
                    setGroups(next);
                  }}
                  className="h-9 rounded-xl font-black uppercase text-[9px] tracking-widest text-muted-foreground sm:col-span-2"
                >
                  Remove this choice
                </Button>
              </div>
            ))}

            <Button
              variant="outline"
              onClick={() => {
                const next = [...groups];
                next[gi] = { ...g, choices: [...g.choices, { id: `c${gi}-${g.choices.length}`, label: '', deltaCents: 0 }] };
                setGroups(next);
              }}
              className="h-10 w-full rounded-xl border-2 border-dashed font-black uppercase text-[10px] tracking-widest"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Add a choice
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          onClick={() => setGroups([...groups, { id: `g${groups.length}`, name: '', choices: [] }])}
          className="h-10 w-full rounded-xl border-2 font-black uppercase text-[10px] tracking-widest"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Add a choice group
        </Button>
        <p className="text-[10px] font-bold text-muted-foreground">
          A choice that picks a product keeps its own stock and sells out on its own. A choice with no product just adds to the price.
        </p>
      </Section>

      <Section
        title="Findable on Google"
        hint="How this product looks in search results and when someone shares the link."
        dirty={dirty.seo}
        onSave={async () => { await onSave({ seoTitle: seoT.trim(), seoDescription: seoD.trim() }); flash('seo'); }}
      >
        <div className="rounded-xl border-2 bg-muted/20 p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Preview</p>
          <p className="mt-1 truncate text-sm font-bold text-[#1a0dab]">{previewTitle}</p>
          <p className="text-[11px] font-bold text-emerald-800 truncate">your-shop.com &rsaquo; product</p>
          <p className="mt-0.5 text-[11px] font-medium text-muted-foreground line-clamp-2">{previewDesc}</p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Search title</Label>
            <span className={cn('text-[10px] font-black', seoT.length > SEO_TITLE_MAX ? 'text-destructive' : 'text-muted-foreground')}>
              {seoT.length}/{SEO_TITLE_MAX}
            </span>
          </div>
          <Input
            aria-label="Search title"
            placeholder={`Leave blank to use "${product.name}"`}
            value={seoT}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSeoT(e.target.value)}
            className="h-11 rounded-xl border-2 font-bold text-xs"
          />
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Search description</Label>
            <span className={cn('text-[10px] font-black', seoD.length > SEO_DESC_MAX ? 'text-destructive' : 'text-muted-foreground')}>
              {seoD.length}/{SEO_DESC_MAX}
            </span>
          </div>
          <Textarea
            aria-label="Search description"
            placeholder="Leave blank to use your description above."
            value={seoD}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSeoD(e.target.value)}
            className="min-h-[70px] rounded-xl border-2 font-bold text-sm"
          />
        </div>
        <p className="text-[10px] font-bold text-muted-foreground">
          Both are optional. Google often rewrites descriptions anyway — write for the person deciding whether to click, not for the search engine.
        </p>
      </Section>

      {savedFlash && (
        <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-emerald-700">
          <Check className="h-3.5 w-3.5" aria-hidden="true" /> Saved
        </p>
      )}
    </div>
  );
}
