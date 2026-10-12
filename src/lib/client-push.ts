// src/lib/client-push.ts — NOTIFICATIONS ON A CLIENT'S PHONE.
// A client turns them on from their visit link (or the app saved to their home screen). The device is kept on their
// client record (`appDevices`), with how they use us (`appReach`): Texts only → Visit link → App with notifications.
// Sending prunes devices that have gone away, so the record stays true. Without devices this does nothing, and the
// text or email backup does the job.
const iso = () => new Date().toISOString();

export { reachOf, type Reach } from '@/lib/client-reach';

/** The visit link was opened (and from where): counts toward the client's step. */
export async function noteLinkUse(db: any, t: string, clientId: string, o: { standalone?: boolean } = {}) {
  if (!clientId) return; const ref = db.doc(`tenants/${t}/clients/${clientId}`); const c: any = (await ref.get()).data(); if (!c) return;
  const last = Date.parse(c.linkLastUsedAt || ''); if (Number.isFinite(last) && Date.now() - last < 30 * 60000 && !(o.standalone && !c.appInstalledAt)) return;   // at most every 30 minutes
  await ref.set({ linkLastUsedAt: iso(), linkUses: (Number(c.linkUses) || 0) + 1, ...(o.standalone && !c.appInstalledAt ? { appInstalledAt: iso() } : {}) }, { merge: true });
}

/** Save this phone for this client. One device belongs to one client at a time. */
export async function registerClientDevice(db: any, t: string, clientId: string, d: { token: string; platform?: string; standalone?: boolean }) {
  const token = String(d.token || '').slice(0, 4096); if (!clientId || !token) return { ok: false, error: 'Missing details.' };
  const ref = db.doc(`tenants/${t}/clients/${clientId}`); const c: any = (await ref.get()).data(); if (!c) return { ok: false, error: 'We couldn’t find your details.' };
  const others = (await db.collection(`tenants/${t}/clients`).where('appTokens', 'array-contains', token).get().catch(() => ({ docs: [] as any[] }))).docs || [];
  for (const o of others) if (o.id !== clientId) { const oc: any = o.data() || {}; await o.ref.set({ appTokens: (oc.appTokens || []).filter((x: string) => x !== token), appDevices: (oc.appDevices || []).filter((x: any) => x.token !== token) }, { merge: true }); }
  const devices = (Array.isArray(c.appDevices) ? c.appDevices : []).filter((x: any) => x.token !== token);
  devices.push({ token, platform: String(d.platform || '').slice(0, 40) || null, standalone: !!d.standalone, at: iso() });
  await ref.set({ appDevices: devices.slice(-5), appTokens: devices.slice(-5).map((x: any) => x.token), pushOnAt: c.pushOnAt || iso(), ...(d.standalone && !c.appInstalledAt ? { appInstalledAt: iso() } : {}) }, { merge: true });
  return { ok: true };
}
export async function removeClientDevice(db: any, t: string, clientId: string, token: string) {
  const ref = db.doc(`tenants/${t}/clients/${clientId}`); const c: any = (await ref.get()).data(); if (!c) return { ok: true };
  const devices = (c.appDevices || []).filter((x: any) => x.token !== token);
  await ref.set({ appDevices: devices, appTokens: devices.map((x: any) => x.token) }, { merge: true }); return { ok: true };
}

/** Send a notification to a client's phones. Returns how many devices it reached. */
export async function pushToClient(db: any, t: string, clientId: string, n: { title: string; body: string; link?: string }) {
  if (!clientId) return { sent: 0 };
  const ref = db.doc(`tenants/${t}/clients/${clientId}`); const c: any = (await ref.get()).data() || {};
  const tokens: string[] = (c.appDevices || []).map((x: any) => x.token).filter(Boolean); if (!tokens.length) return { sent: 0 };
  const tenant: any = (await db.doc(`tenants/${t}`).get()).data() || {};
  const { getAdminMessaging } = await import('@/lib/firebase-admin'); const { linkOrigin } = await import('@/lib/app-origin'); const base = linkOrigin(tenant);
  const res = await getAdminMessaging().sendEachForMulticast({ tokens, notification: { title: `${tenant.name || 'Your studio'}: ${n.title}`, body: n.body.slice(0, 180) },
    webpush: { fcmOptions: n.link ? { link: n.link } : undefined, notification: { icon: `${base}/icon-192.png`, badge: `${base}/icon-192.png` } } });
  const dead = tokens.filter((_, i) => { const r = res.responses[i]; const code = String(r?.error?.code || ''); return !r?.success && /not-registered|invalid-argument|invalid-registration/.test(code); });
  if (dead.length) { const devices = (c.appDevices || []).filter((x: any) => !dead.includes(x.token)); await ref.set({ appDevices: devices, appTokens: devices.map((x: any) => x.token) }, { merge: true }); }
  if (res.successCount) await ref.set({ lastPushAt: iso() }, { merge: true });
  return { sent: res.successCount || 0 };
}
