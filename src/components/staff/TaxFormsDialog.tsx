'use client';
// src/components/staff/TaxFormsDialog.tsx — A PERSON'S TAX FORMS, when payroll is run in ClarityFlow (design board
// "Payroll run in ClarityFlow", tax forms): what they wrote on their W-4 and their state's form (North Carolina's NC-4;
// another state's percentage), anything taken out before taxes, and how they're paid. Saved with their pay
// (staffPay.taxForms: managers only, lib/staff-pay), and read by Payday and the server to work out each paycheck's taxes
// (lib/withholding). Opened from Payday ("Add W-4") and from the person's page.
// Never asks for a Social Security number: the business adds those when it files.
import * as React from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cleanTaxForms, NO_WAGE_TAX, BUILT_IN_STATES, type TaxForms, type PayMethod } from '@/lib/withholding';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const solid = { background: INK, color: '#fff' }; const plain = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
const field = `h-11 w-full rounded-xl bg-[#fff] px-3 text-[15px] ${RING}`;
const fieldStyle = { border: `1px solid ${LINE}`, color: INK };

type Draft = {
  form: '2020' | 'pre2020'; status: string; multipleJobs: boolean; dependents: string; otherIncome: string; deductions: string; extra: string; exempt: boolean; allowances: string;
  sStatus: string; sAllowances: string; sExtra: string; sExempt: boolean; sPct: string;
  retirement: string; health: string; payMethod: PayMethod;
};
const str = (n: any) => (Number(n) > 0 ? String(n) : '');
const draftOf = (t: TaxForms | null | undefined): Draft => ({
  form: t?.federal?.form === 'pre2020' ? 'pre2020' : '2020', status: t?.federal?.status || 'single', multipleJobs: !!t?.federal?.multipleJobs,
  dependents: str(t?.federal?.dependents), otherIncome: str(t?.federal?.otherIncome), deductions: str(t?.federal?.deductions), extra: str(t?.federal?.extra),
  exempt: !!t?.federal?.exempt, allowances: t?.federal?.allowances != null ? String(t.federal.allowances) : '',
  sStatus: t?.state?.status || 'single', sAllowances: t?.state?.allowances != null ? String(t.state.allowances) : '', sExtra: str(t?.state?.extra), sExempt: !!t?.state?.exempt, sPct: str(t?.state?.pct),
  retirement: str(t?.pretax?.retirement), health: str(t?.pretax?.health), payMethod: t?.payMethod || 'transfer',
});

function Money({ label, hint, value, onChange, id }: { label: string; hint?: string; value: string; onChange: (v: string) => void; id: string }) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-[14px]" style={{ color: MUTED }}>{label}
      <span className="flex h-11 items-center rounded-xl bg-[#fff] px-3 focus-within:ring-2 focus-within:ring-[#16171a]" style={fieldStyle}>
        <span aria-hidden style={{ color: MUTED }}>$</span>
        <input id={id} type="number" inputMode="decimal" min={0} step="0.01" placeholder="0" value={value} onChange={(e) => onChange(e.target.value)} className="h-full w-full min-w-0 bg-transparent pl-1 text-[15px] tabular-nums focus:outline-none" style={{ color: INK }} />
      </span>
      {hint && <span className="text-[13px]">{hint}</span>}
    </label>
  );
}
const Check = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <label className="flex min-h-[44px] items-center gap-3 text-[15px]" style={{ color: INK }}>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 shrink-0 accent-[#16171a]" />{label}
  </label>
);
const Section = ({ title, children, note }: { title: string; note?: React.ReactNode; children?: React.ReactNode }) => (
  <section className="flex flex-col gap-3 rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
    <h3 className="text-[17px] font-semibold" style={{ color: INK }}>{title}</h3>
    {note && <p className="-mt-2 text-[14px]" style={{ color: MUTED }}>{note}</p>}
    {children}
  </section>
);

