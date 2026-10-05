// src/lib/handoff-log.ts — THE HAND-OFF RECORD. checkoutState is rewritten wholesale at every hand-off, so who handed a
// client to whom, when, and with what note, would otherwise be lost. Each save appends one entry to
// appointment.handoffs: the parts just finished, by whom, who's next (or the desk), and the provider's note.
export type HandoffEntry = { at: string; fromStaffId: string | null; toStaffId: string | null; toDesk: boolean; partsDone: string[]; note: string | null };
export function handoffEntry(apt: any, checkoutState: any): HandoffEntry {
  const before = new Set<string>(apt?.checkoutState?.completedServiceIds || []); const done: string[] = (checkoutState?.completedServiceIds || []).filter((id: string) => !before.has(id));
  const over: Record<string, string> = checkoutState?.serviceStaffOverrides || {}; const lead = apt?.serviceId; const who = (pid: string) => over[pid] || (pid === lead ? apt?.staffId : apt?.staffId) || null;
  const all: string[] = [lead, ...(apt?.addOnIds || []), ...((checkoutState?.addOnServices || []).map((s: any) => s?.id))].filter(Boolean).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
  const completed = new Set<string>(checkoutState?.completedServiceIds || []); const next = all.find((pid) => !completed.has(pid));
  const note = typeof checkoutState?.reviewNotes === 'string' && checkoutState.reviewNotes.trim() ? checkoutState.reviewNotes.trim().slice(0, 500) : null;
  return { at: new Date().toISOString(), fromStaffId: done.length ? who(done[0]) : apt?.staffId || null, toStaffId: next ? who(next) : null, toDesk: !next, partsDone: done, note };
}
