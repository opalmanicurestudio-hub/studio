// Checks that a paused or closed business has its kiosk and wall screens closed too (floor, kitchen display, lobby,
// concierge, housekeeping), the same as the owner's app and the team app; an open business gets the screen.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-kiosk-lock.verify.tsx
import Module from 'module';
import { readFileSync } from 'fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeDb, check, failures } from './fake-db';

(globalThis as any).React = React;
const db = makeDb();
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  return load.call(this, request, ...rest);
};
const SCREENS = ['floor', 'kds', 'lobby', 'concierge', 'housekeeping'];

(async () => {
  console.log('Kiosk and wall screens for a paused or closed business');
  await db.doc('tenants/open').set({ name: 'Opal', subscriptionStatus: 'active' });
  await db.doc('tenants/paused').set({ name: 'Opal', subscriptionStatus: 'active', accessLocked: true, accessLockedAt: '2026-11-01T00:00:00Z' });
  await db.doc('tenants/gone').set({ name: 'Fern Spa', subscriptionStatus: 'canceled' });
  for (const s of SCREENS) {
    const src = readFileSync(`src/app/${s}/[tenantId]/layout.tsx`, 'utf8');
    check(`${s}: read fresh on every load`, /export const dynamic = 'force-dynamic';/.test(src));
    const Layout = (await import(`../../src/app/${s}/[tenantId]/layout`)).default as any;
    // The layout hands over to the gate (an async server component): resolve it, then render what it returns.
    const html = async (tenantId: string) => { const el: any = await Layout({ params: Promise.resolve({ tenantId }), children: React.createElement('p', null, 'THE SCREEN') });
      return renderToStaticMarkup(await el.type(el.props)); };
    const open = await html('open'), paused = await html('paused'), gone = await html('gone'), missing = await html('nobody');
    check(`${s}: an open business gets the screen`, open.includes('THE SCREEN'));
    check(`${s}: paused or cancelled gets a closed card with the business’s name, not the screen`, !paused.includes('THE SCREEN') && paused.includes('Opal') && !gone.includes('THE SCREEN') && gone.includes('Fern Spa'));
    check(`${s}: an unknown business isn’t treated as closed (the screen handles it)`, missing.includes('THE SCREEN'));
  }
  const staff = readFileSync('src/app/staff-portal/[tenantId]/layout.tsx', 'utf8');
  check('the team app still closes the same way', /accessLockOf\(t\)\.locked/.test(staff));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
