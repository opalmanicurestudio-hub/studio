'use client';
// src/components/inventory/DigitalSection.tsx — SELLING THIS AS A DOWNLOAD, on the product's own page (In the shop).
// Everything about a digital product in one place (lib/digital-product): its format, its files (each replaced as a new
// version, so buyers always get the newest), an optional link, how buyers get it, the access window, the download
// limit, the license and the protection level. Files go to private storage and are only ever opened through the
// buyer's library, watermarked with their name.
import * as React from 'react';
import { Loader, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { uploadPrivateFile } from '@/lib/upload-image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  DELIVERIES, FORMATS, MAX_FILES, MAX_FILE_MB, deliveryOf, digitalProblems, downloadLimitOf, fileId, filesOf,
  legacyFileFields, sizeWords, viewable, type Delivery, type DigitalFile, MAX_PREVIEWS,
} from '@/lib/digital-product';
import { licensesOf, termsOf } from '@/lib/licenses';
import { LicenseManager } from './LicenseManager';

const label = 'text-[10px] font-black uppercase tracking-widest text-muted-foreground';

/** Which license a product starts on: its reusable license if the shop still has it, else its own words, else personal. */
function licenseStart(product: any, tenant: any): string {
  const id = String(product?.licenseId || product?.license?.id || '');
  if (id && id !== 'custom' && licensesOf(tenant).some((l) => l.id === id)) return id;
  if (product?.license?.id && String(product.license.terms || '').trim()) return 'custom';
  return 'personal';
}
const hint = 'text-[10px] font-bold text-muted-foreground';

