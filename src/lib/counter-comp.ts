// src/lib/counter-comp.ts — ONE ITEM ON THE HOUSE (pure; lib/counter-comp-server does it; components/pos/CounterComp asks
// it). The reasons the screen offers (another can be typed), and how a line on the house reads.
export const COMP_REASONS = ['Made wrong', 'Long wait', 'A regular'];
/** What's said under a line on the house: "On the house: Long wait". */
export const compWords = (l: { comp?: { reason?: string } | null }) => (l?.comp ? `On the house${l.comp.reason ? `: ${l.comp.reason}` : ''}` : '');
