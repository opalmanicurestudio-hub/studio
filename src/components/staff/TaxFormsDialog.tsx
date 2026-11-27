'use client';
// src/components/staff/TaxFormsDialog.tsx — A PERSON'S TAX FORMS, when payroll is run in ClarityFlow (design board
// "Payroll run in ClarityFlow", tax forms): what they wrote on their W-4 and their state's own form (California's DE 4,
// New York's IT-2104…, each with its own fields: lib/state-payroll), anything taken out before taxes, and how they're
// paid. Saved with their pay
// (staffPay.taxForms: managers only, lib/staff-pay), and read by Payday and the server to work out each paycheck's taxes
// (lib/withholding). Opened from Payday ("Add W-4") and from the person's page.
// Never asks for a Social Security number: the business adds those when it files.
// `self`: the person filling in their own (design board "Your own W-4", the Pay tab): no pre-tax plans or how they're paid,
// in their own words, signed with their typed name and sent (api/pay/tax-forms), which tells the owner.
import * as React from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cleanTaxForms, NO_WAGE_TAX, BUILT_IN_STATES, type TaxForms, type PayMethod } from '@/lib/withholding';
import { stateSpec, fieldLabel } from '@/lib/state-payroll';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const solid = { background: INK, color: '#fff' }; const plain = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
const field = `h-11 w-full rounded-xl bg-[#fff] px-3 text-[15px] ${RING}`;
const fieldStyle = { border: `1px solid ${LINE}`, color: INK };

