// /api/message-settings — THE CLIENT MESSAGES PAGE'S CHANGES (Settings → Messages): on and off, timing, the business's
// own wording, quiet hours, when the address is shared, call-back details. For the people whose role runs the settings
// (Settings → Roles); the owner always can. Every field is checked (lib/message-settings) before it's saved.
//   { tenantId, updates: { [field]: value } }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { checkMessageSetting } from '@/lib/message-settings';
import { logAuditAdmin } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const g = await requireCan(req, tenantId, 'settings.manage'); if (g.deny) return g.deny;
  const entries = b.updates && typeof b.updates === 'object' ? Object.entries(b.updates) : [];
  if (!entries.length || entries.length > 4) return NextResponse.json({ ok: false, error: 'Nothing to save.' }, { status: 400 });
  const up: Record<string, any> = {};
  for (const [field, value] of entries) {
    let c: ReturnType<typeof checkMessageSetting>;
    try { c = checkMessageSetting(String(field), value); } catch { c = { ok: false, error: 'Unknown setting.' }; }
    if (!c.ok) return NextResponse.json({ ok: false, error: c.error }, { status: 400 });
    up[String(field)] = c.value;
  }
  const db = getAdminDb();
  try {
    await db.doc(`tenants/${tenantId}`).update(up);
    await logAuditAdmin(db, tenantId, { action: 'messages.settings', targetType: 'settings', targetId: 'messages', summary: `Changed message settings: ${Object.keys(up).join(', ')}`.slice(0, 300), actor: { type: 'user', id: String(g.actor?.uid || ''), name: String(g.actor?.name || 'Someone') } } as any).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.warn('[message-settings]', String(e?.message || e).slice(0, 160));
    return NextResponse.json({ ok: false, error: 'That didn’t save. Try again.' }, { status: 500 });
  }
}
