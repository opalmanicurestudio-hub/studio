// scripts/settings-rows.ts — writes src/lib/settings-rows.ts from the Settings pages (scripts/settings-rows-lib).
// Run: npx tsx --tsconfig tsconfig.json scripts/settings-rows.ts
import fs from 'fs';
import path from 'path';
import { buildSettingsRows, renderSettingsRows } from './settings-rows-lib';

const rows = buildSettingsRows();
fs.writeFileSync(path.resolve(__dirname, '../src/lib/settings-rows.ts'), renderSettingsRows(rows));
const n = Object.values(rows).reduce((a, r) => a + r.length, 0);
console.log(`wrote src/lib/settings-rows.ts: ${n} rows on ${Object.keys(rows).length} pages`);
