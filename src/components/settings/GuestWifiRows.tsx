'use client';
// src/components/settings/GuestWifiRows.tsx — the guest Wi-Fi a checked-in client sees. Kept with the business's
// private details (lib/tenant-private), not on the public business record, and saved as each field is left.
import * as React from 'react';
import { Row, cfInput, cfInputStyle } from '@/components/settings/settings-ui';
import { usePrivateSettings } from '@/lib/tenant-private-client';

export function GuestWifiRows({ tenantId }: { tenantId: string }) {
  const { values, error, save } = usePrivateSettings(tenantId);
  const [net, setNet] = React.useState(''); const [pw, setPw] = React.useState('');
  const [note, setNote] = React.useState('');
  const seeded = React.useRef(false);
  // Filled in once when they load; after that what's typed stays, even while the other field saves.
  React.useEffect(() => { if (values && !seeded.current) { seeded.current = true; setNet(values.wifiNetwork || ''); setPw(values.wifiPassword || ''); } }, [values]);
  const keep = async (patch: { wifiNetwork?: string; wifiPassword?: string }) => {
    const k = Object.keys(patch)[0] as 'wifiNetwork' | 'wifiPassword';
    if (!values || (values[k] || '') === (patch[k] || '')) return;
    setNote(await save(patch) ? 'Saved' : '');
  };
  return (<>
    <Row label="Network name"><input className={cfInput} style={cfInputStyle} value={net} disabled={!values} onChange={(e) => { setNet(e.target.value); setNote(''); }} onBlur={() => void keep({ wifiNetwork: net })} placeholder="e.g. Opal Guest" autoComplete="off" /></Row>
    <Row label="Password"><input className={cfInput} style={cfInputStyle} value={pw} disabled={!values} onChange={(e) => { setPw(e.target.value); setNote(''); }} onBlur={() => void keep({ wifiPassword: pw })} placeholder="Leave empty if there isn’t one" autoComplete="off" /></Row>
    {(error || note) && <p className="px-1 text-[13px]" style={{ color: error ? '#b45309' : 'var(--muted, #6d7075)' }}>{error || note}</p>}
  </>);
}
