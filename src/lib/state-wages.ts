// src/lib/state-wages.ts — each state's minimum wage, for filling it in when someone picks their state (the public pay
// calculator). Rates in force as of October 2026, including the July 1, 2026 changes (Alaska, DC, Oregon) and Florida's
// September 30 step. Where a state has more than one rate, the general one is used and the note says so; cities can be
// higher. Update every year with lib/wage-data (most states change on January 1, a few on July 1 or September 30).
// Not legal advice: the state labor department has the current figure.
export const STATE_WAGES_AS_OF = 'October 2026';
export const FEDERAL_MIN = 7.25;
export const STATE_MIN_WAGE: Record<string, { rate: number; note?: string }> = {
  AL: { rate: 7.25 }, AK: { rate: 14.0 }, AZ: { rate: 15.15 }, AR: { rate: 11.0 },
  CA: { rate: 16.9, note: 'Many California cities are higher.' }, CO: { rate: 15.16, note: 'Denver is higher.' }, CT: { rate: 16.94 }, DE: { rate: 15.0 },
  DC: { rate: 18.4 }, FL: { rate: 15.0 }, GA: { rate: 7.25 }, HI: { rate: 16.0 }, ID: { rate: 7.25 }, IL: { rate: 15.0, note: 'Chicago is higher.' },
  IN: { rate: 7.25 }, IA: { rate: 7.25 }, KS: { rate: 7.25 }, KY: { rate: 7.25 }, LA: { rate: 7.25 }, ME: { rate: 15.1 }, MD: { rate: 15.0 },
  MA: { rate: 15.0 }, MI: { rate: 13.73 }, MN: { rate: 11.41, note: 'Minneapolis and St. Paul are higher.' }, MS: { rate: 7.25 }, MO: { rate: 15.0 },
  MT: { rate: 10.85 }, NE: { rate: 15.0 }, NV: { rate: 12.0 }, NH: { rate: 7.25 },
  NJ: { rate: 15.92, note: 'Lower for businesses with fewer than 6 people.' }, NM: { rate: 12.0 },
  NY: { rate: 16.0, note: '$17.00 in New York City, Long Island and Westchester.' }, NC: { rate: 7.25 }, ND: { rate: 7.25 }, OH: { rate: 11.0 },
  OK: { rate: 7.25 }, OR: { rate: 15.55, note: '$16.80 in the Portland area, $14.55 in rural counties.' }, PA: { rate: 7.25 }, RI: { rate: 16.0 },
  SC: { rate: 7.25 }, SD: { rate: 11.85 }, TN: { rate: 7.25 }, TX: { rate: 7.25 }, UT: { rate: 7.25 }, VT: { rate: 14.42 }, VA: { rate: 12.77 },
  WA: { rate: 17.13, note: 'Seattle and some other cities are higher.' }, WV: { rate: 8.75 }, WI: { rate: 7.25 }, WY: { rate: 7.25 },
};
export const minWageFor = (state: string): number => STATE_MIN_WAGE[String(state || '').toUpperCase()]?.rate ?? FEDERAL_MIN;
