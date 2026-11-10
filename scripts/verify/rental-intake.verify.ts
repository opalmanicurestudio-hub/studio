// Checks the way a lead becomes a renter and the words renters see:
// - Converting a lead (Pipeline, the Spaces page's contacts) or approving an application never makes up a name ("New",
//   "Renter"); the space they asked for is kept on the renter and their first lease starts on it; approving offers
//   "Write the lease" like converting does.
// - The contact history has no emoji lines; the renter portal says nothing about chairs.
// - The Owed list on the Rent page can email a pay link (api/rent/pay-link, checked in rent-pay-link.verify).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/rental-intake.verify.ts
import { readFileSync } from 'fs';
import { check, failures } from './fake-db';

const src = (p: string) => readFileSync(p, 'utf8');
(async () => {
  const svc = src('src/lib/booth-rental-service.ts');
  check('a new renter keeps the space they asked for', /requestedBoothId\?: string \| null;/.test(svc) && /requestedBoothId: input\.requestedBoothId \|\| undefined,/.test(svc));

  const pipe = src('src/app/(app)/pipeline/page.tsx'); const booths = src('src/app/(app)/booths/page.tsx');
  check('converting or approving never makes up a name', !/\|\| 'New'/.test(pipe) && !/\|\| 'Renter',/.test(pipe) && !/firstName: parts\[0\] \|\| 'New'/.test(booths) && !/lastName: parts\.slice\(1\)\.join\(' '\) \|\| 'Renter'/.test(booths));
  check('each way in keeps the space they asked for', /requestedBoothId: r\.boothId \|\| null/.test(pipe) && /requestedBoothId: app\.boothId \|\| null/.test(booths) && /requestedBoothId: sourceApp\?\.boothId \|\| null/.test(booths));
  const ap = booths.slice(booths.indexOf('const approveApplication = async'), booths.indexOf('const convertToRenter = async'));
  check('approving an application offers Write the lease, on the space they asked for, and says nothing about booths', /const rid = await createRenter\(/.test(ap) && /openLeaseWizard\(rid, app\.boothId \|\| null\)/.test(ap) && !/booth/i.test(ap.replace(/requestedBoothId|boothId|boothName|setBooth\w*|openLeaseWizard/g, '')));
  const lb = src('src/components/renters/LeaseBuilder.tsx');
  check('the lease starts on the space they asked for when nothing else is picked', /const asked = renter\?\.requestedBoothId && \(p\.booths \|\| \[\]\)\.some\(\(b\) => b\.id === renter\.requestedBoothId\)/.test(lb) && /p\.defaultBoothId \|\| saved\?\.boothId \|\| \(saved\?\.d \? '' : asked\)/.test(lb));
  const contacts = src('src/lib/booth-contacts.ts');
  check('contact history lines have no emoji', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(contacts) && /'Converted to renter'\)/.test(contacts));
  const portal = ['src/app/rent/[tenantId]/page.tsx', 'src/components/rent/business.tsx', 'src/components/rent/setup.tsx', 'src/components/rent/studio.tsx'].map(src).join('\n');
  const shown = portal.split('\n').filter((l) => !/^\s*(\/\/|\*|import)/.test(l)).join('\n').replace(/Armchair|chairMinutes/g, '');
  check('the renter portal says nothing about chairs or gel fills', !/\bchair\b/i.test(shown) && !/gel fills/i.test(shown));
  const rm = src('src/components/renters/RentMoney.tsx'); const rent = src('src/app/(app)/rent/page.tsx');
  check('the Owed list can email a pay link, and says what happened', />\{linking === o\.renterId \? 'Sending…' : 'Email a pay link'\}</.test(rm) && /role="status"/.test(rm) && /fetch\('\/api\/rent\/pay-link'/.test(rent));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
