// src/lib/scan-rule.ts — EVERY ITEM SCANNED (pure; the same on the server and every screen). A unit goes into a bag or
// a box only by a scan: a scanner, the camera, or the code under the barcode typed in. Tapping an item doesn't count it
// while the shop scans every item, which it does unless a manager turns it off in Setup (`requireScan: false`). An item
// that won't scan (no barcode yet, a barcode that won't read, a damaged label) is counted by an approval: a manager's
// PIN, or anyone who packs when the shop allows it, with a reason, one unit at a time, kept on the line and in the
// order's record (lib/retail-fulfill approveLineUnit, checked on the server in api/retail/fulfil).
//
// Each line keeps how its units were counted: qtyScanned is every unit counted, and of those qtyApproved were approved
// without any scan and qtyTapped were ticked by hand (only while the shop doesn't scan every item). The rest were
// scanned. With the second scan on, a unit scanned at the shelf can be approved into the box (qtyApprovedIn): it was
// still scanned once. Evidence for a dispute or a claim says only what was scanned (everyUnitScanned).

export const APPROVE_REASONS = ['No barcode yet', 'Barcode won’t read', 'Label is damaged'] as const;
export type ApproveReason = (typeof APPROVE_REASONS)[number];
export const isApproveReason = (v: unknown): v is ApproveReason => typeof v === 'string' && (APPROVE_REASONS as readonly string[]).includes(v);

/** The shop scans every item unless it has turned that off. */
export function scanRequired(rs: any): boolean {
  return rs?.requireScan !== false;
}

/** Who may approve an item that won't scan: managers (the default), or anyone who packs. */
export type Approvers = 'managers' | 'packers';
export function approversOf(rs: any): Approvers {
  return rs?.scanApprovers === 'packers' ? 'packers' : 'managers';
}
export function mayApprove(perms: { canManage?: boolean; canPack?: boolean } | null | undefined, who: Approvers): boolean {
  if (!perms) return false;
  if (perms.canManage) return true;
  return who === 'packers' && perms.canPack === true;
}

/** One approval, as kept on the line (the newest last; never more than the line's units). `phase`: counted without a
 *  scan ('pick'), or a unit scanned at the shelf approved into the box ('check'). Older approvals have none: 'pick'. */
export type Approval = { by: string; byId: string; reason: string; at: string; phase?: 'pick' | 'check' };

const n = (v: any) => Math.max(0, Math.floor(Number(v) || 0));

/** How a line's units were counted. `owed` is what goes out (ordered, less what went missing). */
export function lineCounts(l: any): { owed: number; counted: number; scanned: number; approved: number; approvedIn: number; tapped: number } {
  const owed = Math.max(0, n(l?.qtyOrdered) - n(l?.qtyShorted));
  const counted = n(l?.qtyScanned);
  const approved = Math.min(n(l?.qtyApproved), counted);
  const tapped = Math.min(n(l?.qtyTapped), counted - approved);
  return { owed, counted, scanned: Math.max(0, counted - approved - tapped), approved, approvedIn: Math.min(n(l?.qtyApprovedIn), n(l?.qtyPacked)), tapped };
}

/** The whole order's units by how they were counted (lines that go out only; downloads have nothing to count). */
export function orderCounts(lines: any[]): { scanned: number; approved: number; approvedIn: number; tapped: number; units: number } {
  return (Array.isArray(lines) ? lines : []).filter((l) => l && l.digital !== true).reduce((a, l) => {
    const c = lineCounts(l);
    return { scanned: a.scanned + Math.min(c.scanned, c.owed), approved: a.approved + c.approved, approvedIn: a.approvedIn + c.approvedIn, tapped: a.tapped + c.tapped, units: a.units + c.owed };
  }, { scanned: 0, approved: 0, approvedIn: 0, tapped: 0, units: 0 });
}

/** Every unit going out was scanned: none approved without a scan, none ticked by hand. What evidence may claim. */
export function everyUnitScanned(lines: any[]): boolean {
  const go = (Array.isArray(lines) ? lines : []).filter((l) => l && l.digital !== true);
  return go.length > 0 && go.every((l) => { const c = lineCounts(l); return c.scanned >= c.owed; });
}

/** Lines with units ticked by hand: while the shop scans every item, each of those is scanned to confirm it before the
 *  order is finished (a shop that turned scanning on partway through an order). */
export function tappedLines(lines: any[]): any[] {
  return (lines || []).filter((l) => l && l.digital !== true && lineCounts(l).tapped > 0);
}

/** Who approved this line's units, in words: "Andre", "Andre and Maya". */
export function approvedByWords(l: any): string {
  const names = [...new Set(((Array.isArray(l?.approvals) ? l.approvals : []) as Approval[]).map((a) => String(a?.by || '').split(' ')[0]).filter(Boolean))];
  if (!names.length) return '';
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The newest reason given for this line's approvals. */
export function lastReason(l: any): string {
  const list = (Array.isArray(l?.approvals) ? l.approvals : []) as Approval[];
  return String(list[list.length - 1]?.reason || '');
}
