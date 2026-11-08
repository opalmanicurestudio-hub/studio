// src/lib/tenant-private-fields.ts — which details are kept off the public business record (lib/tenant-private), as
// a plain function both the server and the team's screens can use: a screen that saves a whole copy of the business
// record strips them first, so an old copy can't put them back.
export function stripPrivate<T extends Record<string, any>>(tenant: T): T {
  if (!tenant || typeof tenant !== 'object') return tenant;
  const { wifiNetwork: _n, wifiPassword: _p, inviteCode: _i, accessLockedReason: _r, signupIp: _ip, ...rest } = tenant as any;
  if (rest.clientNotify && typeof rest.clientNotify === 'object') { const { ownerPhone: _o, ...cn } = rest.clientNotify; rest.clientNotify = cn; }
  if (rest.retailSettings && typeof rest.retailSettings === 'object') { const { curbsideAlertPhone: _c, shipFrom: _s, shippoApiKey: _k, wholesaleAccessCode: _w, ...rs } = rest.retailSettings; rest.retailSettings = rs; }
  return rest as T;
}
