'use client';
// src/components/import/PhotosDrawer.tsx — MOVING IN → CLIENT PHOTOS AND FILES (lib/import-files). Choose the folder your
// old app gave you (a folder per client works best) or the files themselves. Each one is matched to a client by its
// folder or file name; the ones that aren't clear are listed so you can pick the client or leave them out. Then they're
// uploaded and show on each client's profile (Photos), marked as from your old app. Undo removes them from the profiles.
import * as React from 'react';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useFirebase } from '@/firebase';
import { payPost } from '@/components/pay/pay-client';
import { matchFile, clientNameIndex, fileKind, OK_FILE, type LiteClient } from '@/lib/import-files';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const MAX = 25 * 1024 * 1024;
type Item = { file: File; path: string; client: LiteClient | null; skip?: boolean };

export function PhotosDrawer({ tenantId, app, appName, onClose, onDone }: { tenantId: string; app: string; appName: string; onClose: () => void; onDone: () => void }) {
  const { firebaseApp } = useFirebase() as any;
  const [clients, setClients] = React.useState<LiteClient[] | null>(null); const [items, setItems] = React.useState<Item[]>([]); const [err, setErr] = React.useState('');
  const [progress, setProgress] = React.useState<number | null>(null); const [done, setDone] = React.useState<{ added: number; failed: number } | null>(null);
  React.useEffect(() => { payPost('/api/import', { tenantId, action: 'clients-lite' }).then((r) => setClients(r.ok ? r.clients : [])); }, [tenantId]);
  const ix = React.useMemo(() => clientNameIndex(clients || []), [clients]);
  const byName = React.useMemo(() => new Map((clients || []).map((c) => [c.name.toLowerCase(), c])), [clients]);
  const pick = (list: FileList | null) => { if (!list) return; setErr(''); setDone(null);
    const all = Array.from(list); const ok = all.filter((f) => OK_FILE.test(f.name) && f.size <= MAX && !/^\./.test(f.name));
    const left = all.length - ok.length;
    setItems(ok.slice(0, 3000).map((f) => { const path = (f as any).webkitRelativePath || f.name; return { file: f, path, client: matchFile(path, clients || [], ix) }; }));
    if (left) setErr(`${left} file${left === 1 ? ' was' : 's were'} left out — only photos, PDFs and documents up to 25 MB come over.`); };
  const matched = items.filter((x) => x.client && !x.skip); const unclear = items.filter((x) => !x.client && !x.skip);
  const people = new Set(matched.map((x) => x.client!.id)).size;
  const save = async () => {
    if (!firebaseApp) { setErr('Sign in again, then try once more.'); return; }
    const storage = getStorage(firebaseApp); const importId = `imp${Date.now().toString(36)}`; const out: any[] = []; let failed = 0; setProgress(0);
    const list = matched; let i = 0;
    const one = async (x: Item) => { const safe = x.file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);
      try { const r = storageRef(storage, `tenants/${tenantId}/client-files/${x.client!.id}/${importId}/${Date.now().toString(36)}_${safe}`);
        await uploadBytes(r, x.file, { contentType: x.file.type || undefined }); out.push({ clientId: x.client!.id, url: await getDownloadURL(r), name: x.file.name, kind: fileKind(x.file.name, x.file.type), size: x.file.size, takenAt: x.file.lastModified ? new Date(x.file.lastModified).toISOString() : null });
      } catch { failed++; } setProgress(Math.round((++i / list.length) * 100)); };
    for (let k = 0; k < list.length; k += 4) await Promise.all(list.slice(k, k + 4).map(one));
    let added = 0; for (let k = 0; k < out.length; k += 100) { const r = await payPost('/api/import', { tenantId, action: 'files-save', importId, app, appName, files: out.slice(k, k + 100) }); if (r.ok) added += r.added; else { setErr(r.error || 'Some didn’t save.'); } }
    setProgress(null); setDone({ added, failed }); onDone();
  };
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Bring in client photos and files">
      <button type="button" aria-label="Close" className="absolute inset-0" style={{ background: 'rgba(22,23,26,.2)' }} onClick={onClose} />
      <div className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white p-6" style={{ color: INK }}>
        <div className="flex items-start justify-between gap-3"><div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>client photos and files</p>
          <h2 className="text-[26px] font-normal tracking-[-0.02em]">{done ? 'Done' : 'Bring in photos and files'}</h2></div>
          <button type="button" onClick={onClose} className="text-[24px]" style={{ color: MUTED }} aria-label="Close">×</button></div>
        {done ? <div className="mt-4 space-y-2 rounded-2xl p-4" style={{ background: '#e9f3ed' }}><p className="text-[17px] font-bold" style={{ color: GREEN }}>{done.added.toLocaleString()} files are on clients’ profiles</p>
            <p className="text-[14px]">They show under Photos on each client, marked as from your old app.{done.failed ? ` ${done.failed} didn’t upload — try those again.` : ''} You can undo this from Moving in.</p></div>
          : !items.length ? <div className="mt-4 space-y-3">
            <p className="text-[14.5px] leading-relaxed" style={{ color: MUTED }}>Your old app may give you a folder for each client (“Maria Lopez” with her photos inside) or files named after them. Choose the folder — or the files — and we’ll match each one to a client. You’ll see the matches before anything is uploaded.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-[1.5px] border-dashed p-6 text-center" style={{ borderColor: '#c9cacd' }}><span className="text-[15px] font-semibold">Choose a folder</span><span className="text-[12.5px]" style={{ color: MUTED }}>a folder per client</span>
                <input type="file" multiple className="hidden" {...({ webkitdirectory: '', directory: '' } as any)} onChange={(e) => pick(e.target.files)} disabled={!clients} /></label>
              <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-[1.5px] border-dashed p-6 text-center" style={{ borderColor: '#c9cacd' }}><span className="text-[15px] font-semibold">Choose files</span><span className="text-[12.5px]" style={{ color: MUTED }}>named after the client</span>
                <input type="file" multiple accept="image/*,.heic,.pdf,.doc,.docx,.txt" className="hidden" onChange={(e) => pick(e.target.files)} disabled={!clients} /></label></div>
            {clients === null && <p className="text-[13px]" style={{ color: MUTED }}>Loading your clients…</p>}
            <p className="text-[12.5px]" style={{ color: MUTED }}>Got a .zip? Open it first, then choose the folder inside.</p></div>
          : <div className="mt-4 space-y-4">
            <div className="grid grid-cols-3 gap-2">{[[matched.length, `files for ${people} client${people === 1 ? '' : 's'}`, INK], [unclear.length, 'need you to choose', unclear.length ? AMBER : MUTED], [items.filter((x) => x.skip).length, 'left out', MUTED]].map(([n, l, c]) => (
              <div key={l as string} className="rounded-2xl p-3" style={{ background: SOFT }}><p className="text-[24px] font-normal" style={{ color: c as string }}>{Number(n).toLocaleString()}</p><p className="text-[12.5px]" style={{ color: MUTED }}>{l}</p></div>))}</div>
            {unclear.length > 0 && <div className="space-y-1"><p className="text-[15px] font-semibold">Who are these for?</p><p className="text-[13px]" style={{ color: MUTED }}>Type a client’s name, or leave it out.</p>
              <datalist id="mi-clients">{(clients || []).slice(0, 5000).map((c) => <option key={c.id} value={c.name} />)}</datalist>
              {unclear.slice(0, 200).map((x) => <div key={x.path} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 py-1.5" style={{ borderTop: `1px solid ${LINE}` }}>
                <span className="truncate text-[13.5px]" title={x.path}>{x.path}</span>
                <input list="mi-clients" placeholder="Client…" aria-label={`Client for ${x.path}`} onChange={(e) => { const c = byName.get(e.target.value.toLowerCase()); if (c) setItems((all) => all.map((y) => (y === x ? { ...y, client: c } : y))); }} className="h-9 rounded-lg border px-2 text-[13.5px]" style={{ borderColor: LINE }} />
                <button type="button" onClick={() => setItems((all) => all.map((y) => (y === x ? { ...y, skip: true } : y)))} className="text-[13px] underline" style={{ color: MUTED }}>Leave out</button></div>)}
              {unclear.length > 200 && <p className="text-[12.5px]" style={{ color: MUTED }}>…and {unclear.length - 200} more. Rename those after their client, or bring them in later.</p>}</div>}
            {matched.length > 0 && <div><p className="mb-1.5 text-[15px] font-semibold">Matched</p>
              <div className="max-h-[260px] overflow-y-auto rounded-2xl" style={{ border: `1px solid ${LINE}` }}>{matched.slice(0, 300).map((x) => <div key={x.path} className="flex items-center justify-between gap-3 px-3 py-2 text-[13.5px]" style={{ borderTop: `1px solid ${LINE}` }}>
                <span className="truncate" title={x.path}>{x.path}</span><span className="shrink-0 font-semibold">{x.client!.name}</span></div>)}</div></div>}
            {progress !== null ? <div><div className="h-2 rounded-full" style={{ background: SOFT }}><div className="h-2 rounded-full" style={{ width: `${progress}%`, background: INK }} /></div><p className="mt-1 text-[13px]" style={{ color: MUTED }}>Uploading… {progress}% — keep this open</p></div>
              : <div className="flex gap-2"><button type="button" onClick={() => setItems([])} className="h-11 rounded-full px-5 text-[14.5px] font-semibold" style={{ background: SOFT }}>Start over</button>
                <button type="button" disabled={!matched.length} onClick={save} className="h-11 flex-1 rounded-full text-[14.5px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>Bring in {matched.length.toLocaleString()} file{matched.length === 1 ? '' : 's'}</button></div>}
          </div>}
        {err && <p className="mt-3 text-[13.5px] font-semibold" style={{ color: done ? MUTED : RED }}>{err}</p>}
      </div>
    </div>);
}
