/**
 * block-submit — the one way a calendar block gets created.
 *
 * The policy in block-policy.ts decides what SHOULD happen. This is what
 * actually happens, and it exists so the answer is the same from whichever
 * screen somebody creates a block on. A rule enforced in one dialog and not
 * another is not a rule.
 *
 * Three outcomes:
 *   free      the event is written, approved, done
 *   notify    the event is written AND a manager is told
 *   approval  NO event is written. A request goes into the shiftRequests
 *             queue the /schedule/requests screen already works from, and the
 *             time stays bookable until somebody answers it.
 *
 * That last one is the point. Writing a 'pending' event and calling it
 * approval would leave the slot gone either way — the approval would be
 * paperwork over a decision already taken.
 */

import { addDoc, collection, doc, setDoc, type Firestore } from 'firebase/firestore';
import { resolveBlockPermission, exceedsCap, type BlockPolicy, type BlockType } from '@/lib/block-policy';
import { notifyStaff, managerIds } from '@/lib/staff-notify';

export type BlockSubmitResult =
  | { ok: true; outcome: 'created' | 'requested'; message: string }
  | { ok: false; reason: string };

export async function submitCalendarBlock(
  firestore: Firestore | null | undefined,
  tenantId: string | null | undefined,
  input: {
    blockType: BlockType | string;
    title: string;
    startTime: Date;
    endTime: Date;
    allDay?: boolean;
    notes?: string;
    staffIds: string[];
    /** The person the block is FOR, whose permission decides the outcome. */
    subject: { id: string; name?: string | null; employmentModel?: string | null; role?: string | null };
    actor: { uid?: string | null; name?: string | null; isManager?: boolean };
    policy?: BlockPolicy | null;
    /** Existing events, for the daily cap check. */
    events?: any[];
    staff?: any[];
    ownerUid?: string | null;
  },
): Promise<BlockSubmitResult> {
  if (!firestore || !tenantId) return { ok: false, reason: 'Missing studio' };
  if (!input.title?.trim()) return { ok: false, reason: 'Give it a name.' };

  const verdict = resolveBlockPermission({
    blockType: input.blockType,
    employmentModel: input.subject.employmentModel,
    role: input.subject.role,
    isManager: input.actor.isManager,
    policy: input.policy,
  });

  const minutes = Math.max(0, Math.round((input.endTime.getTime() - input.startTime.getTime()) / 60000));

  /* The cap applies to the free and notify paths only. Something going to a
   * manager is already being judged by a person, and a cap that blocks the
   * REQUEST would stop them even asking. */
  if (verdict.permission !== 'approval') {
    const cap = exceedsCap({
      verdict,
      events: input.events || [],
      staffId: input.subject.id,
      blockType: String(input.blockType),
      day: input.startTime,
      newMinutes: minutes,
    });
    if (cap.over) {
      return {
        ok: false,
        reason: `That would put ${input.subject.name || 'them'} over the ${cap.capMinutes} minute daily limit for this — ${cap.usedMinutes} already booked.`,
      };
    }
  }

  const nowIso = new Date().toISOString();

  if (verdict.permission === 'approval') {
    try {
      await addDoc(collection(firestore, `tenants/${tenantId}/shiftRequests`), {
        tenantId,
        staffId: input.subject.id,
        staffName: input.subject.name || null,
        type: 'calendar_block',
        blockType: String(input.blockType),
        title: input.title.trim().slice(0, 120),
        date: input.startTime.toISOString().slice(0, 10),
        startTime: input.startTime.toISOString(),
        endTime: input.endTime.toISOString(),
        allDay: !!input.allDay,
        reason: (input.notes || '').slice(0, 300),
        status: 'pending',
        requestedBy: input.actor.uid || null,
        requestedAt: nowIso,
      });
    } catch {
      return { ok: false, reason: 'Could not send that — try again.' };
    }

    await notifyStaff(firestore, tenantId, managerIds(input.staff || [], input.actor.uid, input.ownerUid).map(id => ({
      userId: id,
      type: 'appointment_issue_raised' as const,
      message: `${input.subject.name || 'A provider'} asked to block time — ${input.title.trim()}.`,
      link: '/schedule/requests',
    })));

    return {
      ok: true,
      outcome: 'requested',
      message: 'Sent to a manager. Your time stays bookable until they answer.',
    };
  }

  const id = doc(collection(firestore, `tenants/${tenantId}/events`)).id;
  try {
    await setDoc(doc(firestore, `tenants/${tenantId}/events`, id), {
      id,
      tenantId,
      title: input.title.trim().slice(0, 120),
      type: 'blocked',
      blockType: String(input.blockType),
      startTime: input.startTime.toISOString(),
      endTime: input.endTime.toISOString(),
      allDay: !!input.allDay,
      notes: (input.notes || '').slice(0, 300),
      staffIds: input.staffIds,
      status: 'approved',
      createdAt: nowIso,
      requestedBy: input.actor.uid || null,
      requestedAt: nowIso,
    });
  } catch {
    return { ok: false, reason: 'Could not save that — try again.' };
  }

  if (verdict.permission === 'notify') {
    await notifyStaff(firestore, tenantId, managerIds(input.staff || [], input.actor.uid, input.ownerUid).map(mid => ({
      userId: mid,
      type: 'appointment_issue_raised' as const,
      message: `${input.subject.name || 'A provider'} blocked time — ${input.title.trim()}.`,
      link: '/planner',
    })));
    return { ok: true, outcome: 'created', message: 'Blocked. A manager has been told.' };
  }

  return { ok: true, outcome: 'created', message: 'Blocked.' };
}
