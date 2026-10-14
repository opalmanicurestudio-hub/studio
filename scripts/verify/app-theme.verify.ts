// The black theme is applied before the page draws, only on the main app's own pages (lib/app-theme APP_ROUTES).
// A new page folder under src/app/(app) must be on that list, or it would flash white / stay white in black.
// Run: npx tsx scripts/verify/app-theme.verify.ts
import fs from 'fs';
import path from 'path';
import { APP_ROUTES, resolveTheme, THEME_BOOT } from '../../src/lib/app-theme';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const dir = 'src/app/(app)';
const folders = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isDirectory());
const missing = folders.filter((f) => !APP_ROUTES.includes(f)); const extra = APP_ROUTES.filter((r) => !folders.includes(r));
ok(missing.length === 0, `every app page is on the list${missing.length ? ` — add: ${missing.join(', ')}` : ''}`);
ok(extra.length === 0, `no stale entries${extra.length ? ` — remove: ${extra.join(', ')}` : ''}`);
ok(resolveTheme('light', true) === 'light' && resolveTheme('dark', false) === 'dark', 'an explicit choice wins over the device');
ok(resolveTheme('system', true) === 'dark' && resolveTheme('system', false) === 'light', '"match this device" follows it');
ok(!/["']book["']|["']shop["']/.test(THEME_BOOT.match(/\[.*\]/)?.[0] || ''), 'public pages (booking, shop) never turn black');
console.log(bad ? `${bad} failed` : 'all passed'); process.exit(bad ? 1 : 0);