type Draft = {
  form: '2020' | 'pre2020'; status: string; multipleJobs: boolean; dependents: string; otherIncome: string; deductions: string; extra: string; exempt: boolean; allowances: string;
  sStatus: string; sAllowances: string; sExtra: string; sExempt: boolean; sPct: string;
  sAdditional: string; sRate: string; sCode: string; sLocal: string; sAmount: string; sFlag: boolean; sReduce: string;
  retirement: string; health: string; payMethod: PayMethod;
};
const str = (n: any) => (Number(n) > 0 ? String(n) : '');
const draftOf = (t: TaxForms | null | undefined): Draft => ({
  form: t?.federal?.form === 'pre2020' ? 'pre2020' : '2020', status: t?.federal?.status || 'single', multipleJobs: !!t?.federal?.multipleJobs,
  dependents: str(t?.federal?.dependents), otherIncome: str(t?.federal?.otherIncome), deductions: str(t?.federal?.deductions), extra: str(t?.federal?.extra),
  exempt: !!t?.federal?.exempt, allowances: t?.federal?.allowances != null ? String(t.federal.allowances) : '',
  sStatus: t?.state?.status || '', sAllowances: t?.state?.allowances != null ? String(t.state.allowances) : '', sExtra: str(t?.state?.extra), sExempt: !!t?.state?.exempt, sPct: str(t?.state?.pct),
  sAdditional: str(t?.state?.additional), sRate: t?.state?.rate ? String(t.state.rate) : '', sCode: t?.state?.code || '', sLocal: t?.state?.local || '', sAmount: str(t?.state?.amount),
  sFlag: !!t?.state?.flag, sReduce: str(t?.state?.reduce),
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
  /** Filled in by the person themselves: the business's name, and the signed forms sent (a string back is what went wrong). */
  self?: { business: string; onSign: (forms: TaxForms, signedName: string) => Promise<string | null> };
}) {
  const [d, setD] = React.useState<Draft>(() => draftOf(p.forms));
  const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState<string | null>(null);
  const [signed, setSigned] = React.useState(''); const [more, setMore] = React.useState(false); const me = !!p.self;
  React.useEffect(() => { if (p.open) { setD(draftOf(p.forms)); setError(null); setSigned(''); setMore(!!(p.forms?.federal?.otherIncome || p.forms?.federal?.deductions || p.forms?.federal?.exempt)); } }, [p.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof Draft) => (v: any) => setD((x) => ({ ...x, [k]: v }));
  const first = (p.name || 'They').split(' ')[0];
  const code = String(p.state || '').toUpperCase(); const noTax = NO_WAGE_TAX.includes(code); const builtIn = BUILT_IN_STATES.includes(code);
  const spec = stateSpec(code); const sf = spec?.form; const has = (k: Parameters<typeof fieldLabel>[1]) => !!sf?.fields.includes(k);
  // (On file only when it's this state's form: lib/withholding.)
  const fs = p.forms?.state; const stOn = !!fs && (fs.state ? fs.state === code : code === 'NC' && !(Number(fs.pct) > 0));
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const forms = cleanTaxForms({
        federal: d.form === 'pre2020' && !p.self ? { form: 'pre2020', status: d.status === 'hoh' ? 'single' : d.status, allowances: d.allowances, extra: d.extra, exempt: d.exempt }
          : { form: '2020', status: d.status, multipleJobs: d.multipleJobs, dependents: d.dependents, otherIncome: d.otherIncome, deductions: d.deductions, extra: d.extra, exempt: d.exempt },
        ...(code && !noTax ? { state: builtIn ? { state: code, ...(has('status') ? { status: d.sStatus || sf?.statuses?.[0]?.v } : {}), allowances: d.sAllowances, extra: d.sExtra, exempt: has('exempt') && d.sExempt,
          ...(has('additional') ? { additional: d.sAdditional } : {}), ...(has('rate') && d.sRate ? { rate: Number(d.sRate) } : {}), ...(has('code') && d.sCode ? { code: d.sCode } : {}),
          ...(has('local') && d.sLocal ? { local: d.sLocal } : {}), ...(has('amount') ? { amount: d.sAmount } : {}), ...(has('flag') ? { flag: d.sFlag } : {}), ...(has('reduce') ? { reduce: d.sReduce } : {}) }
          : { pct: d.sPct, extra: d.sExtra } } : {}),
        pretax: { retirement: d.retirement, health: d.health }, payMethod: d.payMethod,
      });
      const r = p.self ? await p.self.onSign(forms, signed.trim()) : await p.onSave({ ...forms, updatedAt: new Date().toISOString() });
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
            <DialogTitle className="pr-8 text-[20px] font-semibold leading-tight" style={{ color: INK }}>{me ? 'Your tax forms' : `${p.name}’s tax forms`}</DialogTitle>
            <DialogDescription className="mt-1 text-[14px]" style={{ color: MUTED }}>{me ? `What ${p.self!.business || 'your employer'} withholds from your pay. Changes count from your next paycheck.` : `Copy these from the forms ${first} signed. Payday works out the taxes on each paycheck from them.`}</DialogDescription>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-4 sm:px-6">
            <Section title={me ? 'Federal (W-4)' : 'Federal taxes, from their W-4'} note={!p.forms?.federal ? (me ? 'None on file yet: until you send one, you’re taxed as single, as the IRS requires.' : 'No W-4 on file yet. Until one is saved here, they’re taxed as single, as the IRS requires.') : undefined}>
              {!me && sel('tf-form', 'Their W-4 is from', d.form, set('form'), [['2020', '2020 or later'], ['pre2020', '2019 or earlier, with allowances']])}
              {me || d.form === '2020' ? <>
                {sel('tf-status', me ? 'Filing status (Step 1c)' : 'Filing status (step 1c)', d.status, set('status'), [['single', me ? 'Single, or married filing separately' : 'Single or married filing separately'], ['married', 'Married filing jointly'], ['hoh', 'Head of household']])}
                <Check label={me ? 'I have more than one job, or my spouse works (Step 2)' : 'The box in step 2c is checked (two jobs, or a spouse who works)'} checked={d.multipleJobs} onChange={set('multipleJobs')} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Money id="tf-dep" label={me ? 'Children and other dependents (Step 3)' : 'Dependents, a year (step 3)'} hint={me ? '$2,200 for each child under 17 and $500 for each other dependent, if your income qualifies' : undefined} value={d.dependents} onChange={set('dependents')} />
                  {(!me || more) && <Money id="tf-oth" label={me ? 'Other income, a year (Step 4a)' : 'Other income, a year (step 4a)'} value={d.otherIncome} onChange={set('otherIncome')} />}
                  {(!me || more) && <Money id="tf-ded" label={me ? 'Deductions, a year (Step 4b)' : 'Deductions, a year (step 4b)'} value={d.deductions} onChange={set('deductions')} />}
                  <Money id="tf-ext" label={me ? 'Extra to withhold each paycheck (Step 4c)' : 'Extra each paycheck (step 4c)'} value={d.extra} onChange={set('extra')} />
                </div>
                {me && !more && <button type="button" onClick={() => setMore(true)} className={`-my-1 min-h-[44px] self-start text-left text-[14px] font-semibold underline underline-offset-2 ${RING}`} style={{ color: INK }}>Other income and deductions (Step 4a and 4b), or claiming exempt: add them</button>}
              </> : <>
                {sel('tf-status', 'Marital status', d.status === 'hoh' ? 'single' : d.status, set('status'), [['single', 'Single, or married but withheld at the single rate'], ['married', 'Married']])}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label htmlFor="tf-allow" className="flex flex-col gap-1 text-[14px]" style={{ color: MUTED }}>Allowances
                    <input id="tf-allow" type="number" inputMode="numeric" min={0} step={1} placeholder="0" value={d.allowances} onChange={(e) => set('allowances')(e.target.value)} className={field} style={fieldStyle} /></label>
                  <Money id="tf-ext" label="Extra each paycheck" value={d.extra} onChange={set('extra')} />
                </div>
              </>}
              {(!me || more) && <Check label={me ? 'I claim exemption from withholding: I had no federal income tax last year and expect none this year' : 'They wrote “Exempt” on their W-4'} checked={d.exempt} onChange={set('exempt')} />}
              {d.exempt && <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{me ? 'No federal income tax is withheld. Social Security and Medicare still are. It lasts for this year: send a new one by February 15 next year.' : 'No federal income tax is withheld. Social Security and Medicare still are. An exempt W-4 lasts for the year it’s signed in: ask for a new one each February.'}</p>}
            </Section>

            {code && noTax && <Section title={`${p.stateName} taxes`} note={`${p.stateName} has no income tax on wages, so there’s no state form to fill in.`} />}
            {code && builtIn && sf && <Section title={sf.federal || !sf.name ? `${p.stateName} income tax` : me ? `${p.stateName} (${sf.name})` : `${p.stateName} taxes, from their ${sf.name}`}
              note={sf.federal ? `${p.stateName} works it out from the federal W-4 above${has('amount') ? `, or ${me ? 'your' : 'their'} ${sf.name} when ${me ? 'you have' : 'they have'} one` : ''}.` : !sf.name ? `${p.stateName} takes ${sf.none} from everyone: there’s no form to fill in.` : !stOn ? (me ? `None on file yet. Until you send one: ${sf.none.charAt(0).toLowerCase()}${sf.none.slice(1)}.` : `No ${sf.name} on file yet. Until one is saved here: ${sf.none.charAt(0).toLowerCase()}${sf.none.slice(1)}.`) : undefined}>
              {has('status') && sf.statuses && sel('tf-sstatus', fieldLabel(spec!, 'status'), d.sStatus || sf.statuses[0].v, set('sStatus'), sf.statuses.map((x) => [x.v, x.label] as [string, string]))}
              {has('code') && sf.codes && sel('tf-scode', fieldLabel(spec!, 'code'), d.sCode, set('sCode'), [...(sf.codes.some((x) => x.v === '') ? [] : [['', `None on file (${sf.none.charAt(0).toLowerCase()}${sf.none.slice(1)})`] as [string, string]]), ...sf.codes.map((x) => [x.v, x.label] as [string, string])])}
              {has('rate') && sf.rates && sel('tf-srate', fieldLabel(spec!, 'rate'), d.sRate, set('sRate'), [['', `None on file (${sf.none})`], ...sf.rates.map((r) => [String(r), `${r}%`] as [string, string])])}
              {has('local') && sf.locals && sel('tf-slocal', fieldLabel(spec!, 'local'), d.sLocal, set('sLocal'), [...(sf.locals.some((x) => x.v === '') ? [] : [['', 'Pick one'] as [string, string]]), ...sf.locals.map((x) => [x.v, x.label] as [string, string])])}
              <div className="grid gap-3 sm:grid-cols-2">
                {has('allowances') && <label htmlFor="tf-sallow" className="flex flex-col gap-1 text-[14px]" style={{ color: MUTED }}>{fieldLabel(spec!, 'allowances')}
                  <input id="tf-sallow" type="number" inputMode="numeric" min={0} step={1} placeholder="0" value={d.sAllowances} onChange={(e) => set('sAllowances')(e.target.value)} className={field} style={fieldStyle} /></label>}
                {has('additional') && <label htmlFor="tf-sadd" className="flex flex-col gap-1 text-[14px]" style={{ color: MUTED }}>{fieldLabel(spec!, 'additional')}
                  <input id="tf-sadd" type="number" inputMode="numeric" min={0} step={1} placeholder="0" value={d.sAdditional} onChange={(e) => set('sAdditional')(e.target.value)} className={field} style={fieldStyle} /></label>}
                {has('amount') && <Money id="tf-samt" label={fieldLabel(spec!, 'amount')} value={d.sAmount} onChange={set('sAmount')} />}
                {has('reduce') && <Money id="tf-sred" label={fieldLabel(spec!, 'reduce')} value={d.sReduce} onChange={set('sReduce')} />}
                {has('extra') && <Money id="tf-sext" label="Extra each paycheck" value={d.sExtra} onChange={set('sExtra')} />}
              </div>
              {has('flag') && <Check label={fieldLabel(spec!, 'flag')} checked={d.sFlag} onChange={set('sFlag')} />}
              {has('exempt') && sf.name && <Check label={me ? `I claim exempt on my ${sf.federal ? 'W-4' : sf.name}` : `They claimed exempt on their ${sf.federal ? 'W-4' : sf.name}`} checked={d.sExempt} onChange={set('sExempt')} />}
            </Section>}
            {code && !noTax && !builtIn && !me && <Section title={`${p.stateName} income tax`} note={`${p.stateName}’s own withholding isn’t worked out here yet. Put in the percentage from ${p.stateName}’s withholding tables for ${first}, or leave it empty to use the business’s rate in Settings, Payroll.`}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label htmlFor="tf-spct" className="flex flex-col gap-1 text-[14px]" style={{ color: MUTED }}>Percentage of wages
                  <span className="flex h-11 items-center rounded-xl bg-[#fff] px-3 focus-within:ring-2 focus-within:ring-[#16171a]" style={fieldStyle}>
                    <input id="tf-spct" type="number" inputMode="decimal" min={0} max={20} step="0.01" placeholder="0" value={d.sPct} onChange={(e) => set('sPct')(e.target.value)} className="h-full w-full min-w-0 bg-transparent text-[15px] tabular-nums focus:outline-none" style={{ color: INK }} />
                    <span aria-hidden style={{ color: MUTED }}>%</span></span></label>
                <Money id="tf-sext" label="Extra each paycheck" value={d.sExtra} onChange={set('sExtra')} />
              </div>
            </Section>}

            {!me && <><Section title="Taken out before taxes" note="Each paycheck, for a plan the business offers.">
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

            <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: '#fff', color: MUTED }}>Keep the signed forms in your files. ClarityFlow never asks for or keeps Social Security numbers: you add those when you file.</p></>}
            {me && <Section title="Sign">
              <p className="text-[14px]" style={{ color: MUTED }}>Under penalties of perjury, I declare that this certificate, to the best of my knowledge and belief, is true, correct and complete.</p>
              <label htmlFor="tf-sign" className="flex flex-col gap-1 text-[14px]" style={{ color: MUTED }}>Type your full name
                <input id="tf-sign" value={signed} onChange={(e) => setSigned(e.target.value.slice(0, 80))} autoComplete="name" className={field} style={fieldStyle} /></label>
              <p className="text-[13px]" style={{ color: MUTED }}>Your Social Security number isn’t asked for here: give it to {p.self!.business || 'your employer'} directly, for your W-2.</p>
            </Section>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 sm:px-6" style={{ borderTop: `1px solid ${LINE}`, background: SOFT }}>
            {p.notReady && <span className="mr-auto text-[13px]" style={{ color: AMBER }}>Their pay is still loading.</span>}
            {error && <span role="alert" className="mr-auto text-[13px]" style={{ color: AMBER }}>{error}</span>}
            <button type="button" onClick={() => p.onOpenChange(false)} disabled={busy} className={btn} style={plain}>Cancel</button>
            <button type="button" onClick={save} disabled={busy || p.notReady || (me && signed.trim().length < 2)} className={btn} style={solid}>{busy ? (me ? 'Sending' : 'Saving') : me ? 'Sign and send' : 'Save'}</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