export function DigitalSection({ product, onSave }: { product: any; onSave: (patch: Record<string, any>) => Promise<void> | void }) {
  const { selectedTenant } = useTenant() as any;
  const tenantId = String(selectedTenant?.id || '');
  const { toast } = useToast();

  const start = React.useMemo(() => ({
    digital: product.digital === true,
    format: String(product.digitalFormat || ''),
    files: filesOf(product),
    link: String(product.digitalUrl || ''),
    delivery: deliveryOf(product),
    days: product.digitalAccessDays ? String(product.digitalAccessDays) : '',
    limitOn: downloadLimitOf(product) !== null,
    limit: String(downloadLimitOf(product) ?? 5),
    // A license the shop reuses (lib/licenses), or words written for this product only ('custom').
    licenseId: licenseStart(product, selectedTenant),
    licenseName: licenseStart(product, selectedTenant) === 'custom' ? String(product.license?.name || '') : '',
    licenseTerms: licenseStart(product, selectedTenant) === 'custom' ? String(product.license?.terms || '') : '',
  }), [product, selectedTenant]);
  const [managing, setManaging] = React.useState(false);
  const policies = licensesOf(selectedTenant);

  const [d, setD] = React.useState(start);
  // The saved product changed (this section saved, or someone else did): follow it, unless there are edits here
  // that haven't been saved, which are never thrown away.
  const base = React.useRef(start);
  React.useEffect(() => {
    if (JSON.stringify(start) === JSON.stringify(base.current)) return;
    setD((cur) => (JSON.stringify(cur) === JSON.stringify(base.current) ? start : cur));
    base.current = start;
  }, [start]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  // Compared as they'd be saved, so a limit typed and then switched off, or "007" days, doesn't keep the section unsaved.
  const norm = (x: typeof d) => ({ ...x, link: x.link.trim(), days: String(Math.max(0, Math.floor(Number(x.days) || 0)) || ''), limit: x.limitOn ? String(Math.floor(Number(x.limit) || 0)) : '', licenseName: x.licenseId === 'custom' ? x.licenseName.trim() : '', licenseTerms: x.licenseId === 'custom' ? x.licenseTerms.trim() : '' });
  const dirty = JSON.stringify(norm(d)) !== JSON.stringify(norm(start));
  const previewCount = d.files.filter((f) => f.preview).length;

  const set = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));

  const picked = policies.find((l) => l.id === d.licenseId) || policies[0];
  const license = d.licenseId === 'custom'
    ? { id: 'custom', name: d.licenseName.trim() || 'License', terms: d.licenseTerms.trim() }
    : { id: picked.id, name: picked.name, terms: termsOf(picked) };
  const draftItem = { digital: d.digital, digitalFiles: d.files, digitalUrl: d.link.trim(), digitalDelivery: d.delivery, license, digitalDownloadLimit: d.limitOn && d.delivery !== 'view' ? (Number(d.limit) >= 1 ? Number(d.limit) : NaN) : 0 };
  const problems = [...digitalProblems(draftItem), ...(d.digital && d.licenseId !== 'custom' && !policies.some((l) => l.id === d.licenseId) ? ['Pick a license.'] : [])];

  /** Upload one file: a new one, or a new version of `replace`. */
  const upload = async (f: File, replace?: DigitalFile) => {
    if (!tenantId) return;
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      toast({ variant: 'destructive', title: 'That file is too large', description: `Keep each file under ${MAX_FILE_MB} MB. For video, use a link or sell it as a course.` });
      return;
    }
    const id = replace?.id && replace.id !== 'main' ? replace.id : fileId();
    setBusy(replace ? replace.id : 'new');
    try {
      const path = `tenants/${tenantId}/digital/${product.id}/${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await uploadPrivateFile(path, f);
      const next: DigitalFile = { id, name: f.name, path, size: f.size, type: f.type || '', version: replace ? replace.version + 1 : 1, addedAt: new Date().toISOString() };
      setD((x) => ({ ...x, files: replace ? x.files.map((g) => (g.id === replace.id ? next : g)) : [...x.files, next].slice(0, MAX_FILES) }));
      // A new version is never a free preview by itself: the full file could go public by mistake. The shop turns it on again.
      toast({ title: replace ? 'New version uploaded' : 'File uploaded', description: replace?.preview ? 'It isn’t a free preview anymore. Tick Free preview again if it should be, then save this section.' : 'Save this section to give it to buyers.' });
    } catch {
      toast({ variant: 'destructive', title: 'The upload didn’t finish', description: 'Check your connection and try again.' });
    } finally { setBusy(null); }
  };

  const save = async () => {
    if (d.digital && problems.length) { toast({ variant: 'destructive', title: 'Not saved yet', description: problems[0] }); return; }
    setSaving(true);
    try {
      const days = Math.max(0, Math.floor(Number(d.days) || 0));
      const limit = Math.max(1, Math.min(999, Math.floor(Number(d.limit) || 1)));
      // The single file a product had before versions gets a real id now, so 'main' never points at another file later.
      const files = d.files.map((f) => (f.id === 'main' ? { ...f, id: fileId() } : f));
      await onSave(d.digital ? {
        digital: true,
        digitalFormat: d.format || null,
        digitalFiles: files,
        ...legacyFileFields(files),
        digitalUrl: d.link.trim() || null,
        digitalDelivery: d.delivery,
        digitalAccessDays: days || null,
        digitalDownloadLimit: d.limitOn ? limit : 0,
        license,
        licenseId: license.id,
        digitalProtection: 'standard',
      } : { digital: false });
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-[1.5rem] border-2 bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black uppercase tracking-tight">Sold as a download</p>
          <p className="text-[11px] font-bold text-muted-foreground">{d.digital || !start.digital ? 'No stock and no shipping. Buyers open it in their library, with their name printed into PDFs.' : 'Turning this off stops new sales as a download. Everyone who already bought it keeps their access.'}</p>
        </div>
        <Switch aria-label="Sold as a download" checked={d.digital} onCheckedChange={(v: boolean) => set({ digital: v })} />
      </div>

      {d.digital && (
        <>
          <div className="space-y-1">
            <Label className={label} htmlFor="dg-format">What it is</Label>
            <select id="dg-format" value={d.format} onChange={(e) => set({ format: e.target.value })} className="h-11 w-full rounded-xl border-2 bg-white px-3 text-sm font-bold">
              <option value="">Choose one</option>
              {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>

          <div className="space-y-2">
            <p className={label}>Files ({d.files.length} of {MAX_FILES})</p>
            {d.files.map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded-xl border-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-black">{f.name}</p>
                  <p className={hint}>{[`Version ${f.version}`, sizeWords(f.size), viewable(f.name) ? 'Opens in the library' : 'Saved to the device', f.preview ? 'Free preview' : ''].filter(Boolean).join(' · ')}</p>
                  {viewable(f.name) && (
                    <label className="mt-1 inline-flex min-h-11 cursor-pointer items-center gap-2 text-[11px] font-bold">
                      <input type="checkbox" className="h-4 w-4" checked={!!f.preview} disabled={!f.preview && previewCount >= MAX_PREVIEWS}
                        aria-describedby="dg-preview-count"
                        onChange={(e) => set({ files: d.files.map((g) => { if (g.id !== f.id) return g; const n: DigitalFile = { ...g }; if (e.target.checked) n.preview = true; else delete n.preview; return n; }) })} />
                      Free preview on the product page
                    </label>
                  )}
                </div>
                <label className="inline-flex h-10 cursor-pointer items-center gap-1 rounded-xl border-2 px-3 text-[10px] font-black uppercase tracking-widest hover:bg-muted" title="Upload a new version">
                  <input type="file" className="sr-only" aria-label={`Upload a new version of ${f.name}`} disabled={!!busy}
                    onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ''; if (x) void upload(x, f); }} />
                  {busy === f.id ? <Loader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}<span className="hidden sm:inline">New version</span>
                </label>
                <Button variant="ghost" size="icon" aria-label={`Remove ${f.name}`} disabled={!!busy} onClick={() => set({ files: d.files.filter((g) => g.id !== f.id) })} className="h-10 w-10 shrink-0 rounded-xl text-muted-foreground">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {d.files.length < MAX_FILES && (
              <label className="flex h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border-2 border-dashed text-[10px] font-black uppercase tracking-widest hover:bg-muted">
                <input type="file" className="sr-only" aria-label="Add a file" disabled={!!busy}
                  onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ''; if (x) void upload(x); }} />
                {busy === 'new' ? <><Loader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Uploading</> : <><Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add a file</>}
              </label>
            )}
            <p className={hint}>PDFs and pictures open in the library; anything else (a zip, audio) is saved. Up to {MAX_FILE_MB} MB each. A new version reaches everyone who bought it.</p>
            <p id="dg-preview-count" className={hint}>{previewCount >= MAX_PREVIEWS ? `${MAX_PREVIEWS} of ${MAX_PREVIEWS} free previews used. Turn one off to choose another. ` : ''}Up to {MAX_PREVIEWS} PDFs or pictures can be free previews: anyone can read them on the product page (PDFs are stamped as a preview), and they come with the purchase too. A preview is the whole file, so upload a short sample (a few pages) rather than marking the full guide.</p>
          </div>

          <div className="space-y-1">
            <Label className={label} htmlFor="dg-link">Link (optional)</Label>
            <Input id="dg-link" value={d.link} placeholder="https://… a video, a course page, a shared folder" onChange={(e) => set({ link: e.target.value })} className="h-11 rounded-xl border-2 font-bold text-xs" />
            <p className={hint}>Shown to buyers in their library beside the files. Anyone with the link itself can open it, so use one with its own sign-in for anything private.</p>
          </div>

          <fieldset className="space-y-2">
            <legend className={label}>How buyers get it</legend>
            {DELIVERIES.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-start gap-3 rounded-xl border-2 px-3 py-2.5">
                <input type="radio" name="dg-delivery" value={o.id} checked={d.delivery === o.id} onChange={() => set({ delivery: o.id as Delivery })} className="mt-1 h-4 w-4" />
                <span><span className="block text-xs font-black">{o.label}</span><span className={hint}>{o.hint}</span></span>
              </label>
            ))}
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className={label} htmlFor="dg-days">Access for</Label>
              <div className="flex items-center gap-2">
                <Input id="dg-days" inputMode="numeric" value={d.days} placeholder="Always" onChange={(e) => set({ days: e.target.value.replace(/\D/g, '').slice(0, 4) })} className="h-11 rounded-xl border-2 text-center font-mono font-bold" />
                <span className="text-xs font-bold">days</span>
              </div>
              <p className={hint}>Blank means theirs to keep. A change only applies to new sales.</p>
            </div>
            <div className="space-y-1">
              <Label className={label} htmlFor="dg-limit">Downloads per copy</Label>
              <div className="flex items-center gap-2">
                <Input id="dg-limit" inputMode="numeric" value={d.limitOn ? d.limit : ''} placeholder="No limit" disabled={!d.limitOn || d.delivery === 'view'} onChange={(e) => set({ limit: e.target.value.replace(/\D/g, '').slice(0, 3) })} className="h-11 rounded-xl border-2 text-center font-mono font-bold" />
                <Switch aria-label="Limit downloads" checked={d.limitOn} disabled={d.delivery === 'view'} onCheckedChange={(v: boolean) => set({ limitOn: v })} />
              </div>
              <p className={hint}>{d.delivery === 'view' ? 'No copies are saved with view online only.' : 'Viewing online is never counted. Applies to new sales; you can add more for any buyer.'}</p>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className={label}>License</legend>
            {policies.map((l) => (
              <label key={l.id} className="flex cursor-pointer items-start gap-3 rounded-xl border-2 px-3 py-2.5">
                <input type="radio" name="dg-license" checked={d.licenseId === l.id} onChange={() => set({ licenseId: l.id })} className="mt-1 h-4 w-4" />
                <span><span className="block text-xs font-black">{l.name}</span><span className={hint}>{termsOf(l)}</span></span>
              </label>
            ))}
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 px-3 py-2.5">
              <input type="radio" name="dg-license" checked={d.licenseId === 'custom'} onChange={() => set({ licenseId: 'custom' })} className="mt-1 h-4 w-4" />
              <span><span className="block text-xs font-black">Words for this product only</span><span className={hint}>Written here and not reused.</span></span>
            </label>
            {d.licenseId === 'custom' && (
              <div className="space-y-2">
                <Input aria-label="License name" value={d.licenseName} placeholder="Name, for example Professional use" onChange={(e) => set({ licenseName: e.target.value.slice(0, 60) })} className="h-11 rounded-xl border-2 font-bold text-xs" />
                <Textarea aria-label="License terms" value={d.licenseTerms} placeholder="What buyers may and may not do with it" onChange={(e) => set({ licenseTerms: e.target.value.slice(0, 800) })} className="min-h-[80px] rounded-xl border-2 font-bold text-xs" />
              </div>
            )}
            <p className={hint}>Buyers see it when they open the item, and it's kept with each sale as it was sold.</p>
            <Button type="button" variant="outline" onClick={() => setManaging(true)} className="h-10 w-full rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">Your licenses</Button>
          </fieldset>
          {managing && <LicenseManager tenantId={tenantId} tenant={selectedTenant} onClose={() => setManaging(false)} onPicked={(id) => set({ licenseId: id })} />}

          <div className="rounded-xl border-2 border-dashed px-3 py-2.5">
            <p className="text-xs font-black">Protection: Standard</p>
            <p className={hint}>Proof it's the buyer to open anything, links that last ten minutes, their name printed into PDFs, and every open counted. Advanced protection comes with the paid add-on.</p>
          </div>

          {problems.length > 0 && (
            <ul className="space-y-1 rounded-xl border-2 border-amber-200 bg-amber-50/60 px-3 py-2.5">
              {problems.map((p) => <li key={p} className="text-[11px] font-bold text-amber-800">{p}</li>)}
            </ul>
          )}
        </>
      )}

      {dirty && (
        <Button onClick={() => void save()} disabled={saving || !!busy} className="h-11 w-full rounded-xl font-black uppercase text-[10px] tracking-widest">
          {saving ? <Loader className="h-4 w-4 animate-spin" /> : 'Save this section'}
        </Button>
      )}
    </div>
  );
}
