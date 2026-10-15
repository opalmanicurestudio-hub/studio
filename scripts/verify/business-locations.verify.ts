// Checks lib/business-locations: who works where, where a visit or walk-in is, and that nothing unplaced is hidden.
// Run: npx tsx scripts/verify/business-locations.verify.ts
import { businessLocations, worksAt, locationOf, atLocation, homeLocation } from '../../src/lib/business-locations';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const locs = [{ id: 'A', name: 'Main' }, { id: 'B', name: 'Uptown' }, { id: 'shelf', name: 'Back shelf', locationTypeId: 't1' }, { id: 'C', name: 'Old', isActive: false }];
const staff = [{ id: 'm', locationIds: ['A'] }, { id: 'd', locationIds: ['A', 'B'] }, { id: 'p' }];
ok(businessLocations(locs).map((l) => l.id).join() === 'A,B', 'business locations skip storage areas and paused ones');
ok(worksAt(staff[0], 'A') && !worksAt(staff[0], 'B'), 'one location: works only there');
ok(worksAt(staff[2], 'B'), 'no locations set: works everywhere');
ok(locationOf({ locationId: 'B', staffId: 'm' }, staff, locs) === 'B', 'a saved location wins');
ok(locationOf({ staffId: 'm' }, staff, locs) === 'A', 'otherwise the provider’s only location');
ok(locationOf({ staffId: 'd' }, staff, locs) === null, 'a provider at two places doesn’t decide it');
ok(locationOf({}, staff, [{ id: 'A' }]) === 'A', 'a one-location business places everything there');
ok(atLocation({ staffId: 'd' }, staff, locs, 'B'), 'unplaced visits show at every location, never hidden');
ok(!atLocation({ staffId: 'm' }, staff, locs, 'B'), 'a visit placed elsewhere is filtered out');
ok(atLocation({ staffId: 'm' }, staff, locs, ''), 'all locations shows everything');
ok(homeLocation(staff[0]) === 'A' && homeLocation(staff[1]) === null, 'home location only when there is exactly one');
console.log(bad ? `${bad} failed` : 'all passed'); process.exit(bad ? 1 : 0);
