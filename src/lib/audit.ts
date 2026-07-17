// src/lib/audit.ts
//
// Audit trail — an append-only record of every money action, human or
// automated, at tenants/{tenantId}/auditLogs.
//
// Design rules:
//   • Append-only: entries are never edited or deleted. Corrections are
//     new actions ("transaction.revert"), which themselves get logged.
//   • Every entry answers: WHO (actor), DID WHAT (action + summary),
//     TO WHAT (targetType/targetId), FOR HOW MUCH (amount), WHEN (at).
//   • Logging must never break the action it describes — writers swallow
//     their own failures.
//   • Firestore rules should allow tenant members to CREATE and READ
//     these docs but never UPDATE or DELETE them:
//       match /tenants/{t}/auditLogs/{id} {
//         allow read, create: if isTenantMember(t);
//         allow update, delete: if false;
//       }
//
// This file has no Firebase imports, so both client components and
// server routes can use it. Client code writes with its own SDK helper;
// server code calls logAuditAdmin(db, ...).

export type AuditActor =
  | { type: 'user'; id?: string; name?: string; role?: string; via?: string }
  | { type: 'system'; name: string };   // e.g. 'bank-sync', 'payroll-cron'
// `id`/`name`/`role` identify the TEAM MEMBER acting inside the tenant's
// business (resolved from the active staff identity), so an owner can see
// exactly who on their team did what. `via` marks elevated flows, e.g.
// 'manager-pin' when a refund was authorized by PIN.

export type AuditEntry = {
  id?: string;
  action: string;       // dot-namespaced: transaction.create, bill.pay, payroll.submit_gusto, bank.book, rule.update, ...
  targetType: string;   // transaction | bill | payroll | bankTransaction | rule
  targetId?: string;
  summary: string;      // one human-readable sentence
  amount?: number;
  before?: any;         // snapshot for edits (e.g. old rule category)
  after?: any;
  actor: AuditActor;
  at: string;           // ISO timestamp
};

/** Stamp an entry with the current time. */
export const auditEntry = (e: Omit<AuditEntry, 'at'>): AuditEntry =>
  ({ ...e, at: new Date().toISOString() });

/** Server-side writer (firebase-admin db). Never throws. */
export async function logAuditAdmin(db: any, tenantId: string, e: Omit<AuditEntry, 'at' | 'id'>) {
  try {
    const ref = db.collection(`tenants/${tenantId}/auditLogs`).doc();
    await ref.set({ id: ref.id, ...auditEntry(e) });
  } catch (err) {
    console.error('[audit] write failed (non-fatal):', err);
  }
}
