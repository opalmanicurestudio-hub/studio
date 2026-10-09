'use client';
// src/lib/cleanse-client.ts — starting a kit's cleanse from any screen (the return scan, the queue, the Kits list):
// the kit moves to "cleansing" and its contact timer starts, in one go, with the audit record.
import { doc, collection, writeBatch } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { logAuditClient } from '@/lib/audit-client';
import { settle } from '@/lib/offline';
import { moveKit, KIT_LABEL, type Kit } from '@/lib/kits';
import { METHOD_LABEL, type CleanseMethod } from '@/lib/cleanse';

export async function startCleanse(firestore: any, tenantId: string, kit: Kit, plan: { method: CleanseMethod; disinfectant: any }, opts: { manager: boolean; returned?: boolean } = { manager: false }): Promise<{ ok: true } | { error: string }> {
  const who = (getAuth().currentUser?.displayName || getAuth().currentUser?.email || 'Staff').split('@')[0]; const uid = getAuth().currentUser?.uid || null;
  // A kit coming back from a client goes in use → needs cleaning → cleansing in one step.
  let k: Kit = kit; const patch: any = {};
  if (k.status === 'in_use') { const r = moveKit(k, 'dirty', { name: who, manager: opts.manager }); if ('error' in r) return r; Object.assign(patch, r.patch); k = { ...k, ...r.patch } as Kit; }
  // A kit already marked cleansing but with no cleanse on record (older kits) just gets its cleanse and timer.
  if (k.status !== 'cleaning') { const r2 = moveKit(k, 'cleaning', { name: who, manager: opts.manager }); if ('error' in r2) return r2; Object.assign(patch, r2.patch); }
  const at = new Date().toISOString(); const d = plan.disinfectant; const timerRef = doc(collection(firestore, 'tenants', tenantId, 'contactTimers'));
  const b = writeBatch(firestore);
  b.update(doc(firestore, 'tenants', tenantId, 'kits', kit.id), { ...patch, byId: uid, staffId: null, staffName: null, cleansedAt: null, cycleId: null,
    cleanse: { method: plan.method, disinfectantId: d.id, name: d.name, minutes: Number(d.contactMinutes), startedAt: at, timerId: timerRef.id } });
  b.set(timerRef, { id: timerRef.id, disinfectantId: d.id, name: d.name, what: `${kit.name} ${kit.code}`, kitId: kit.id, minutes: Number(d.contactMinutes), startedAt: at, byName: who, byId: uid, doneAt: null });
  try { await settle(b.commit()); } catch { return { error: 'That didn’t save — try again.' }; }
  void logAuditClient(firestore, tenantId, { action: 'kit.cleanse_started', targetType: 'kit', targetId: kit.id, actor: { type: 'user', id: uid || undefined, name: who, role: opts.manager ? 'manager' : 'staff' },
    before: { status: kit.status }, after: { status: 'cleaning', disinfectant: d.name, minutes: d.contactMinutes, method: plan.method },
    summary: `${kit.name} ${kit.code}: ${kit.status === 'in_use' ? 'returned, ' : ''}${METHOD_LABEL[plan.method].toLowerCase()} with ${d.name} — ${d.contactMinutes} min contact (${KIT_LABEL[kit.status]} → cleansing)` });
  return { ok: true };
}
