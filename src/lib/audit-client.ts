// src/lib/audit-client.ts — record a staff action from the browser, in the
// same activity log the server writes (tenants/{t}/auditLogs). The rules let
// any team member ADD an entry and nobody edit or delete one. Never throws:
// a failed record must not undo the action it describes.
import { addDoc, collection, type Firestore } from 'firebase/firestore';
import { auditEntry, type AuditEntry } from '@/lib/audit';

export async function logAuditClient(firestore: Firestore | null | undefined, tenantId: string, e: Omit<AuditEntry, 'at' | 'id'>) {
  if (!firestore || !tenantId) return;
  try { await addDoc(collection(firestore, `tenants/${tenantId}/auditLogs`), auditEntry(e)); } catch { /* the action stands */ }
}
