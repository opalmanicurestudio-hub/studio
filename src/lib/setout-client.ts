'use client';
// src/lib/setout-client.ts — "Set out": housekeeping puts the kit / bundle set aside for a visit at its station before the
// client sits down. The item stays clean and ready, now held for that visit; when the visit starts it is tied to the client
// by itself (no scan needed at the chair). Audited.
import { doc, updateDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { logAuditClient } from '@/lib/audit-client';
import type { SetItem, SetVisit } from '@/lib/setaside';

export async function setOutItem(firestore: any, tenantId: string, item: SetItem, visit: SetVisit, stationName?: string | null): Promise<string | null> {
  if (!item.refId) return 'Nothing set aside to set out.';
  const who = (getAuth().currentUser?.displayName || getAuth().currentUser?.email || 'Staff').split('@')[0]; const at = new Date().toISOString();
  try {
    await updateDoc(doc(firestore, 'tenants', tenantId, item.kind === 'kit' ? 'kits' : 'linenBundles', item.refId), { setFor: visit.visitId, setForName: visit.clientName, setOutAt: at, setOutBy: who, setOutStation: stationName || null });
    void logAuditClient(firestore, tenantId, { action: `${item.kind === 'kit' ? 'kit' : 'bundle'}.set_out`, targetType: item.kind === 'kit' ? 'kit' : 'linenBundle', targetId: item.refId, actor: { type: 'user', id: getAuth().currentUser?.uid, name: who },
      after: { visitId: visit.visitId }, summary: `${item.type} ${item.code || ''} set out for ${visit.clientName}${stationName ? ` at ${stationName}` : ''}`.replace(/\s+/g, ' ') });
    return null;
  } catch { return 'That didn’t save — try again.'; }
}
