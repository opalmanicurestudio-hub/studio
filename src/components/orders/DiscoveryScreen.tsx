'use client';
// src/components/orders/DiscoveryScreen.tsx — SEARCH AND ASSISTANTS. How the shop shows up on Google and to AI
// assistants, what would help it show up better, and the two links to hand out: the product feed for Google Merchant
// Center (free listings on Google Shopping) and the guide for assistants. Everything else (the sitemap, the search
// markup on every page) runs on its own; nothing here needs writing to be found.
import * as React from 'react';
import Link from 'next/link';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { listedInShop, listingsOf, variantIdsOf } from '@/lib/variants';
import { collectImages, publicDescription } from '@/lib/product-public';
import { listingPriceCents } from '@/lib/retail-orders';
import { seoDescription, seoTitle, SEO_TITLE_MAX } from '@/lib/shop-seo';
import { feedProblem, gtinOf, shopFactsOf } from '@/lib/shop-discovery';
import { agentPolicy } from '@/lib/agent-access';
import { Btn, C, Group, Ic, LargeTitle, Row, Toggle, UndoBar, muted } from './ui';

const Pill = ({ on, children }: { on: boolean; children: React.ReactNode }) => <span className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold" style={on ? { background: C.okSoft, color: C.ok } : { background: C.paper, color: C.muted }}>{children}</span>;

type Check = { id: string; title: string; why: string; items: { id: string; name: string }[] };