export function TaxFormsDialog(p: {
  open: boolean; onOpenChange: (o: boolean) => void; name: string; forms: TaxForms | null | undefined;
  /** The state payroll is taxed in ("NC"), and its name. */
  state: string | null; stateName: string;
  /** Saves the cleaned forms; a string back is what went wrong. */
  onSave: (forms: TaxForms) => Promise<string | null | void>;
  /** The person's pay hasn't loaded yet (saving would lose what's there). */
  notReady?: boolean;
}) {
  const [d, setD] = React.useState<Draft>(() => draftOf(p.forms));
  const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (p.open) { setD(draftOf(p.forms)); setError(null); } }, [p.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof Draft) => (v: any) => setD((x) => ({ ...x, [k]: v }));
  const first = (p.name || 'They').split(' ')[0];
  const code = String(p.state || '').toUpperCase(); const noTax = NO_WAGE_TAX.includes(code); const builtIn = BUILT_IN_STATES.includes(code);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const forms = cleanTaxForms({
        federal: d.form === 'pre2020' ? { form: 'pre2020', status: d.status === 'hoh' ? 'single' : d.status, allowances: d.allowances, extra: d.extra, exempt: d.exempt }
          : { form: '2020', status: d.status, multipleJobs: d.multipleJobs, dependents: d.dependents, otherIncome: d.otherIncome, deductions: d.deductions, extra: d.extra, exempt: d.exempt },
        ...(code && !noTax ? { state: builtIn ? { status: d.sStatus, allowances: d.sAllowances, extra: d.sExtra, exempt: d.sExempt } : { pct: d.sPct, extra: d.sExtra } } : {}),
        pretax: { retirement: d.retirement, health: d.health }, payMethod: d.payMethod,
      });
      const r = await p.onSave({ ...forms, updatedAt: new Date().toISOString() });
      if (typeof r === 'string') { setError(r); return; }
      p.onOpenChange(false);
    } catch { setError('Not saved. Try again.'); } finally { setBusy(false); }
  };
  const sel = (id: string, label: string, value: string, onChange: (v: string) => void, options: [string, string][], hint?: string) => (
    <label htmlFor={id} className="flex flex-col gap-1 text-[14px]" style={{ color: MUTED }}>{label}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={field} style={fieldStyle}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      {hint && <span className="text-[13px]">{hint}</span>}
    </label>
  );

  return (
    <Dialog open={p.open} onOpenChange={(o) => { if (!busy) p.onOpenChange(o); }}>
      <DialogContent className="max-h-[92dvh] overflow-hidden rounded-3xl border-0 bg-[#f5f5f7] p-0 sm:max-w-2xl">
        <div className="flex max-h-[92dvh] flex-col">
          <div className="px-5 pb-3 pt-5 sm:px-6">
            <DialogTitle className="pr-8 text-[20px] font-semibold leading-tight" style={{ color: INK }}>{p.name}’s tax forms</DialogTitle>
            <DialogDescription className="mt-1 text-[14px]" style={{ color: MUTED }}>Copy these from the forms {first} signed. Payday works out the taxes on each paycheck from them.</DialogDescription>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-4 sm:px-6">
            <Section title="Federal taxes, from their W-4" note={!p.forms?.federal ? 'No W-4 on file yet. Until one is saved here, they’re taxed as single, as the IRS requires.' : undefined}>
              {sel('tf-form', 'Their W-4 is from', d.form, set('form'), [['2020', '2020 or later'], ['pre2020', '2019 or earlier, with allowances']])}
              {d.form === '2020' ? <>
                {sel('tf-status', 'Filing status (step 1c)', d.status, set('status'), [['single', 'Single or married filing separately'], ['married', 'Married filing jointly'], ['hoh', 'Head of household']])}
                <Check label="The box in step 2c is checked (two jobs, or a spouse who works)" checked={d.multipleJobs} onChange={set('multipleJobs')} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Money id="tf-dep" label="Dependents, a year (step 3)" value={d.dependents} onChange={set('dependents')} />
                  <Money id="tf-oth" label="Other income, a year (step 4a)" value={d.otherIncome} onChange={set('otherIncome')} />
                  <Money id="tf-ded" label="Deductions, a year (step 4b)" value={d.deductions} onChange={set('deductions')} />
                  <Money id="tf-ext" label="Extra each paycheck (step 4c)" value={d.extra} onChange={set('extra')} />
                </div>
              </> : <>
                {sel('tf-status', 'Marital status', d.status === 'hoh' ? 'single' : d.status, set('status'), [['single', 'Single, or married but withheld at the single rate'], ['married', 'Married']])}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label htmlFor="tf-allow" className="flex flex-col gap-1 text-[14px]" style={{ color: MUTED }}>Allowances
                    <input id="tf-allow" type="number" inputMode="numeric" min={0} step={1} placeholder="0" value={d.allowances} onChange={(e) => set('allowances')(e.target.value)} className={field} style={fieldStyle} /></label>
                  <Money id="tf-ext" label="Extra each paycheck" value={d.extra} onChange={set('extra')} />
                </div>
              </>}
              <Check label="They wrote “Exempt” on their W-4" checked={d.exempt} onChange={set('exempt')} />
              {d.exempt && <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>No federal income tax is withheld. Social Security and Medicare still are. An exempt W-4 lasts for the year it’s signed in: ask for a new one each February.</p>}
            </Section>

            {code && noTax && <Section title={`${p.stateName} taxes`} note={`${p.stateName} has no income tax on wages, so there’s no state form to fill in.`} />}
            {code && builtIn && <Section title={`${p.stateName} taxes, from their NC-4`} note={!p.forms?.state ? 'No NC-4 on file yet. Until one is saved here, they’re taxed as single with no allowances.' : undefined}>
              {sel('tf-sstatus', 'Filing status', d.sStatus, set('sStatus'), [['single', 'Single or married filing separately'], ['hoh', 'Head of household'], ['married', 'Married filing jointly or surviving spouse']])}
              <div className="grid gap-3 sm:grid-cols-2">
                <label htmlFor="tf-sallow" className="flex flex-col gap-1 text-[14px]" style={{ color: MUTED }}>Allowances
                  <input id="tf-sallow" type="number" inputMode="numeric" min={0} step={1} placeholder="0" value={d.sAllowances} onChange={(e) => set('sAllowances')(e.target.value)} className={field} style={fieldStyle} /></label>
                <Money id="tf-sext" label="Extra each paycheck" value={d.sExtra} onChange={set('sExtra')} />
              </div>
              <Check label="They claimed exempt on their NC-4" checked={d.sExempt} onChange={set('sExempt')} />
            </Section>}
            {code && !noTax && !builtIn && <Section title={`${p.stateName} income tax`} note={`${p.stateName}’s own withholding isn’t worked out here yet. Put in the percentage from ${p.stateName}’s withholding tables for ${first}, or leave it empty to use the business’s rate in Settings, Payroll.`}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label htmlFor="tf-spct" className="flex flex-col gap-1 text-[14px]" style={{ color: MUTED }}>Percentage of wages
                  <span className="flex h-11 items-center rounded-xl bg-[#fff] px-3 focus-within:ring-2 focus-within:ring-[#16171a]" style={fieldStyle}>
                    <input id="tf-spct" type="number" inputMode="decimal" min={0} max={20} step="0.01" placeholder="0" value={d.sPct} onChange={(e) => set('sPct')(e.target.value)} className="h-full w-full min-w-0 bg-transparent text-[15px] tabular-nums focus:outline-none" style={{ color: INK }} />
                    <span aria-hidden style={{ color: MUTED }}>%</span></span></label>
                <Money id="tf-sext" label="Extra each paycheck" value={d.sExtra} onChange={set('sExtra')} />
              </div>
            </Section>}

            <Section title="Taken out before taxes" note="Each paycheck, for a plan the business offers.">
              <div className="grid gap-3 sm:grid-cols-2">
                <Money id="tf-ret" label="Retirement plan" hint="A 401(k) or similar: before income tax, not before Social Security and Medicare" value={d.retirement} onChange={set('retirement')} />
                <Money id="tf-hea" label="Health insurance" hint="Through a cafeteria plan: before all of them" value={d.health} onChange={set('health')} />
              </div>
            </Section>

            <Section title={`How ${first} is paid`}>
              <div className="flex flex-wrap gap-2" role="group" aria-label={`How ${first} is paid`}>
                {([['transfer', 'Bank transfer'], ['check', 'Check'], ['cash', 'Cash']] as [PayMethod, string][]).map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={d.payMethod === v} onClick={() => set('payMethod')(v)} className={btn} style={d.payMethod === v ? solid : plain}>{l}</button>
                ))}
              </div>
              <p className="text-[13px]" style={{ color: MUTED }}>Picked on Payday each time, starting from this.</p>
            </Section>

            <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: '#fff', color: MUTED }}>Keep the signed forms in your files. ClarityFlow never asks for or keeps Social Security numbers: you add those when you file.</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 sm:px-6" style={{ borderTop: `1px solid ${LINE}`, background: SOFT }}>
            {p.notReady && <span className="mr-auto text-[13px]" style={{ color: AMBER }}>Their pay is still loading.</span>}
            {error && <span role="alert" className="mr-auto text-[13px]" style={{ color: AMBER }}>{error}</span>}
            <button type="button" onClick={() => p.onOpenChange(false)} disabled={busy} className={btn} style={plain}>Cancel</button>
            <button type="button" onClick={save} disabled={busy || p.notReady} className={btn} style={solid}>{busy ? 'Saving' : 'Save'}</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
