// src/lib/tool-lock.ts — A TOOL THAT ISN'T PART OF THE PLAN IS LOCKED, NOT JUST LEFT OUT OF THE MENU (server). The tools
// a business has are tenant.modules (lib/modules: a tool never mentioned is on, so nothing changes for a business that
// never chose); what's billed is exactly what's on (lib/billing-plans, Your ClarityFlow). A route that belongs to a tool
// refuses while it's off, so a saved link or an old tablet can't keep using what isn't paid for:
//   const locked = toolLocked(tenant, ['hospitality']); if (locked) return locked;
// The team is told what's missing and where the owner adds it; a guest is only told it isn't available. Nothing made
// with a tool is deleted when it's turned off, and turning it back on brings it all back.
import { NextResponse } from 'next/server';
import { MODULES, moduleEnabled, type ModuleId } from '@/lib/modules';
import { TOOLS } from '@/lib/module-catalog';

/** The tool's name as the business chose it in Your ClarityFlow. */
export const toolName = (id: ModuleId) => TOOLS.find((t) => t.gates.includes(id))?.name || MODULES[id]?.label || 'This tool';

/** Is any of these on? (A screen two tools share is open while either is.) */
export const anyToolOn = (tenant: any, ids: ModuleId[]) => ids.some((id) => moduleEnabled(tenant, id));

/** The same, reading the business first (for routes that haven't read it yet). */
export async function toolLockedFor(db: any, tenantId: string, ids: ModuleId[], who: 'team' | 'guest' = 'team', guestWords?: string): Promise<NextResponse | null> {
  const t = (await db.doc(`tenants/${tenantId}`).get().catch(() => null))?.data?.();
  return t ? toolLocked(t, ids, who, guestWords) : null;   // an unreadable business is left to the route's own checks
}

/** The refusal while none of these tools is on; null while one is. */
export function toolLocked(tenant: any, ids: ModuleId[], who: 'team' | 'guest' = 'team', guestWords?: string): NextResponse | null {
  if (anyToolOn(tenant, ids)) return null;
  const error = who === 'team'
    ? `${toolName(ids[0])} isn’t part of this business’s plan right now. The owner can add it in Your ClarityFlow.`
    : guestWords || 'This isn’t available right now.';
  return NextResponse.json({ ok: false, locked: true, closed: true, tool: ids[0], error }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
}