export function DiscoveryScreen() {
  const { firestore } = useFirebase() as any; const fs = firestore as Firestore;
  const { selectedTenant, role } = useTenant() as any;
  const { inventory } = useInventory() as any;
  const t: any = selectedTenant || {}; const tenantId = String(t.id || '');
  const rs = t.retailSettings || {};
  const canEdit = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const [toast, setToast] = React.useState('');
  const [open, setOpen] = React.useState('');
  const [origin, setOrigin] = React.useState('');
  // The address search engines are given (lib/shop-discovery seoOrigin): the app's public address, never a preview host.
  React.useEffect(() => { setOrigin((String(process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || '') || window.location.origin).replace(/\/+$/, '')); }, []);

  const facts = shopFactsOf(tenantId, t);
  const assistantsOn = agentPolicy(t).menu;
  const feedOn = rs.productFeed !== false;
  const feedWhy = feedProblem(facts);
  const shown = facts.listed;
  const shopUrl = `${origin}/shop/${tenantId}`;
  const feedUrl = `${shopUrl}/feed.xml`;
  const guideUrl = `${shopUrl}/llms.txt`;

  // The products in the shop, and what would help each show up (the same listing rules the shop and the feed use).
  const checks: Check[] = React.useMemo(() => {
    const all = (inventory || []) as any[]; const listings = listingsOf(all);
    const live = all.filter((i) => listedInShop(i, listings) && i.status !== 'archived' && i.digital !== true);
    const row = (i: any) => ({ id: String(i.id), name: String(i.name || 'Item') });
    return [
      { id: 'photo', title: 'No photo', why: 'Google Shopping won’t list a product without one, and a result with a photo gets far more taps.', items: live.filter((i) => !collectImages(i).length).map(row) },
      { id: 'desc', title: 'Short or missing description', why: 'The description is what search results and assistants quote. Two or three sentences about what it is and who it’s for.', items: live.filter((i) => publicDescription(i).trim().length < 60).map(row) },
      { id: 'price', title: 'No price', why: 'A product without a price can’t be listed or bought.', items: live.filter((i) => !(listingPriceCents(i, 'retail') > 0) && !variantIdsOf(i).length).map(row) },
      { id: 'title', title: 'Search title runs long', why: `Search results cut titles at about ${SEO_TITLE_MAX} characters.`, items: live.filter((i) => String(i.seoTitle || '').trim().length > SEO_TITLE_MAX).map(row) },
      { id: 'gtin', title: 'No barcode', why: 'Optional. A product’s real barcode (UPC or EAN) lets Google match it to the same product elsewhere. Products you make yourself don’t have one, and that’s fine.', items: live.filter((i) => !gtinOf(i) && !variantIdsOf(i).length).map(row) },
    ];
  }, [inventory]);
  const liveCount = React.useMemo(() => { const all = (inventory || []) as any[]; const l = listingsOf(all); return all.filter((i) => listedInShop(i, l) && i.status !== 'archived').length; }, [inventory]);
  const toFix = checks.filter((c) => c.id !== 'gtin' && c.items.length);

  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); setToast(`${what} copied`); } catch { setToast('Couldn’t copy. Press and hold the link to copy it.'); } };
  const setFeed = async (v: boolean) => {
    try { await updateDoc(doc(fs, 'tenants', tenantId), { 'retailSettings.productFeed': v }); setToast(v ? 'Product feed on' : 'Product feed off'); }
    catch { setToast('That didn’t save. Check your connection and try again.'); }
  };

  const title = seoTitle({ shopName: facts.name, productName: '' }) || facts.name;
  const description = seoDescription({ shopName: facts.name, description: facts.tagline });

  return (
    <div className="mx-auto max-w-3xl px-4 pb-32 pt-5 lg:px-8" style={{ color: C.ink }}>
      <Link href="/retail-orders/setup" className="cf-press inline-flex h-11 items-center gap-1 text-[15px]" style={muted}>{Ic.back} Setup</Link>
      <LargeTitle title="Search and assistants" sub="How your shop shows up on Google and to AI assistants." />
      {!facts.listed && <p className="m-0 mt-4 rounded-2xl px-4 py-3 text-[14px] leading-snug" style={{ background: C.warnSoft, color: C.ink }}>Your shop can’t take payments yet, so it isn’t shown to search engines or assistants. Everything below starts working once payments are connected.</p>}
      {facts.listed && facts.paused && <p className="m-0 mt-4 rounded-2xl px-4 py-3 text-[14px] leading-snug" style={{ background: C.warnSoft, color: C.ink }}>Your shop is paused. It stays in search, with products shown as out of stock until you reopen.</p>}

      <section className="mt-7">
        <p className="m-0 px-4 pb-2 text-[13px] font-semibold" style={muted}>In a Google search</p>
        <div className="rounded-2xl p-5" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
          <p className="m-0 truncate text-[13px]" style={muted}>{shopUrl.replace(/^https?:\/\//, '')}</p>
          <p className="m-0 mt-1 text-[20px] leading-tight" style={{ color: C.ok }}>{title}</p>
          <p className="m-0 mt-1 text-[14px] leading-snug" style={{ color: C.muted }}>{description}</p>
        </div>
        <p className="m-0 px-4 pt-2 text-[13px] leading-snug" style={muted}>The words come from your shop name and tagline in the <Link href="/retail-orders/designer" className="underline underline-offset-2">Shop designer</Link>. Each product’s own search title and description are on its Online listing tab.</p>
      </section>

      <Group title="Already done for you" foot="These update on their own whenever you change a product, a price or a policy.">
        <Row label="Sitemap" note={`Lists your shop, ${liveCount} product${liveCount === 1 ? '' : 's'} and your bundles so Google finds every page.`}><Pill on={shown}>{shown ? 'On' : 'Off'}</Pill></Row>
        <Row label="Product details in results" note="Price, in stock or not, star rating, shipping cost and your return window, from your settings."><Pill on={shown}>{shown ? 'On' : 'Off'}</Pill></Row>
        <Row label="Your business" note="Name, logo, address and phone, so Google knows who you are." last><Pill on={shown}>{shown ? 'On' : 'Off'}</Pill></Row>
      </Group>

      <Group title={toFix.length ? `To fix (${toFix.reduce((n, c) => n + c.items.length, 0)})` : 'To fix'} foot={toFix.length ? 'Tap a row to see which products. Fixing these helps them show up and get chosen.' : undefined}>
        {!toFix.length && <Row label="Nothing to fix" note="Every product online has a photo, a description and a price." last><Pill on>All set</Pill></Row>}
        {checks.map((c, k) => !c.items.length ? null : (
          <div key={c.id}>
            <button type="button" onClick={() => setOpen(open === c.id ? '' : c.id)} aria-expanded={open === c.id} className="block w-full text-left">
              <Row label={<span>{c.title} <span style={muted}>· {c.items.length}</span></span>} note={c.why} last={k === checks.length - 1 && open !== c.id}><span style={muted}>{open === c.id ? '−' : '+'}</span></Row>
            </button>
            {open === c.id && (
              <ul className="m-0 list-none px-4 pb-3 pt-1">
                {c.items.slice(0, 40).map((it) => <li key={it.id}><Link href={`/inventory/${it.id}`} className="flex min-h-[44px] items-center justify-between gap-3 text-[15px]">{it.name}<span style={muted}>{Ic.chev}</span></Link></li>)}
                {c.items.length > 40 && <li className="py-2 text-[13px]" style={muted}>and {c.items.length - 40} more</li>}
              </ul>)}
          </div>))}
      </Group>

      <Group title="Google Shopping" foot={<>Free listings on Google: in Merchant Center, add products from a file, choose <em>Scheduled fetch</em>, paste this link and fetch it daily. Prices, stock and shipping stay in step with your shop.</>}>
        <Row label="Share products with Google" note={feedWhy || 'Your product feed is on.'}><Toggle label="Share products with Google" on={feedOn} disabled={!canEdit} onChange={(v) => void setFeed(v)} /></Row>
        <div className="flex items-center gap-3 px-4 py-3">
          <code className="min-w-0 flex-1 truncate text-[13px]" style={muted}>{feedUrl}</code>
          <Btn kind="primary" onClick={() => void copy(feedUrl, 'Feed link')} disabled={!!feedWhy}>Copy</Btn>
        </div>
      </Group>

      <Group title="AI assistants" foot={<>When someone asks an assistant where to buy something you sell, it can read your products, prices, stock and policies, and send them a link. Assistants never place orders or take payment. This follows your <Link href="/settings/booking" className="underline underline-offset-2">Assistants setting</Link>.</>}>
        <Row label="Assistants can read your shop" note={assistantsOn ? 'Your guide and data are public' : 'Turned off in your booking settings'}><Pill on={assistantsOn}>{assistantsOn ? 'On' : 'Off'}</Pill></Row>
        <div className="flex items-center gap-3 px-4 py-3">
          <code className="min-w-0 flex-1 truncate text-[13px]" style={muted}>{guideUrl}</code>
          <Btn kind="primary" onClick={() => void copy(guideUrl, 'Guide link')} disabled={!assistantsOn}>Copy</Btn>
          <a href={guideUrl} target="_blank" rel="noreferrer" className="cf-press inline-flex h-11 items-center px-2 text-[15px] font-semibold">Open</a>
        </div>
      </Group>

      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={24} />}
    </div>);
}
