// src/lib/gift-designs.data.ts — the gift card DESIGN LIBRARY (artwork). Generated from the design files; edit the
// generator, not this file. Each design is drawn as vector art on a 420 × 265 card (real card proportions); the business's
// name, logo, the amount, code and "for" line are laid on top by <GiftCardFace>, and the art keeps clear of those spots.
import type { GiftDesign } from './gift-designs';
export const DESIGNS: GiftDesign[] = [
{
"id": "frost",
"name": "Frosted",
"collection": "Finishes",
"note": "Soft glass, gold chip.",
"bg": "linear-gradient(140deg,rgba(255,255,255,.92),rgba(236,237,243,.88))",
"sheen": "radial-gradient(120% 90% at 0% 0%,#e5e5ec 0%,transparent 55%),radial-gradient(100% 80% at 100% 0%,#e8eaf0 0%,transparent 55%)",
"svg": "",
"ink": "#16171a",
"sub": "#6d7075",
"chip": [
"#d4b06a",
"#f3e2b3"
],
"border": "1px solid rgba(255,255,255,.9)",
"tileAccent": true
},
{
"id": "metal",
"name": "Metal",
"collection": "Finishes",
"note": "Brushed black, silver chip.",
"bg": "linear-gradient(135deg,#2a2b2f 0%,#16171a 45%,#2d2e33 100%)",
"sheen": "repeating-linear-gradient(90deg,rgba(255,255,255,.035) 0 1px,transparent 1px 3px)",
"svg": "",
"ink": "#f4f4f5",
"sub": "rgba(255,255,255,.62)",
"chip": [
"#c9ccd2",
"#f2f3f5"
],
"dark": true
},
{
"id": "pearl",
"name": "Pearl",
"collection": "Finishes",
"note": "Iridescent, opal-like.",
"bg": "linear-gradient(125deg,#f7eef8 0%,#e9f1fb 28%,#f3f7ee 52%,#fbeee9 76%,#efe9fb 100%)",
"sheen": "linear-gradient(115deg,transparent 30%,rgba(255,255,255,.75) 45%,transparent 60%)",
"svg": "",
"ink": "#2b2440",
"sub": "#7b7390",
"chip": [
"#cfd3da",
"#f6f7f9"
],
"tileAccent": true
},
{
"id": "brand",
"name": "Your color",
"collection": "Finishes",
"note": "Your brand color, satin sheen.",
"bg": "linear-gradient(135deg,#8b5cf6 0%,#7c3aed 45%,#5b21b6 100%)",
"sheen": "radial-gradient(140% 90% at 100% 0%,rgba(255,255,255,.28) 0%,transparent 45%)",
"svg": "",
"ink": "#ffffff",
"sub": "rgba(255,255,255,.75)",
"chip": [
"#d4b06a",
"#f3e2b3"
],
"dark": true,
"brand": true
},
{
"id": "rose",
"name": "Rose metal",
"collection": "Finishes",
"note": "Warm brushed rose.",
"bg": "linear-gradient(135deg,#f3d9cf 0%,#e8bfae 40%,#d9a28e 70%,#efcfc3 100%)",
"sheen": "repeating-linear-gradient(90deg,rgba(255,255,255,.06) 0 1px,transparent 1px 3px)",
"svg": "",
"ink": "#3d241c",
"sub": "rgba(61,36,28,.62)",
"chip": [
"#e8d7cf",
"#fff6f2"
]
},
{
"id": "white",
"name": "White",
"collection": "Finishes",
"note": "Clean white, amount in your color.",
"bg": "#ffffff",
"sheen": "none",
"svg": "",
"ink": "#16171a",
"sub": "#6d7075",
"chip": [
"#cfd3da",
"#f6f7f9"
],
"border": "1px solid #ececee",
"tileAccent": true,
"amountAccent": true
},
{
"id": "marble",
"name": "Carrara marble",
"collection": "Luxe",
"note": "White stone with soft grey veins.",
"bg": "#fff",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><defs><filter id=\"mv\" x=\"0\" y=\"0\" width=\"100%\" height=\"100%\"><feTurbulence type=\"fractalNoise\" baseFrequency=\"0.012 0.03\" numOctaves=\"4\" seed=\"4\"/><feColorMatrix values=\"0 0 0 0 .55  0 0 0 0 .55  0 0 0 0 .58  0 0 0 -2.4 1.25\"/></filter></defs><rect width=\"420\" height=\"265\" fill=\"#f7f6f3\"/><rect width=\"420\" height=\"265\" filter=\"url(#mv)\" opacity=\".55\"/><path d=\"M75 266 C259 218, 275 240, 450 77\" stroke=\"rgba(120,120,130,0.22)\" stroke-width=\"1.4\" fill=\"none\"/><path d=\"M121 75 C84 208, 237 52, 323 255\" stroke=\"rgba(120,120,130,0.36)\" stroke-width=\"1.7\" fill=\"none\"/><path d=\"M-30 182 C175 60, 319 -13, 435 12\" stroke=\"rgba(120,120,130,0.19)\" stroke-width=\"0.9\" fill=\"none\"/><path d=\"M21 -5 C259 217, 243 205, 451 80\" stroke=\"rgba(120,120,130,0.29)\" stroke-width=\"1.6\" fill=\"none\"/><path d=\"M87 -18 C229 23, 277 122, 404 262\" stroke=\"rgba(120,120,130,0.40)\" stroke-width=\"1.9\" fill=\"none\"/><path d=\"M141 110 C140 97, 291 127, 307 15\" stroke=\"rgba(120,120,130,0.30)\" stroke-width=\"0.8\" fill=\"none\"/><path d=\"M-13 128 C158 14, 164 -20, 354 87\" stroke=\"rgba(120,120,130,0.38)\" stroke-width=\"0.7\" fill=\"none\"/></svg>",
"ink": "#1d1d1f",
"sub": "#7a7a80",
"chip": [
"#c9a256",
"#f6e3a8"
],
"tileAccent": true,
"glow": true
},
{
"id": "deco",
"name": "Art deco",
"collection": "Luxe",
"note": "Black with fine gold geometry.",
"bg": "#fff",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><defs></defs><rect width=\"420\" height=\"265\" fill=\"#121212\"/><path d=\"M170 265 L230 150 L290 265\" fill=\"none\" stroke=\"#c9a256\" stroke-width=\".8\" opacity=\".55\"/><path d=\"M200 265 L260 150 L320 265\" fill=\"none\" stroke=\"#c9a256\" stroke-width=\".8\" opacity=\".55\"/><path d=\"M230 265 L290 150 L350 265\" fill=\"none\" stroke=\"#c9a256\" stroke-width=\".8\" opacity=\".55\"/><path d=\"M260 265 L320 150 L380 265\" fill=\"none\" stroke=\"#c9a256\" stroke-width=\".8\" opacity=\".55\"/><path d=\"M290 265 L350 150 L410 265\" fill=\"none\" stroke=\"#c9a256\" stroke-width=\".8\" opacity=\".55\"/><path d=\"M320 265 L380 150 L440 265\" fill=\"none\" stroke=\"#c9a256\" stroke-width=\".8\" opacity=\".55\"/><path d=\"M350 265 L410 150 L470 265\" fill=\"none\" stroke=\"#c9a256\" stroke-width=\".8\" opacity=\".55\"/><path d=\"M380 265 L440 150 L500 265\" fill=\"none\" stroke=\"#c9a256\" stroke-width=\".8\" opacity=\".55\"/><path d=\"M410 265 L470 150 L530 265\" fill=\"none\" stroke=\"#c9a256\" stroke-width=\".8\" opacity=\".55\"/><path d=\"M440 265 L500 150 L560 265\" fill=\"none\" stroke=\"#c9a256\" stroke-width=\".8\" opacity=\".55\"/><circle cx=\"400\" cy=\"0\" r=\"30\" fill=\"none\" stroke=\"#c9a256\" stroke-width=\".7\" opacity=\".45\"/><circle cx=\"400\" cy=\"0\" r=\"48\" fill=\"none\" stroke=\"#c9a256\" stroke-width=\".7\" opacity=\".45\"/><circle cx=\"400\" cy=\"0\" r=\"66\" fill=\"none\" stroke=\"#c9a256\" stroke-width=\".7\" opacity=\".45\"/><circle cx=\"400\" cy=\"0\" r=\"84\" fill=\"none\" stroke=\"#c9a256\" stroke-width=\".7\" opacity=\".45\"/><circle cx=\"400\" cy=\"0\" r=\"102\" fill=\"none\" stroke=\"#c9a256\" stroke-width=\".7\" opacity=\".45\"/><circle cx=\"400\" cy=\"0\" r=\"120\" fill=\"none\" stroke=\"#c9a256\" stroke-width=\".7\" opacity=\".45\"/><circle cx=\"400\" cy=\"0\" r=\"138\" fill=\"none\" stroke=\"#c9a256\" stroke-width=\".7\" opacity=\".45\"/><circle cx=\"400\" cy=\"0\" r=\"156\" fill=\"none\" stroke=\"#c9a256\" stroke-width=\".7\" opacity=\".45\"/><circle cx=\"400\" cy=\"0\" r=\"174\" fill=\"none\" stroke=\"#c9a256\" stroke-width=\".7\" opacity=\".45\"/></svg>",
"ink": "#f3e6c4",
"sub": "rgba(243,230,196,.6)",
"chip": [
"#c9a256",
"#f6e3a8"
],
"dark": true,
"glow": true
},
{
"id": "velvet",
"name": "Midnight velvet",
"collection": "Luxe",
"note": "Deep velvet with a gold-foil initial.",
"bg": "#fff",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><defs><radialGradient id=\"vg\" cx=\".25\" cy=\".2\" r=\"1\"><stop offset=\"0\" stop-color=\"#3b1d5a\"/><stop offset=\".6\" stop-color=\"#1a0c2a\"/><stop offset=\"1\" stop-color=\"#0d0616\"/></radialGradient><linearGradient id=\"gf\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f6e3a8\"/><stop offset=\".5\" stop-color=\"#b8893b\"/><stop offset=\"1\" stop-color=\"#f6e3a8\"/></linearGradient><filter id=\"vn\" x=\"0\" y=\"0\" width=\"100%\" height=\"100%\"><feTurbulence type=\"fractalNoise\" baseFrequency=\".9\" numOctaves=\"2\" seed=\"3\"/></filter></defs><rect width=\"420\" height=\"265\" fill=\"url(#vg)\"/><rect width=\"420\" height=\"265\" filter=\"url(#vn)\" opacity=\".18\"/><text x=\"330\" y=\"250\" font-family=\"Georgia,serif\" font-size=\"230\" fill=\"url(#gf)\" opacity=\".5\">O</text></svg>",
"ink": "#f6eedb",
"sub": "rgba(246,238,219,.6)",
"chip": [
"#c9a256",
"#f6e3a8"
],
"dark": true,
"glow": true
},
{
"id": "holo",
"name": "Holographic foil",
"collection": "Luxe",
"note": "Chrome rainbow that shifts as you tilt.",
"bg": "#fff",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><defs><linearGradient id=\"hg\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\".6\"><stop offset=\"0\" stop-color=\"#e8f0ff\"/><stop offset=\".2\" stop-color=\"#ffd6f2\"/><stop offset=\".4\" stop-color=\"#d4fff1\"/><stop offset=\".6\" stop-color=\"#fff3c9\"/><stop offset=\".8\" stop-color=\"#d9d2ff\"/><stop offset=\"1\" stop-color=\"#cdf1ff\"/></linearGradient><linearGradient id=\"hs\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\".3\" stop-color=\"#fff\" stop-opacity=\"0\"/><stop offset=\".45\" stop-color=\"#fff\" stop-opacity=\".85\"/><stop offset=\".6\" stop-color=\"#fff\" stop-opacity=\"0\"/></linearGradient><filter id=\"hn\" x=\"0\" y=\"0\" width=\"100%\" height=\"100%\"><feTurbulence type=\"fractalNoise\" baseFrequency=\".6\" numOctaves=\"2\" seed=\"8\"/></filter></defs><rect width=\"420\" height=\"265\" fill=\"url(#hg)\"/><rect width=\"420\" height=\"265\" fill=\"url(#hs)\"/><rect width=\"420\" height=\"265\" filter=\"url(#hn)\" opacity=\".12\"/></svg>",
"ink": "#1b1830",
"sub": "rgba(27,24,48,.55)",
"chip": [
"#c9ccd2",
"#f4f5f7"
],
"tileAccent": true,
"glow": true
},
{
"id": "brush",
"name": "Brushstroke",
"collection": "Art",
"note": "One loose, painterly stroke in your color.",
"bg": "#fff",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><defs><filter id=\"bs\"><feTurbulence type=\"fractalNoise\" baseFrequency=\".04\" numOctaves=\"3\" seed=\"2\"/><feDisplacementMap in=\"SourceGraphic\" scale=\"18\"/></filter></defs><rect width=\"420\" height=\"265\" fill=\"#f6f1ea\"/><path d=\"M96 150 C 170 128, 280 158, 440 140 L 440 172 C 300 184, 190 160, 100 174 Z\" fill=\"#7c3aed\" opacity=\".85\" filter=\"url(#bs)\"/><path d=\"M120 168 C 220 150, 320 176, 440 160\" stroke=\"#5b21b6\" stroke-width=\"3\" fill=\"none\" opacity=\".45\" filter=\"url(#bs)\"/></svg>",
"ink": "#1d1d1f",
"sub": "#7a7a80",
"chip": [
"#c9a256",
"#f6e3a8"
],
"tileAccent": true,
"glow": true
},
{
"id": "watercolor",
"name": "Watercolor wash",
"collection": "Art",
"note": "Soft blooms of pigment on paper.",
"bg": "#fff",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><defs><filter id=\"wc\" x=\"-30%\" y=\"-30%\" width=\"160%\" height=\"160%\"><feTurbulence type=\"fractalNoise\" baseFrequency=\".03\" numOctaves=\"4\" seed=\"5\"/><feDisplacementMap in=\"SourceGraphic\" scale=\"38\"/><feGaussianBlur stdDeviation=\"6\"/></filter><filter id=\"pp\" x=\"0\" y=\"0\" width=\"100%\" height=\"100%\"><feTurbulence type=\"fractalNoise\" baseFrequency=\".8\" numOctaves=\"3\" seed=\"1\"/></filter></defs><rect width=\"420\" height=\"265\" fill=\"#fbf8f4\"/><circle cx=\"330\" cy=\"70\" r=\"90\" fill=\"#f3b6c8\" opacity=\".55\" filter=\"url(#wc)\"/><circle cx=\"380\" cy=\"180\" r=\"80\" fill=\"#c7b8f2\" opacity=\".55\" filter=\"url(#wc)\"/><circle cx=\"250\" cy=\"210\" r=\"70\" fill=\"#f8d6a8\" opacity=\".55\" filter=\"url(#wc)\"/><circle cx=\"400\" cy=\"40\" r=\"50\" fill=\"#b8dcef\" opacity=\".55\" filter=\"url(#wc)\"/><rect width=\"420\" height=\"265\" filter=\"url(#pp)\" opacity=\".08\"/></svg>",
"ink": "#2a2433",
"sub": "#7a7184",
"chip": [
"#d8b4a6",
"#fbe9e2"
],
"tileAccent": true,
"glow": true
},
{
"id": "bauhaus",
"name": "Modern shapes",
"collection": "Art",
"note": "Bold circles and arches, print-shop grain.",
"bg": "#fff",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><defs><filter id=\"gr\" x=\"0\" y=\"0\" width=\"100%\" height=\"100%\"><feTurbulence type=\"fractalNoise\" baseFrequency=\".9\" numOctaves=\"2\" seed=\"9\"/></filter></defs><rect width=\"420\" height=\"265\" fill=\"#efe7da\"/><circle cx=\"190\" cy=\"118\" r=\"44\" fill=\"#e4572e\"/><path d=\"M300 212 A 55 55 0 0 1 410 212 Z\" fill=\"#2d3a8c\"/><rect x=\"232\" y=\"132\" width=\"40\" height=\"40\" fill=\"#f2b33d\"/><circle cx=\"122\" cy=\"96\" r=\"11\" fill=\"#1d1d1f\"/><rect x=\"0\" y=\"258\" width=\"420\" height=\"7\" fill=\"#2d3a8c\"/><rect width=\"420\" height=\"265\" filter=\"url(#gr)\" opacity=\".16\"/></svg>",
"ink": "#1d1d1f",
"sub": "#5c5c62",
"chip": [
"#c9a256",
"#f6e3a8"
],
"tileAccent": true,
"glow": true
},
{
"id": "lineart",
"name": "Fine-line botanicals",
"collection": "Art",
"note": "Hand-drawn stems in a single line.",
"bg": "#fff",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><defs></defs><rect width=\"420\" height=\"265\" fill=\"#fbfaf7\"/><g fill=\"none\" stroke=\"#2b2b2b\" stroke-width=\"1.6\" stroke-linecap=\"round\" opacity=\".75\" transform=\"translate(-60,-20) scale(.82)\"><path d=\"M330 265 C 330 200, 340 150, 372 100\"/><path d=\"M342 190 C 312 180, 300 160, 304 140 C 324 150, 338 168, 342 190\"/><path d=\"M352 150 C 380 150, 396 132, 398 112 C 376 116, 360 130, 352 150\"/><path d=\"M372 100 C 362 82, 366 62, 380 50 C 392 66, 388 86, 372 100\"/><path d=\"M290 265 C 296 230, 286 210, 262 196\"/><path d=\"M276 208 C 260 214, 246 210, 238 198 C 254 194, 268 198, 276 208\"/></g><circle cx=\"253\" cy=\"16\" r=\"2.6\" fill=\"#7c3aed\"/></svg>",
"ink": "#1d1d1f",
"sub": "#7a7a80",
"chip": [
"#c9a256",
"#f6e3a8"
],
"tileAccent": true,
"glow": true
},
{
"id": "terrazzo",
"name": "Terrazzo",
"collection": "Nature",
"note": "Speckled stone in warm, playful chips.",
"bg": "#fff",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><defs></defs><rect width=\"420\" height=\"265\" fill=\"#f2ede6\"/><path d=\"M176.31238841024117 150.05406265560947 l8.5 4.4 l3.1 7.8 l-11.1 -1.3Z\" fill=\"#e9967a\" opacity=\".85\"/><path d=\"M296.94673227101157 2.903078651962808 l12.6 4.1 l3.2 11.2 l-12.5 1.8Z\" fill=\"#c9786a\" opacity=\".85\"/><path d=\"M195.27473535201725 129.00817235622333 l11.5 5.4 l3.5 8.4 l-13.1 -0.9Z\" fill=\"#9aa7c7\" opacity=\".85\"/><path d=\"M286.47252555865015 49.92214890992337 l11.3 -2.0 l5.5 8.5 l-6.8 -0.0Z\" fill=\"#9aa7c7\" opacity=\".85\"/><path d=\"M213.72348472541162 261.0995725464222 l4.9 -4.3 l-3.1 9.4 l-6.9 -0.9Z\" fill=\"#9aa7c7\" opacity=\".85\"/><path d=\"M161.17575100759677 104.63614345714626 l4.4 -0.4 l3.0 4.8 l-13.7 3.9Z\" fill=\"#9aa7c7\" opacity=\".85\"/><path d=\"M415.821943800178 0.12479075413694418 l8.1 -5.1 l5.2 7.4 l-8.9 1.9Z\" fill=\"#7c9a7e\" opacity=\".85\"/><path d=\"M248.9510635118258 264.44448545194604 l12.2 -1.4 l-0.7 7.3 l-13.8 0.4Z\" fill=\"#3f3f46\" opacity=\".85\"/><path d=\"M418.25100257127207 159.5349012321714 l7.2 3.5 l-1.5 11.9 l-8.7 -0.4Z\" fill=\"#7c9a7e\" opacity=\".85\"/><path d=\"M4.021600220573454 161.7382879344611 l7.4 1.8 l-2.9 7.0 l-8.9 2.7Z\" fill=\"#e9967a\" opacity=\".85\"/><path d=\"M154.84358605828655 164.86954659298172 l10.1 -4.1 l3.7 11.2 l-8.5 0.1Z\" fill=\"#c9786a\" opacity=\".85\"/><path d=\"M53.43285875645697 155.6268863617405 l9.1 0.9 l-2.0 11.5 l-4.0 2.2Z\" fill=\"#7c9a7e\" opacity=\".85\"/><path d=\"M163.0481740125991 127.86679599386875 l9.7 -5.7 l2.6 10.2 l-12.6 0.9Z\" fill=\"#9aa7c7\" opacity=\".85\"/><path d=\"M164.47660615989702 111.51605519119818 l11.0 -2.0 l5.3 6.9 l-9.4 -1.3Z\" fill=\"#3f3f46\" opacity=\".85\"/><path d=\"M189.14521375154877 87.70571179007732 l5.4 4.8 l1.4 8.5 l-8.4 -0.4Z\" fill=\"#3f3f46\" opacity=\".85\"/><path d=\"M397.6788130324022 156.31704229337228 l13.9 3.8 l2.0 5.0 l-5.8 -0.3Z\" fill=\"#d9b26f\" opacity=\".85\"/><path d=\"M14.087577379709877 158.56876815549208 l6.4 0.9 l4.3 5.5 l-8.5 -1.5Z\" fill=\"#e9967a\" opacity=\".85\"/><path d=\"M393.22477124316254 195.3445634355993 l8.0 3.4 l5.3 12.0 l-12.6 2.5Z\" fill=\"#3f3f46\" opacity=\".85\"/><path d=\"M174.82343990986772 87.48971740108448 l13.1 1.4 l2.4 10.1 l-12.4 0.5Z\" fill=\"#e9967a\" opacity=\".85\"/><path d=\"M392.38562381801023 183.95146514439963 l5.4 -1.4 l1.7 5.4 l-8.8 -0.4Z\" fill=\"#c9786a\" opacity=\".85\"/><path d=\"M192.25743282600826 122.59489135569376 l13.3 -5.4 l3.8 9.8 l-6.1 0.4Z\" fill=\"#9aa7c7\" opacity=\".85\"/><path d=\"M227.32576917997397 137.4547422960825 l10.0 -0.4 l0.1 9.0 l-7.1 2.5Z\" fill=\"#d9b26f\" opacity=\".85\"/><path d=\"M327.57738111981274 174.93487081619375 l8.9 5.9 l4.4 10.8 l-9.9 0.6Z\" fill=\"#c9786a\" opacity=\".85\"/><path d=\"M256.93839553804133 137.37457442988375 l5.1 5.3 l-0.7 8.2 l-9.8 -1.9Z\" fill=\"#e9967a\" opacity=\".85\"/><path d=\"M101.4231563905139 107.26064988570846 l7.0 1.4 l0.3 7.0 l-10.8 2.7Z\" fill=\"#c9786a\" opacity=\".85\"/><path d=\"M337.55976660933436 199.97686872086388 l12.8 -3.1 l4.4 5.9 l-5.3 3.8Z\" fill=\"#9aa7c7\" opacity=\".85\"/><path d=\"M160.6702044815428 137.79345866946107 l10.9 0.3 l-1.6 6.5 l-10.0 -0.6Z\" fill=\"#e9967a\" opacity=\".85\"/><path d=\"M353.5988598499844 165.56573126395415 l14.0 2.8 l4.7 7.0 l-8.5 1.4Z\" fill=\"#7c9a7e\" opacity=\".85\"/><path d=\"M116.81195949456246 161.00195516641753 l6.2 3.0 l1.7 11.2 l-13.0 2.8Z\" fill=\"#e9967a\" opacity=\".85\"/><path d=\"M45.78848424989714 141.87876908918025 l12.8 0.9 l0.5 6.4 l-6.7 -1.9Z\" fill=\"#7c9a7e\" opacity=\".85\"/><path d=\"M268.7646517090623 97.70102135086113 l4.6 4.7 l4.2 7.2 l-10.4 1.5Z\" fill=\"#e9967a\" opacity=\".85\"/><path d=\"M299.97362453134355 200.08850459108402 l7.1 -0.5 l-0.9 6.6 l-12.6 2.7Z\" fill=\"#9aa7c7\" opacity=\".85\"/><path d=\"M210.17472951164854 264.15432483252 l12.8 -3.6 l4.6 9.5 l-13.4 -0.1Z\" fill=\"#d9b26f\" opacity=\".85\"/><path d=\"M293.91214743718155 59.33954520605921 l13.0 -5.8 l2.4 9.6 l-8.4 1.2Z\" fill=\"#7c9a7e\" opacity=\".85\"/><path d=\"M162.9483206164998 119.38327986886412 l5.9 4.6 l-3.5 4.8 l-6.7 -0.1Z\" fill=\"#d9b26f\" opacity=\".85\"/><path d=\"M2.8251607586231686 145.75346343767436 l12.7 2.6 l-2.7 9.6 l-4.6 0.7Z\" fill=\"#e9967a\" opacity=\".85\"/><path d=\"M137.11626405682767 260.31846969795976 l5.7 4.3 l-2.8 9.5 l-11.3 2.3Z\" fill=\"#c9786a\" opacity=\".85\"/><path d=\"M143.66271697824305 111.67551780925598 l10.6 3.5 l-0.3 9.3 l-5.2 1.5Z\" fill=\"#7c9a7e\" opacity=\".85\"/><path d=\"M419.92603880867705 238.6503163482628 l13.8 4.7 l-2.2 5.8 l-12.7 2.0Z\" fill=\"#9aa7c7\" opacity=\".85\"/><path d=\"M59.28313975591174 144.3486848765602 l13.8 -0.7 l1.3 8.2 l-13.5 1.6Z\" fill=\"#d9b26f\" opacity=\".85\"/><path d=\"M114.6442124296383 131.87661396903033 l9.4 -0.9 l1.7 5.3 l-4.1 -0.9Z\" fill=\"#7c9a7e\" opacity=\".85\"/><path d=\"M2.073035196927564 99.91300733652123 l6.8 0.6 l-2.1 11.2 l-4.1 -1.8Z\" fill=\"#9aa7c7\" opacity=\".85\"/><path d=\"M207.0753590265392 90.0154143938762 l13.2 1.0 l-4.0 11.1 l-13.4 -1.6Z\" fill=\"#3f3f46\" opacity=\".85\"/><path d=\"M209.50553286114268 132.41424913471076 l13.1 -2.2 l0.8 4.3 l-11.1 3.0Z\" fill=\"#3f3f46\" opacity=\".85\"/><path d=\"M346.57549591605385 163.1855118075613 l10.8 0.2 l5.5 5.4 l-6.2 -1.0Z\" fill=\"#c9786a\" opacity=\".85\"/><path d=\"M90.79197449630817 143.8794403307397 l8.4 2.0 l1.5 6.0 l-6.8 2.3Z\" fill=\"#d9b26f\" opacity=\".85\"/><path d=\"M384.22587328496616 166.38925976890835 l8.9 -3.3 l1.8 8.0 l-13.6 1.6Z\" fill=\"#3f3f46\" opacity=\".85\"/><path d=\"M239.3580203250119 94.76071336503203 l4.5 -0.6 l4.8 6.6 l-7.9 1.7Z\" fill=\"#9aa7c7\" opacity=\".85\"/><path d=\"M295.9788928358703 168.18531957202347 l9.0 2.7 l4.6 4.2 l-12.9 -0.9Z\" fill=\"#3f3f46\" opacity=\".85\"/><path d=\"M144.2686980304858 264.6254648395322 l9.4 3.5 l-1.6 5.2 l-10.9 -1.7Z\" fill=\"#d9b26f\" opacity=\".85\"/><path d=\"M320.0388228275033 162.54131586423847 l12.2 2.9 l3.8 10.1 l-9.0 1.9Z\" fill=\"#c9786a\" opacity=\".85\"/><path d=\"M286.0055638407894 20.565502663336133 l5.7 -2.9 l-2.4 9.5 l-5.7 2.7Z\" fill=\"#e9967a\" opacity=\".85\"/><path d=\"M179.10623190120302 93.96110254504927 l7.2 -0.4 l3.0 9.6 l-4.4 -1.2Z\" fill=\"#c9786a\" opacity=\".85\"/><path d=\"M88.23575699620332 98.88579408459506 l13.9 -4.3 l0.6 10.0 l-13.6 -0.6Z\" fill=\"#c9786a\" opacity=\".85\"/><path d=\"M151.01860918492358 98.10137012902685 l5.4 -1.3 l-1.0 7.4 l-13.2 -1.8Z\" fill=\"#3f3f46\" opacity=\".85\"/><path d=\"M387.1822622563904 160.29115027744558 l11.6 2.8 l-1.7 6.0 l-8.5 -0.5Z\" fill=\"#9aa7c7\" opacity=\".85\"/><path d=\"M245.5382403189369 90.35825456140688 l4.9 -3.3 l-0.9 11.6 l-4.8 -0.7Z\" fill=\"#7c9a7e\" opacity=\".85\"/><path d=\"M226.32703223687025 98.01504398380588 l8.0 1.8 l-3.4 6.7 l-7.1 3.2Z\" fill=\"#c9786a\" opacity=\".85\"/><path d=\"M416.04321709468263 239.21672523293924 l13.2 -3.9 l4.6 11.5 l-11.9 0.3Z\" fill=\"#e9967a\" opacity=\".85\"/><path d=\"M90.74008164629126 107.62479492230354 l6.2 -1.8 l-2.2 8.4 l-12.4 -0.8Z\" fill=\"#7c9a7e\" opacity=\".85\"/></svg>",
"ink": "#1d1d1f",
"sub": "#6a6a70",
"chip": [
"#c9a256",
"#f6e3a8"
],
"tileAccent": true,
"glow": true
},
{
"id": "aurora",
"name": "Aurora",
"collection": "Nature",
"note": "Northern-lights color drifting across night.",
"bg": "#fff",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><defs><filter id=\"ab\" x=\"-50%\" y=\"-50%\" width=\"200%\" height=\"200%\"><feGaussianBlur stdDeviation=\"22\"/></filter></defs><rect width=\"420\" height=\"265\" fill=\"#0b1026\"/><g filter=\"url(#ab)\"><ellipse cx=\"320\" cy=\"60\" rx=\"160\" ry=\"40\" fill=\"#34d399\" opacity=\".55\" transform=\"rotate(-18 320 60)\"/><ellipse cx=\"260\" cy=\"120\" rx=\"180\" ry=\"34\" fill=\"#818cf8\" opacity=\".5\" transform=\"rotate(-12 260 120)\"/><ellipse cx=\"380\" cy=\"170\" rx=\"120\" ry=\"30\" fill=\"#f472b6\" opacity=\".35\" transform=\"rotate(-20 380 170)\"/></g><circle cx=\"249\" cy=\"201\" r=\"0.7\" fill=\"#fff\" opacity=\"0.59\"/><circle cx=\"263\" cy=\"48\" r=\"0.7\" fill=\"#fff\" opacity=\"0.62\"/><circle cx=\"176\" cy=\"12\" r=\"0.6\" fill=\"#fff\" opacity=\"0.87\"/><circle cx=\"261\" cy=\"138\" r=\"0.9\" fill=\"#fff\" opacity=\"0.61\"/><circle cx=\"238\" cy=\"172\" r=\"0.6\" fill=\"#fff\" opacity=\"0.36\"/><circle cx=\"24\" cy=\"193\" r=\"0.9\" fill=\"#fff\" opacity=\"0.38\"/><circle cx=\"101\" cy=\"222\" r=\"0.5\" fill=\"#fff\" opacity=\"0.90\"/><circle cx=\"352\" cy=\"119\" r=\"1.0\" fill=\"#fff\" opacity=\"0.53\"/><circle cx=\"108\" cy=\"233\" r=\"0.9\" fill=\"#fff\" opacity=\"0.48\"/><circle cx=\"255\" cy=\"129\" r=\"0.5\" fill=\"#fff\" opacity=\"0.61\"/><circle cx=\"54\" cy=\"55\" r=\"0.7\" fill=\"#fff\" opacity=\"0.59\"/><circle cx=\"291\" cy=\"137\" r=\"0.8\" fill=\"#fff\" opacity=\"0.49\"/><circle cx=\"190\" cy=\"100\" r=\"1.0\" fill=\"#fff\" opacity=\"0.80\"/><circle cx=\"225\" cy=\"119\" r=\"0.5\" fill=\"#fff\" opacity=\"0.61\"/><circle cx=\"149\" cy=\"27\" r=\"0.7\" fill=\"#fff\" opacity=\"0.67\"/><circle cx=\"59\" cy=\"225\" r=\"0.9\" fill=\"#fff\" opacity=\"0.59\"/><circle cx=\"5\" cy=\"202\" r=\"0.9\" fill=\"#fff\" opacity=\"0.70\"/><circle cx=\"28\" cy=\"226\" r=\"0.8\" fill=\"#fff\" opacity=\"0.51\"/><circle cx=\"51\" cy=\"205\" r=\"0.7\" fill=\"#fff\" opacity=\"0.77\"/><circle cx=\"109\" cy=\"212\" r=\"0.5\" fill=\"#fff\" opacity=\"0.60\"/><circle cx=\"206\" cy=\"247\" r=\"0.6\" fill=\"#fff\" opacity=\"0.72\"/><circle cx=\"93\" cy=\"245\" r=\"0.5\" fill=\"#fff\" opacity=\"0.76\"/><circle cx=\"147\" cy=\"189\" r=\"0.8\" fill=\"#fff\" opacity=\"0.75\"/><circle cx=\"381\" cy=\"213\" r=\"0.7\" fill=\"#fff\" opacity=\"0.45\"/><circle cx=\"358\" cy=\"82\" r=\"1.0\" fill=\"#fff\" opacity=\"0.84\"/><circle cx=\"51\" cy=\"241\" r=\"1.0\" fill=\"#fff\" opacity=\"0.46\"/><circle cx=\"158\" cy=\"224\" r=\"0.6\" fill=\"#fff\" opacity=\"0.73\"/><circle cx=\"372\" cy=\"19\" r=\"0.4\" fill=\"#fff\" opacity=\"0.49\"/><circle cx=\"157\" cy=\"79\" r=\"1.0\" fill=\"#fff\" opacity=\"0.83\"/><circle cx=\"270\" cy=\"102\" r=\"0.6\" fill=\"#fff\" opacity=\"0.84\"/><circle cx=\"13\" cy=\"187\" r=\"0.6\" fill=\"#fff\" opacity=\"0.35\"/><circle cx=\"20\" cy=\"144\" r=\"0.8\" fill=\"#fff\" opacity=\"0.34\"/><circle cx=\"29\" cy=\"123\" r=\"0.7\" fill=\"#fff\" opacity=\"0.88\"/><circle cx=\"162\" cy=\"213\" r=\"0.9\" fill=\"#fff\" opacity=\"0.46\"/><circle cx=\"208\" cy=\"125\" r=\"0.4\" fill=\"#fff\" opacity=\"0.66\"/><circle cx=\"113\" cy=\"68\" r=\"0.6\" fill=\"#fff\" opacity=\"0.61\"/><circle cx=\"389\" cy=\"260\" r=\"0.4\" fill=\"#fff\" opacity=\"0.63\"/><circle cx=\"357\" cy=\"203\" r=\"0.5\" fill=\"#fff\" opacity=\"0.79\"/><circle cx=\"371\" cy=\"183\" r=\"1.0\" fill=\"#fff\" opacity=\"0.46\"/><circle cx=\"44\" cy=\"5\" r=\"1.0\" fill=\"#fff\" opacity=\"0.42\"/></svg>",
"ink": "#ffffff",
"sub": "rgba(255,255,255,.6)",
"chip": [
"#c9ccd2",
"#f4f5f7"
],
"dark": true,
"glow": true
},
{
"id": "pressed",
"name": "Pressed flowers",
"collection": "Nature",
"note": "Delicate petals, like a page from a flower press.",
"bg": "#fff",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><defs><filter id=\"pg\" x=\"0\" y=\"0\" width=\"100%\" height=\"100%\"><feTurbulence type=\"fractalNoise\" baseFrequency=\".7\" numOctaves=\"3\" seed=\"2\"/></filter></defs><rect width=\"420\" height=\"265\" fill=\"#f4efe6\"/><rect width=\"420\" height=\"265\" filter=\"url(#pg)\" opacity=\".1\"/><g transform=\"translate(170 118) rotate(10)\" opacity=\".85\"><ellipse cx=\"0\" cy=\"-14\" rx=\"7.0\" ry=\"14\" fill=\"#e79bb0\" transform=\"rotate(0)\"/><ellipse cx=\"0\" cy=\"-14\" rx=\"7.0\" ry=\"14\" fill=\"#e79bb0\" transform=\"rotate(72)\"/><ellipse cx=\"0\" cy=\"-14\" rx=\"7.0\" ry=\"14\" fill=\"#e79bb0\" transform=\"rotate(144)\"/><ellipse cx=\"0\" cy=\"-14\" rx=\"7.0\" ry=\"14\" fill=\"#e79bb0\" transform=\"rotate(216)\"/><ellipse cx=\"0\" cy=\"-14\" rx=\"7.0\" ry=\"14\" fill=\"#e79bb0\" transform=\"rotate(288)\"/><circle r=\"4.9\" fill=\"#e6b84a\"/></g><g transform=\"translate(232 150) rotate(40)\" opacity=\".85\"><ellipse cx=\"0\" cy=\"-10\" rx=\"5.0\" ry=\"10\" fill=\"#b9a7e8\" transform=\"rotate(0)\"/><ellipse cx=\"0\" cy=\"-10\" rx=\"5.0\" ry=\"10\" fill=\"#b9a7e8\" transform=\"rotate(72)\"/><ellipse cx=\"0\" cy=\"-10\" rx=\"5.0\" ry=\"10\" fill=\"#b9a7e8\" transform=\"rotate(144)\"/><ellipse cx=\"0\" cy=\"-10\" rx=\"5.0\" ry=\"10\" fill=\"#b9a7e8\" transform=\"rotate(216)\"/><ellipse cx=\"0\" cy=\"-10\" rx=\"5.0\" ry=\"10\" fill=\"#b9a7e8\" transform=\"rotate(288)\"/><circle r=\"3.5\" fill=\"#e6b84a\"/></g><g transform=\"translate(330 186) rotate(20)\" opacity=\".85\"><ellipse cx=\"0\" cy=\"-9\" rx=\"4.5\" ry=\"9\" fill=\"#f0b27a\" transform=\"rotate(0)\"/><ellipse cx=\"0\" cy=\"-9\" rx=\"4.5\" ry=\"9\" fill=\"#f0b27a\" transform=\"rotate(72)\"/><ellipse cx=\"0\" cy=\"-9\" rx=\"4.5\" ry=\"9\" fill=\"#f0b27a\" transform=\"rotate(144)\"/><ellipse cx=\"0\" cy=\"-9\" rx=\"4.5\" ry=\"9\" fill=\"#f0b27a\" transform=\"rotate(216)\"/><ellipse cx=\"0\" cy=\"-9\" rx=\"4.5\" ry=\"9\" fill=\"#f0b27a\" transform=\"rotate(288)\"/><circle r=\"3.1\" fill=\"#e6b84a\"/></g><g transform=\"translate(124 98) rotate(0)\" opacity=\".85\"><ellipse cx=\"0\" cy=\"-6\" rx=\"3.0\" ry=\"6\" fill=\"#e79bb0\" transform=\"rotate(0)\"/><ellipse cx=\"0\" cy=\"-6\" rx=\"3.0\" ry=\"6\" fill=\"#e79bb0\" transform=\"rotate(72)\"/><ellipse cx=\"0\" cy=\"-6\" rx=\"3.0\" ry=\"6\" fill=\"#e79bb0\" transform=\"rotate(144)\"/><ellipse cx=\"0\" cy=\"-6\" rx=\"3.0\" ry=\"6\" fill=\"#e79bb0\" transform=\"rotate(216)\"/><ellipse cx=\"0\" cy=\"-6\" rx=\"3.0\" ry=\"6\" fill=\"#e79bb0\" transform=\"rotate(288)\"/><circle r=\"2.1\" fill=\"#e6b84a\"/></g><g transform=\"translate(378 178) rotate(30)\" opacity=\".85\"><ellipse cx=\"0\" cy=\"-6\" rx=\"3.0\" ry=\"6\" fill=\"#9cc3a0\" transform=\"rotate(0)\"/><ellipse cx=\"0\" cy=\"-6\" rx=\"3.0\" ry=\"6\" fill=\"#9cc3a0\" transform=\"rotate(72)\"/><ellipse cx=\"0\" cy=\"-6\" rx=\"3.0\" ry=\"6\" fill=\"#9cc3a0\" transform=\"rotate(144)\"/><ellipse cx=\"0\" cy=\"-6\" rx=\"3.0\" ry=\"6\" fill=\"#9cc3a0\" transform=\"rotate(216)\"/><ellipse cx=\"0\" cy=\"-6\" rx=\"3.0\" ry=\"6\" fill=\"#9cc3a0\" transform=\"rotate(288)\"/><circle r=\"2.1\" fill=\"#e6b84a\"/></g><path d=\"M170 132 C 180 150, 200 160, 232 150 M330 195 C 340 205, 360 208, 378 186\" stroke=\"#8aa58b\" stroke-width=\"1.4\" fill=\"none\"/></svg>",
"ink": "#2e2a24",
"sub": "#857b6f",
"chip": [
"#c9a256",
"#f6e3a8"
],
"tileAccent": true,
"glow": true
},
{
"id": "night",
"name": "Constellations",
"collection": "Nature",
"note": "A quiet night sky with joined stars.",
"bg": "#fff",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><defs><linearGradient id=\"ns\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#1e1b4b\"/><stop offset=\"1\" stop-color=\"#0b1026\"/></linearGradient></defs><rect width=\"420\" height=\"265\" fill=\"url(#ns)\"/><circle cx=\"166\" cy=\"41\" r=\"0.4\" fill=\"#fff\" opacity=\"0.30\"/><circle cx=\"140\" cy=\"183\" r=\"0.9\" fill=\"#fff\" opacity=\"0.38\"/><circle cx=\"174\" cy=\"97\" r=\"0.8\" fill=\"#fff\" opacity=\"0.50\"/><circle cx=\"271\" cy=\"96\" r=\"0.8\" fill=\"#fff\" opacity=\"0.75\"/><circle cx=\"310\" cy=\"233\" r=\"1.0\" fill=\"#fff\" opacity=\"0.69\"/><circle cx=\"372\" cy=\"82\" r=\"0.9\" fill=\"#fff\" opacity=\"0.51\"/><circle cx=\"285\" cy=\"11\" r=\"0.7\" fill=\"#fff\" opacity=\"0.45\"/><circle cx=\"202\" cy=\"91\" r=\"0.6\" fill=\"#fff\" opacity=\"0.64\"/><circle cx=\"291\" cy=\"67\" r=\"0.7\" fill=\"#fff\" opacity=\"0.42\"/><circle cx=\"287\" cy=\"49\" r=\"0.9\" fill=\"#fff\" opacity=\"0.32\"/><circle cx=\"237\" cy=\"34\" r=\"1.0\" fill=\"#fff\" opacity=\"0.58\"/><circle cx=\"53\" cy=\"196\" r=\"0.5\" fill=\"#fff\" opacity=\"0.30\"/><circle cx=\"84\" cy=\"165\" r=\"0.5\" fill=\"#fff\" opacity=\"0.59\"/><circle cx=\"409\" cy=\"125\" r=\"0.8\" fill=\"#fff\" opacity=\"0.67\"/><circle cx=\"390\" cy=\"71\" r=\"0.5\" fill=\"#fff\" opacity=\"0.35\"/><circle cx=\"280\" cy=\"102\" r=\"0.8\" fill=\"#fff\" opacity=\"0.28\"/><circle cx=\"66\" cy=\"264\" r=\"0.9\" fill=\"#fff\" opacity=\"0.32\"/><circle cx=\"150\" cy=\"143\" r=\"0.9\" fill=\"#fff\" opacity=\"0.44\"/><circle cx=\"380\" cy=\"221\" r=\"0.9\" fill=\"#fff\" opacity=\"0.30\"/><circle cx=\"28\" cy=\"116\" r=\"0.9\" fill=\"#fff\" opacity=\"0.59\"/><circle cx=\"94\" cy=\"191\" r=\"0.6\" fill=\"#fff\" opacity=\"0.29\"/><circle cx=\"242\" cy=\"179\" r=\"0.5\" fill=\"#fff\" opacity=\"0.37\"/><circle cx=\"364\" cy=\"117\" r=\"0.9\" fill=\"#fff\" opacity=\"0.53\"/><circle cx=\"377\" cy=\"233\" r=\"0.6\" fill=\"#fff\" opacity=\"0.29\"/><circle cx=\"371\" cy=\"72\" r=\"0.7\" fill=\"#fff\" opacity=\"0.36\"/><circle cx=\"168\" cy=\"85\" r=\"0.4\" fill=\"#fff\" opacity=\"0.32\"/><circle cx=\"232\" cy=\"148\" r=\"0.4\" fill=\"#fff\" opacity=\"0.20\"/><circle cx=\"319\" cy=\"178\" r=\"0.3\" fill=\"#fff\" opacity=\"0.40\"/><circle cx=\"59\" cy=\"209\" r=\"1.0\" fill=\"#fff\" opacity=\"0.45\"/><circle cx=\"13\" cy=\"93\" r=\"0.7\" fill=\"#fff\" opacity=\"0.53\"/><circle cx=\"90\" cy=\"163\" r=\"0.9\" fill=\"#fff\" opacity=\"0.35\"/><circle cx=\"79\" cy=\"77\" r=\"0.5\" fill=\"#fff\" opacity=\"0.68\"/><circle cx=\"240\" cy=\"249\" r=\"0.3\" fill=\"#fff\" opacity=\"0.71\"/><circle cx=\"397\" cy=\"143\" r=\"0.8\" fill=\"#fff\" opacity=\"0.36\"/><circle cx=\"10\" cy=\"147\" r=\"0.3\" fill=\"#fff\" opacity=\"0.48\"/><circle cx=\"372\" cy=\"17\" r=\"0.6\" fill=\"#fff\" opacity=\"0.66\"/><circle cx=\"111\" cy=\"65\" r=\"0.9\" fill=\"#fff\" opacity=\"0.50\"/><circle cx=\"129\" cy=\"141\" r=\"0.8\" fill=\"#fff\" opacity=\"0.68\"/><circle cx=\"323\" cy=\"248\" r=\"0.6\" fill=\"#fff\" opacity=\"0.70\"/><circle cx=\"172\" cy=\"238\" r=\"0.7\" fill=\"#fff\" opacity=\"0.21\"/><circle cx=\"59\" cy=\"86\" r=\"0.8\" fill=\"#fff\" opacity=\"0.50\"/><circle cx=\"116\" cy=\"263\" r=\"0.7\" fill=\"#fff\" opacity=\"0.47\"/><circle cx=\"131\" cy=\"18\" r=\"0.8\" fill=\"#fff\" opacity=\"0.56\"/><circle cx=\"111\" cy=\"57\" r=\"0.4\" fill=\"#fff\" opacity=\"0.23\"/><circle cx=\"55\" cy=\"81\" r=\"0.4\" fill=\"#fff\" opacity=\"0.41\"/><circle cx=\"65\" cy=\"99\" r=\"0.4\" fill=\"#fff\" opacity=\"0.21\"/><circle cx=\"168\" cy=\"14\" r=\"0.4\" fill=\"#fff\" opacity=\"0.77\"/><circle cx=\"353\" cy=\"202\" r=\"0.3\" fill=\"#fff\" opacity=\"0.30\"/><circle cx=\"28\" cy=\"156\" r=\"0.7\" fill=\"#fff\" opacity=\"0.39\"/><circle cx=\"199\" cy=\"249\" r=\"0.6\" fill=\"#fff\" opacity=\"0.67\"/><circle cx=\"373\" cy=\"215\" r=\"0.3\" fill=\"#fff\" opacity=\"0.43\"/><circle cx=\"387\" cy=\"234\" r=\"0.8\" fill=\"#fff\" opacity=\"0.52\"/><circle cx=\"4\" cy=\"194\" r=\"0.8\" fill=\"#fff\" opacity=\"0.75\"/><circle cx=\"23\" cy=\"163\" r=\"0.5\" fill=\"#fff\" opacity=\"0.46\"/><circle cx=\"300\" cy=\"112\" r=\"1.0\" fill=\"#fff\" opacity=\"0.75\"/><circle cx=\"51\" cy=\"196\" r=\"0.8\" fill=\"#fff\" opacity=\"0.46\"/><circle cx=\"196\" cy=\"222\" r=\"0.7\" fill=\"#fff\" opacity=\"0.43\"/><circle cx=\"227\" cy=\"11\" r=\"0.9\" fill=\"#fff\" opacity=\"0.52\"/><circle cx=\"190\" cy=\"75\" r=\"0.3\" fill=\"#fff\" opacity=\"0.23\"/><circle cx=\"136\" cy=\"142\" r=\"0.5\" fill=\"#fff\" opacity=\"0.35\"/><circle cx=\"262\" cy=\"50\" r=\"0.6\" fill=\"#fff\" opacity=\"0.53\"/><circle cx=\"22\" cy=\"257\" r=\"0.8\" fill=\"#fff\" opacity=\"0.74\"/><circle cx=\"47\" cy=\"50\" r=\"0.9\" fill=\"#fff\" opacity=\"0.67\"/><circle cx=\"60\" cy=\"30\" r=\"0.4\" fill=\"#fff\" opacity=\"0.35\"/><circle cx=\"110\" cy=\"49\" r=\"0.3\" fill=\"#fff\" opacity=\"0.41\"/><circle cx=\"217\" cy=\"92\" r=\"0.4\" fill=\"#fff\" opacity=\"0.21\"/><circle cx=\"179\" cy=\"130\" r=\"1.0\" fill=\"#fff\" opacity=\"0.34\"/><circle cx=\"45\" cy=\"117\" r=\"0.8\" fill=\"#fff\" opacity=\"0.73\"/><circle cx=\"30\" cy=\"132\" r=\"0.3\" fill=\"#fff\" opacity=\"0.72\"/><circle cx=\"409\" cy=\"17\" r=\"1.0\" fill=\"#fff\" opacity=\"0.69\"/><g stroke=\"#c7d2fe\" stroke-width=\".6\" opacity=\".6\" fill=\"none\"><path d=\"M110 150 L140 104 L180 128 L215 96 L250 140 L210 162\"/></g><circle cx=\"110\" cy=\"150\" r=\"2.2\" fill=\"#fff\"/><circle cx=\"140\" cy=\"104\" r=\"2.2\" fill=\"#fff\"/><circle cx=\"180\" cy=\"128\" r=\"2.2\" fill=\"#fff\"/><circle cx=\"215\" cy=\"96\" r=\"2.2\" fill=\"#fff\"/><circle cx=\"250\" cy=\"140\" r=\"2.2\" fill=\"#fff\"/><circle cx=\"210\" cy=\"162\" r=\"2.2\" fill=\"#fff\"/></svg>",
"ink": "#eef2ff",
"sub": "rgba(238,242,255,.6)",
"chip": [
"#c9ccd2",
"#f4f5f7"
],
"dark": true,
"glow": true
},
{
"id": "pour",
"name": "Polish pour",
"collection": "Beauty",
"note": "Glossy lacquer pouring in from the corner.",
"bg": "#fff",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><defs><linearGradient id=\"pl\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ff5c8a\"/><stop offset=\".5\" stop-color=\"#d1265a\"/><stop offset=\"1\" stop-color=\"#7a0f33\"/></linearGradient></defs><rect width=\"420\" height=\"265\" fill=\"#2b0f1e\"/><path d=\"M220 0 H420 V265 C 400 230, 390 180, 360 170 C 330 160, 320 200, 300 205 C 280 210, 270 170, 280 140 C 290 110, 250 100, 240 70 C 232 45, 210 30, 220 0 Z\" fill=\"url(#pl)\"/><path d=\"M300 30 C 330 20, 360 30, 380 60\" stroke=\"#fff\" stroke-width=\"4\" stroke-linecap=\"round\" opacity=\".45\" fill=\"none\"/><ellipse cx=\"300\" cy=\"205\" rx=\"10\" ry=\"6\" fill=\"#fff\" opacity=\".25\"/></svg>",
"ink": "#ffffff",
"sub": "rgba(255,255,255,.7)",
"chip": [
"#c9a256",
"#f6e3a8"
],
"dark": true,
"glow": true
},
{
"id": "silk",
"name": "Silk",
"collection": "Beauty",
"note": "Soft folds of champagne satin.",
"bg": "#fff",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><defs><linearGradient id=\"sk\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ead8c3\"/><stop offset=\".5\" stop-color=\"#d9bfa2\"/><stop offset=\"1\" stop-color=\"#efe1cf\"/></linearGradient><filter id=\"sb\" x=\"-20%\" y=\"-50%\" width=\"140%\" height=\"200%\"><feGaussianBlur stdDeviation=\"9\"/></filter></defs><rect width=\"420\" height=\"265\" fill=\"url(#sk)\"/><path d=\"M-20 60 C 120 20, 260 110, 440 50\" stroke=\"#fff\" stroke-width=\"26\" opacity=\"0.55\" fill=\"none\" filter=\"url(#sb)\"/><path d=\"M-20 120 C 120 80, 260 170, 440 110\" stroke=\"#fff\" stroke-width=\"18\" opacity=\"0.4\" fill=\"none\" filter=\"url(#sb)\"/><path d=\"M-20 180 C 120 140, 260 230, 440 170\" stroke=\"#fff\" stroke-width=\"30\" opacity=\"0.5\" fill=\"none\" filter=\"url(#sb)\"/><path d=\"M-20 240 C 120 200, 260 290, 440 230\" stroke=\"#fff\" stroke-width=\"20\" opacity=\"0.35\" fill=\"none\" filter=\"url(#sb)\"/></svg>",
"ink": "#2e2620",
"sub": "#8a7c6e",
"chip": [
"#c9a256",
"#f6e3a8"
],
"tileAccent": true,
"glow": true
},
{
"id": "lace",
"name": "Lace",
"collection": "Beauty",
"note": "Ivory with a fine scalloped lace edge.",
"bg": "#fff",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><defs></defs><rect width=\"420\" height=\"265\" fill=\"#fbf8f3\"/><g fill=\"none\" stroke=\"#cdbfb0\" stroke-width=\".9\"><circle cx=\"0\" cy=\"265\" r=\"16\"/><circle cx=\"0\" cy=\"265\" r=\"9\"/><circle cx=\"0\" cy=\"248\" r=\"2.2\" fill=\"#cdbfb0\"/><circle cx=\"32\" cy=\"265\" r=\"16\"/><circle cx=\"32\" cy=\"265\" r=\"9\"/><circle cx=\"32\" cy=\"248\" r=\"2.2\" fill=\"#cdbfb0\"/><circle cx=\"64\" cy=\"265\" r=\"16\"/><circle cx=\"64\" cy=\"265\" r=\"9\"/><circle cx=\"64\" cy=\"248\" r=\"2.2\" fill=\"#cdbfb0\"/><circle cx=\"96\" cy=\"265\" r=\"16\"/><circle cx=\"96\" cy=\"265\" r=\"9\"/><circle cx=\"96\" cy=\"248\" r=\"2.2\" fill=\"#cdbfb0\"/><circle cx=\"128\" cy=\"265\" r=\"16\"/><circle cx=\"128\" cy=\"265\" r=\"9\"/><circle cx=\"128\" cy=\"248\" r=\"2.2\" fill=\"#cdbfb0\"/><circle cx=\"160\" cy=\"265\" r=\"16\"/><circle cx=\"160\" cy=\"265\" r=\"9\"/><circle cx=\"160\" cy=\"248\" r=\"2.2\" fill=\"#cdbfb0\"/><circle cx=\"192\" cy=\"265\" r=\"16\"/><circle cx=\"192\" cy=\"265\" r=\"9\"/><circle cx=\"192\" cy=\"248\" r=\"2.2\" fill=\"#cdbfb0\"/><circle cx=\"224\" cy=\"265\" r=\"16\"/><circle cx=\"224\" cy=\"265\" r=\"9\"/><circle cx=\"224\" cy=\"248\" r=\"2.2\" fill=\"#cdbfb0\"/><circle cx=\"256\" cy=\"265\" r=\"16\"/><circle cx=\"256\" cy=\"265\" r=\"9\"/><circle cx=\"256\" cy=\"248\" r=\"2.2\" fill=\"#cdbfb0\"/><circle cx=\"288\" cy=\"265\" r=\"16\"/><circle cx=\"288\" cy=\"265\" r=\"9\"/><circle cx=\"288\" cy=\"248\" r=\"2.2\" fill=\"#cdbfb0\"/><circle cx=\"320\" cy=\"265\" r=\"16\"/><circle cx=\"320\" cy=\"265\" r=\"9\"/><circle cx=\"320\" cy=\"248\" r=\"2.2\" fill=\"#cdbfb0\"/><circle cx=\"352\" cy=\"265\" r=\"16\"/><circle cx=\"352\" cy=\"265\" r=\"9\"/><circle cx=\"352\" cy=\"248\" r=\"2.2\" fill=\"#cdbfb0\"/><circle cx=\"384\" cy=\"265\" r=\"16\"/><circle cx=\"384\" cy=\"265\" r=\"9\"/><circle cx=\"384\" cy=\"248\" r=\"2.2\" fill=\"#cdbfb0\"/><circle cx=\"416\" cy=\"265\" r=\"16\"/><circle cx=\"416\" cy=\"265\" r=\"9\"/><circle cx=\"416\" cy=\"248\" r=\"2.2\" fill=\"#cdbfb0\"/><circle cx=\"420\" cy=\"0\" r=\"16\"/><circle cx=\"420\" cy=\"0\" r=\"9\"/><circle cx=\"420\" cy=\"32\" r=\"16\"/><circle cx=\"420\" cy=\"32\" r=\"9\"/><circle cx=\"420\" cy=\"64\" r=\"16\"/><circle cx=\"420\" cy=\"64\" r=\"9\"/><circle cx=\"420\" cy=\"96\" r=\"16\"/><circle cx=\"420\" cy=\"96\" r=\"9\"/><circle cx=\"420\" cy=\"128\" r=\"16\"/><circle cx=\"420\" cy=\"128\" r=\"9\"/><circle cx=\"420\" cy=\"160\" r=\"16\"/><circle cx=\"420\" cy=\"160\" r=\"9\"/><circle cx=\"420\" cy=\"192\" r=\"16\"/><circle cx=\"420\" cy=\"192\" r=\"9\"/><circle cx=\"420\" cy=\"224\" r=\"16\"/><circle cx=\"420\" cy=\"224\" r=\"9\"/><circle cx=\"420\" cy=\"256\" r=\"16\"/><circle cx=\"420\" cy=\"256\" r=\"9\"/></g></svg>",
"ink": "#2a2522",
"sub": "#8a817a",
"chip": [
"#c9ccd2",
"#f4f5f7"
],
"tileAccent": true,
"glow": true
},
{
"id": "chrome",
"name": "Chrome",
"collection": "Beauty",
"note": "Mirror-polished, like a chrome nail.",
"bg": "#fff",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><defs><linearGradient id=\"ch\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f5f6f8\"/><stop offset=\".35\" stop-color=\"#b9bec7\"/><stop offset=\".5\" stop-color=\"#eef0f3\"/><stop offset=\".62\" stop-color=\"#8e949e\"/><stop offset=\".8\" stop-color=\"#dfe2e7\"/><stop offset=\"1\" stop-color=\"#a7adb6\"/></linearGradient><linearGradient id=\"ch2\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\".55\" stop-color=\"#fff\" stop-opacity=\"0\"/><stop offset=\".7\" stop-color=\"#fff\" stop-opacity=\".55\"/><stop offset=\".85\" stop-color=\"#fff\" stop-opacity=\"0\"/></linearGradient></defs><rect width=\"420\" height=\"265\" fill=\"url(#ch)\"/><rect width=\"420\" height=\"265\" fill=\"url(#ch2)\"/></svg>",
"ink": "#1a1a1c",
"sub": "rgba(26,26,28,.55)",
"chip": [
"#c9ccd2",
"#f4f5f7"
],
"tileAccent": true,
"glow": true
},
{
"id": "o-birthday",
"name": "Birthday",
"collection": "Occasions",
"note": "Year-round",
"bg": "linear-gradient(135deg,#fff4ec 0%,#fde7dc 100%)",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><circle cx=\"212.8\" cy=\"134.5\" r=\"2.21\" fill=\"#38bdf8\"/><circle cx=\"208.2\" cy=\"114.9\" r=\"2.73\" fill=\"#7c3aed\"/><circle cx=\"239.8\" cy=\"154.1\" r=\"1.34\" fill=\"#7c3aed\"/><circle cx=\"269.1\" cy=\"155.2\" r=\"2.67\" fill=\"#f59e0b\"/><circle cx=\"374.8\" cy=\"185.2\" r=\"2.43\" fill=\"#f59e0b\"/><circle cx=\"253.7\" cy=\"152.2\" r=\"3.45\" fill=\"#f59e0b\"/><circle cx=\"292.0\" cy=\"200.6\" r=\"1.37\" fill=\"#f59e0b\"/><circle cx=\"233.4\" cy=\"129.6\" r=\"2.06\" fill=\"#f59e0b\"/><circle cx=\"353.0\" cy=\"157.5\" r=\"3.29\" fill=\"#ef6f8a\"/><circle cx=\"304.3\" cy=\"176.0\" r=\"1.97\" fill=\"#1f7a4d\"/><circle cx=\"342.4\" cy=\"263.2\" r=\"3.47\" fill=\"#7c3aed\"/><circle cx=\"284.9\" cy=\"177.2\" r=\"3.67\" fill=\"#ef6f8a\"/><circle cx=\"205.0\" cy=\"122.3\" r=\"3.63\" fill=\"#38bdf8\"/><circle cx=\"217.7\" cy=\"119.0\" r=\"3.42\" fill=\"#38bdf8\"/><circle cx=\"261.3\" cy=\"110.1\" r=\"2.39\" fill=\"#38bdf8\"/><circle cx=\"251.3\" cy=\"128.5\" r=\"1.64\" fill=\"#f59e0b\"/><circle cx=\"329.6\" cy=\"69.6\" r=\"2.66\" fill=\"#7c3aed\"/><circle cx=\"200.9\" cy=\"111.0\" r=\"3.57\" fill=\"#f59e0b\"/><circle cx=\"409.7\" cy=\"183.0\" r=\"2.88\" fill=\"#f59e0b\"/><circle cx=\"313.4\" cy=\"163.7\" r=\"1.75\" fill=\"#1f7a4d\"/><circle cx=\"397.9\" cy=\"206.7\" r=\"2.91\" fill=\"#7c3aed\"/><circle cx=\"222.8\" cy=\"168.1\" r=\"2.75\" fill=\"#ef6f8a\"/><circle cx=\"222.3\" cy=\"96.4\" r=\"3.07\" fill=\"#38bdf8\"/><circle cx=\"255.5\" cy=\"92.1\" r=\"2.74\" fill=\"#7c3aed\"/><circle cx=\"386.8\" cy=\"263.2\" r=\"3.60\" fill=\"#7c3aed\"/><circle cx=\"275.4\" cy=\"70.2\" r=\"1.95\" fill=\"#ef6f8a\"/><circle cx=\"319.5\" cy=\"7.2\" r=\"1.41\" fill=\"#7c3aed\"/><circle cx=\"389.9\" cy=\"184.5\" r=\"2.62\" fill=\"#38bdf8\"/><circle cx=\"257.4\" cy=\"97.2\" r=\"1.37\" fill=\"#7c3aed\"/><circle cx=\"317.2\" cy=\"206.4\" r=\"2.45\" fill=\"#38bdf8\"/><circle cx=\"272.5\" cy=\"59.1\" r=\"3.83\" fill=\"#38bdf8\"/><circle cx=\"378.5\" cy=\"261.0\" r=\"2.63\" fill=\"#ef6f8a\"/><circle cx=\"380.0\" cy=\"196.1\" r=\"2.48\" fill=\"#38bdf8\"/><circle cx=\"249.9\" cy=\"137.2\" r=\"3.40\" fill=\"#38bdf8\"/><circle cx=\"278.2\" cy=\"7.7\" r=\"3.75\" fill=\"#38bdf8\"/><circle cx=\"406.1\" cy=\"261.8\" r=\"3.58\" fill=\"#ef6f8a\"/><circle cx=\"400.2\" cy=\"207.3\" r=\"3.70\" fill=\"#f59e0b\"/><circle cx=\"415.7\" cy=\"174.2\" r=\"3.48\" fill=\"#f59e0b\"/></svg>",
"ink": "#3a2418",
"sub": "#a06b55",
"chip": [
"#d4b06a",
"#f3e2b3"
],
"tileAccent": true,
"line": "HAPPY BIRTHDAY",
"lineColor": "#7c3aed",
"glow": true
},
{
"id": "o-holiday",
"name": "Holidays",
"collection": "Occasions",
"note": "Shown Nov 15 – Jan 5",
"bg": "linear-gradient(140deg,#16352b 0%,#0f241d 100%)",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><g transform=\"translate(175.0 104.0)\" stroke=\"#ffffff\" stroke-width=\"0.92\" stroke-linecap=\"round\" opacity=\"0.75\"><path d=\"M0 -5.745886969091341V5.745886969091341M-5.00 -2.87L5.00 2.87M-5.00 2.87L5.00 -2.87\"/></g><g transform=\"translate(270.3 97.0)\" stroke=\"#ffffff\" stroke-width=\"0.94\" stroke-linecap=\"round\" opacity=\"0.83\"><path d=\"M0 -5.84474458345459V5.84474458345459M-5.08 -2.92L5.08 2.92M-5.08 2.92L5.08 -2.92\"/></g><g transform=\"translate(417.5 107.0)\" stroke=\"#ffffff\" stroke-width=\"0.89\" stroke-linecap=\"round\" opacity=\"0.39\"><path d=\"M0 -5.571559197602889V5.571559197602889M-4.85 -2.79L4.85 2.79M-4.85 2.79L4.85 -2.79\"/></g><g transform=\"translate(176.9 94.5)\" stroke=\"#ffffff\" stroke-width=\"0.51\" stroke-linecap=\"round\" opacity=\"0.67\"><path d=\"M0 -3.167448405417597V3.167448405417597M-2.76 -1.58L2.76 1.58M-2.76 1.58L2.76 -1.58\"/></g><g transform=\"translate(142.0 121.5)\" stroke=\"#ffffff\" stroke-width=\"1.09\" stroke-linecap=\"round\" opacity=\"0.54\"><path d=\"M0 -6.838064286259307V6.838064286259307M-5.95 -3.42L5.95 3.42M-5.95 3.42L5.95 -3.42\"/></g><g transform=\"translate(385.8 60.6)\" stroke=\"#ffffff\" stroke-width=\"0.77\" stroke-linecap=\"round\" opacity=\"0.38\"><path d=\"M0 -4.805544720844246V4.805544720844246M-4.18 -2.40L4.18 2.40M-4.18 2.40L4.18 -2.40\"/></g><g transform=\"translate(170.5 142.2)\" stroke=\"#ffffff\" stroke-width=\"0.49\" stroke-linecap=\"round\" opacity=\"0.62\"><path d=\"M0 -3.075362701005532V3.075362701005532M-2.68 -1.54L2.68 1.54M-2.68 1.54L2.68 -1.54\"/></g><g transform=\"translate(216.2 131.1)\" stroke=\"#ffffff\" stroke-width=\"0.64\" stroke-linecap=\"round\" opacity=\"0.48\"><path d=\"M0 -3.97823871640248V3.97823871640248M-3.46 -1.99L3.46 1.99M-3.46 1.99L3.46 -1.99\"/></g><g transform=\"translate(335.8 48.6)\" stroke=\"#ffffff\" stroke-width=\"0.77\" stroke-linecap=\"round\" opacity=\"0.39\"><path d=\"M0 -4.827794098785446V4.827794098785446M-4.20 -2.41L4.20 2.41M-4.20 2.41L4.20 -2.41\"/></g><g transform=\"translate(7.1 23.5)\" stroke=\"#ffffff\" stroke-width=\"1.08\" stroke-linecap=\"round\" opacity=\"0.80\"><path d=\"M0 -6.730018600910039V6.730018600910039M-5.86 -3.37L5.86 3.37M-5.86 3.37L5.86 -3.37\"/></g><g transform=\"translate(109.4 161.2)\" stroke=\"#ffffff\" stroke-width=\"0.54\" stroke-linecap=\"round\" opacity=\"0.61\"><path d=\"M0 -3.3677677112608992V3.3677677112608992M-2.93 -1.68L2.93 1.68M-2.93 1.68L2.93 -1.68\"/></g><g transform=\"translate(51.1 3.1)\" stroke=\"#ffffff\" stroke-width=\"0.96\" stroke-linecap=\"round\" opacity=\"0.59\"><path d=\"M0 -5.9829116385218V5.9829116385218M-5.21 -2.99L5.21 2.99M-5.21 2.99L5.21 -2.99\"/></g><g transform=\"translate(417.6 110.7)\" stroke=\"#ffffff\" stroke-width=\"1.00\" stroke-linecap=\"round\" opacity=\"0.77\"><path d=\"M0 -6.236875119043886V6.236875119043886M-5.43 -3.12L5.43 3.12M-5.43 3.12L5.43 -3.12\"/></g><g transform=\"translate(384.5 164.8)\" stroke=\"#ffffff\" stroke-width=\"0.63\" stroke-linecap=\"round\" opacity=\"0.73\"><path d=\"M0 -3.939142487327308V3.939142487327308M-3.43 -1.97L3.43 1.97M-3.43 1.97L3.43 -1.97\"/></g><g transform=\"translate(391.5 166.6)\" stroke=\"#ffffff\" stroke-width=\"0.63\" stroke-linecap=\"round\" opacity=\"0.67\"><path d=\"M0 -3.922944508189815V3.922944508189815M-3.41 -1.96L3.41 1.96M-3.41 1.96L3.41 -1.96\"/></g><g transform=\"translate(417.7 9.8)\" stroke=\"#ffffff\" stroke-width=\"0.77\" stroke-linecap=\"round\" opacity=\"0.77\"><path d=\"M0 -4.841360255895518V4.841360255895518M-4.21 -2.42L4.21 2.42M-4.21 2.42L4.21 -2.42\"/></g><g transform=\"translate(7.7 134.0)\" stroke=\"#ffffff\" stroke-width=\"0.53\" stroke-linecap=\"round\" opacity=\"0.81\"><path d=\"M0 -3.306959494322841V3.306959494322841M-2.88 -1.65L2.88 1.65M-2.88 1.65L2.88 -1.65\"/></g><g transform=\"translate(103.2 118.5)\" stroke=\"#ffffff\" stroke-width=\"0.66\" stroke-linecap=\"round\" opacity=\"0.37\"><path d=\"M0 -4.1492766668489605V4.1492766668489605M-3.61 -2.07L3.61 2.07M-3.61 2.07L3.61 -2.07\"/></g><g transform=\"translate(275.7 144.7)\" stroke=\"#ffffff\" stroke-width=\"0.88\" stroke-linecap=\"round\" opacity=\"0.45\"><path d=\"M0 -5.531171370827048V5.531171370827048M-4.81 -2.77L4.81 2.77M-4.81 2.77L4.81 -2.77\"/></g><g transform=\"translate(370.4 193.1)\" stroke=\"#ffffff\" stroke-width=\"0.86\" stroke-linecap=\"round\" opacity=\"0.52\"><path d=\"M0 -5.398821090085061V5.398821090085061M-4.70 -2.70L4.70 2.70M-4.70 2.70L4.70 -2.70\"/></g><g transform=\"translate(58.7 262.2)\" stroke=\"#ffffff\" stroke-width=\"0.90\" stroke-linecap=\"round\" opacity=\"0.70\"><path d=\"M0 -5.606137446857012V5.606137446857012M-4.88 -2.80L4.88 2.80M-4.88 2.80L4.88 -2.80\"/></g><g transform=\"translate(6.0 165.7)\" stroke=\"#ffffff\" stroke-width=\"0.88\" stroke-linecap=\"round\" opacity=\"0.42\"><path d=\"M0 -5.484603004686883V5.484603004686883M-4.77 -2.74L4.77 2.74M-4.77 2.74L4.77 -2.74\"/></g><g transform=\"translate(160.0 134.1)\" stroke=\"#ffffff\" stroke-width=\"0.79\" stroke-linecap=\"round\" opacity=\"0.59\"><path d=\"M0 -4.929682793040902V4.929682793040902M-4.29 -2.46L4.29 2.46M-4.29 2.46L4.29 -2.46\"/></g><g transform=\"translate(407.8 158.7)\" stroke=\"#ffffff\" stroke-width=\"1.10\" stroke-linecap=\"round\" opacity=\"0.40\"><path d=\"M0 -6.890036036729859V6.890036036729859M-5.99 -3.45L5.99 3.45M-5.99 3.45L5.99 -3.45\"/></g><g transform=\"translate(290.9 12.0)\" stroke=\"#ffffff\" stroke-width=\"0.62\" stroke-linecap=\"round\" opacity=\"0.59\"><path d=\"M0 -3.8707738422068254V3.8707738422068254M-3.37 -1.94L3.37 1.94M-3.37 1.94L3.37 -1.94\"/></g><g transform=\"translate(1.5 96.5)\" stroke=\"#ffffff\" stroke-width=\"0.93\" stroke-linecap=\"round\" opacity=\"0.49\"><path d=\"M0 -5.835483685628644V5.835483685628644M-5.08 -2.92L5.08 2.92M-5.08 2.92L5.08 -2.92\"/></g><g transform=\"translate(138.1 261.0)\" stroke=\"#ffffff\" stroke-width=\"0.78\" stroke-linecap=\"round\" opacity=\"0.73\"><path d=\"M0 -4.863590433190439V4.863590433190439M-4.23 -2.43L4.23 2.43M-4.23 2.43L4.23 -2.43\"/></g><g transform=\"translate(370.6 57.7)\" stroke=\"#ffffff\" stroke-width=\"1.12\" stroke-linecap=\"round\" opacity=\"0.62\"><path d=\"M0 -6.973201629330603V6.973201629330603M-6.07 -3.49L6.07 3.49M-6.07 3.49L6.07 -3.49\"/></g><g transform=\"translate(275.5 65.8)\" stroke=\"#ffffff\" stroke-width=\"0.68\" stroke-linecap=\"round\" opacity=\"0.39\"><path d=\"M0 -4.2466986470856V4.2466986470856M-3.69 -2.12L3.69 2.12M-3.69 2.12L3.69 -2.12\"/></g><g transform=\"translate(246.5 104.4)\" stroke=\"#ffffff\" stroke-width=\"0.78\" stroke-linecap=\"round\" opacity=\"0.49\"><path d=\"M0 -4.891780674979223V4.891780674979223M-4.26 -2.45L4.26 2.45M-4.26 2.45L4.26 -2.45\"/></g><g transform=\"translate(125.9 166.9)\" stroke=\"#ffffff\" stroke-width=\"0.53\" stroke-linecap=\"round\" opacity=\"0.60\"><path d=\"M0 -3.305856967565348V3.305856967565348M-2.88 -1.65L2.88 1.65M-2.88 1.65L2.88 -1.65\"/></g><g transform=\"translate(375.0 207.8)\" stroke=\"#ffffff\" stroke-width=\"1.12\" stroke-linecap=\"round\" opacity=\"0.85\"><path d=\"M0 -6.978436632438033V6.978436632438033M-6.07 -3.49L6.07 3.49M-6.07 3.49L6.07 -3.49\"/></g><g transform=\"translate(119.4 164.0)\" stroke=\"#ffffff\" stroke-width=\"0.73\" stroke-linecap=\"round\" opacity=\"0.81\"><path d=\"M0 -4.547393387849247V4.547393387849247M-3.96 -2.27L3.96 2.27M-3.96 2.27L3.96 -2.27\"/></g><g transform=\"translate(341.4 4.3)\" stroke=\"#ffffff\" stroke-width=\"1.08\" stroke-linecap=\"round\" opacity=\"0.39\"><path d=\"M0 -6.7221442225786685V6.7221442225786685M-5.85 -3.36L5.85 3.36M-5.85 3.36L5.85 -3.36\"/></g></svg>",
"ink": "#f5f1e6",
"sub": "rgba(245,241,230,.65)",
"chip": [
"#d4b06a",
"#f3e2b3"
],
"dark": true,
"tileAccent": true,
"line": "HAPPY HOLIDAYS",
"lineColor": "#e9c46a",
"season": [
1115,
105
],
"glow": true
},
{
"id": "o-winter",
"name": "Winter sparkle",
"collection": "Occasions",
"note": "Shown Nov 15 – Jan 5",
"bg": "linear-gradient(140deg,#1e2a4a 0%,#2f3f6e 60%,#43578f 100%)",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><path transform=\"translate(110.0 95.3) scale(4.31)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.44\"/><path transform=\"translate(253.4 167.4) scale(2.18)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.44\"/><path transform=\"translate(153.4 131.9) scale(3.62)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.62\"/><path transform=\"translate(139.2 86.0) scale(2.67)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.97\"/><path transform=\"translate(142.1 105.5) scale(1.65)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.85\"/><path transform=\"translate(394.8 51.9) scale(3.91)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.95\"/><path transform=\"translate(4.9 196.1) scale(2.54)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.83\"/><path transform=\"translate(278.0 168.3) scale(3.58)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.88\"/><path transform=\"translate(324.7 208.1) scale(4.81)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.44\"/><path transform=\"translate(179.7 7.7) scale(4.39)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.46\"/><path transform=\"translate(310.3 173.0) scale(4.00)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.68\"/><path transform=\"translate(50.3 170.4) scale(4.22)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.87\"/><path transform=\"translate(190.3 88.2) scale(4.70)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.89\"/><path transform=\"translate(73.4 147.3) scale(1.96)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.70\"/><path transform=\"translate(134.1 97.6) scale(1.53)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.96\"/><path transform=\"translate(339.9 53.6) scale(2.56)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.82\"/><path transform=\"translate(8.4 230.7) scale(2.03)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.54\"/><path transform=\"translate(241.2 95.4) scale(4.51)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.68\"/><path transform=\"translate(161.5 171.1) scale(4.24)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.76\"/><path transform=\"translate(196.6 119.0) scale(3.29)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.64\"/><path transform=\"translate(328.9 59.3) scale(2.06)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.64\"/><path transform=\"translate(326.3 0.4) scale(3.77)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.69\"/><path transform=\"translate(52.8 150.9) scale(3.41)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.50\"/><path transform=\"translate(404.2 166.0) scale(2.99)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.46\"/><path transform=\"translate(221.9 115.9) scale(1.75)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.77\"/><path transform=\"translate(332.0 0.3) scale(2.23)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.65\"/><path transform=\"translate(225.7 264.0) scale(4.96)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.98\"/><path transform=\"translate(352.6 64.2) scale(2.11)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.48\"/><path transform=\"translate(221.0 145.0) scale(3.11)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.93\"/><path transform=\"translate(95.7 112.4) scale(2.32)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.72\"/><path transform=\"translate(155.5 130.6) scale(4.21)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.86\"/><path transform=\"translate(292.2 190.4) scale(4.23)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.58\"/><path transform=\"translate(152.2 105.0) scale(2.48)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.56\"/><path transform=\"translate(2.8 77.4) scale(2.39)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.56\"/><path transform=\"translate(321.7 51.4) scale(3.04)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.51\"/><path transform=\"translate(261.9 161.7) scale(2.32)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.57\"/><path transform=\"translate(22.8 6.3) scale(4.68)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.51\"/><path transform=\"translate(250.4 110.1) scale(1.73)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.55\"/><path transform=\"translate(298.1 48.8) scale(2.36)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.72\"/><path transform=\"translate(220.4 123.9) scale(3.77)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.46\"/><path transform=\"translate(352.4 261.0) scale(3.12)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.42\"/><path transform=\"translate(82.2 143.5) scale(1.52)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.93\"/><path transform=\"translate(187.5 85.7) scale(2.31)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.67\"/><path transform=\"translate(265.3 65.7) scale(2.81)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.93\"/><path transform=\"translate(262.7 107.3) scale(2.32)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.43\"/><path transform=\"translate(157.7 123.0) scale(3.60)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#ffffff\" opacity=\"0.90\"/></svg>",
"ink": "#ffffff",
"sub": "rgba(255,255,255,.65)",
"chip": [
"#d4b06a",
"#f3e2b3"
],
"dark": true,
"tileAccent": true,
"line": "SEASON’S GREETINGS",
"lineColor": "#cfe0ff",
"season": [
1115,
105
],
"glow": true
},
{
"id": "o-valentine",
"name": "Valentine’s Day",
"collection": "Occasions",
"note": "Shown Jan 20 – Feb 14",
"bg": "linear-gradient(135deg,#fde4ea 0%,#f8c9d4 100%)",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><path transform=\"translate(340.6 205.4) scale(2.54)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#fb7185\" opacity=\"0.60\"/><path transform=\"translate(353.0 1.7) scale(2.40)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#be123c\" opacity=\"0.93\"/><path transform=\"translate(347.5 188.1) scale(2.76)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#be123c\" opacity=\"0.74\"/><path transform=\"translate(289.9 9.9) scale(2.37)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#fb7185\" opacity=\"0.73\"/><path transform=\"translate(288.0 11.7) scale(1.93)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#be123c\" opacity=\"0.75\"/><path transform=\"translate(420.0 10.1) scale(1.25)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#be123c\" opacity=\"0.99\"/><path transform=\"translate(226.3 131.3) scale(2.13)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#fb7185\" opacity=\"0.89\"/><path transform=\"translate(379.2 176.0) scale(2.76)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#fb7185\" opacity=\"0.93\"/><path transform=\"translate(250.9 141.5) scale(2.82)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#fb7185\" opacity=\"0.60\"/><path transform=\"translate(274.2 261.9) scale(1.46)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#fb7185\" opacity=\"0.71\"/><path transform=\"translate(380.4 170.8) scale(2.80)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#be123c\" opacity=\"0.78\"/><path transform=\"translate(238.1 153.1) scale(1.28)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#be123c\" opacity=\"0.61\"/><path transform=\"translate(292.9 204.9) scale(3.04)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#fb7185\" opacity=\"0.90\"/><path transform=\"translate(405.4 195.4) scale(2.22)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#e11d48\" opacity=\"0.89\"/><path transform=\"translate(254.3 92.2) scale(2.99)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#be123c\" opacity=\"0.98\"/><path transform=\"translate(233.4 101.7) scale(1.47)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#e11d48\" opacity=\"1.00\"/><path transform=\"translate(370.7 209.9) scale(2.66)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#e11d48\" opacity=\"0.64\"/><path transform=\"translate(341.5 168.6) scale(3.16)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#fb7185\" opacity=\"0.68\"/><path transform=\"translate(344.2 162.9) scale(2.82)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#e11d48\" opacity=\"0.86\"/><path transform=\"translate(259.2 125.3) scale(2.64)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#e11d48\" opacity=\"0.58\"/><path transform=\"translate(291.8 39.6) scale(1.90)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#fb7185\" opacity=\"0.62\"/><path transform=\"translate(388.5 178.1) scale(2.99)\" d=\"M0 1.6C-3.2-1-4-3.4-2.4-4.4-1.3-5 0-4.2 0-3.2 0-4.2 1.3-5 2.4-4.4 4-3.4 3.2-1 0 1.6Z\" fill=\"#fb7185\" opacity=\"0.96\"/></svg>",
"ink": "#4a1626",
"sub": "#a3516a",
"chip": [
"#d4b06a",
"#f3e2b3"
],
"tileAccent": true,
"line": "BE MINE",
"lineColor": "#be123c",
"season": [
120,
214
],
"glow": true
},
{
"id": "o-mother",
"name": "Mother’s Day",
"collection": "Occasions",
"note": "Shown Apr 15 – May 12",
"bg": "linear-gradient(135deg,#f6efe6 0%,#efe2d3 100%)",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><ellipse cx=\"330\" cy=\"176\" rx=\"6\" ry=\"13\" fill=\"#9cb79a\" opacity=\"0.50\" transform=\"rotate(-30 330 176)\"/><ellipse cx=\"360\" cy=\"166\" rx=\"6\" ry=\"13\" fill=\"#9cb79a\" opacity=\"0.60\" transform=\"rotate(20 360 166)\"/><ellipse cx=\"390\" cy=\"184\" rx=\"6\" ry=\"13\" fill=\"#9cb79a\" opacity=\"0.70\" transform=\"rotate(-60 390 184)\"/><ellipse cx=\"306\" cy=\"192\" rx=\"6\" ry=\"13\" fill=\"#9cb79a\" opacity=\"0.80\" transform=\"rotate(40 306 192)\"/><ellipse cx=\"378\" cy=\"200\" rx=\"6\" ry=\"13\" fill=\"#9cb79a\" opacity=\"0.90\" transform=\"rotate(10 378 200)\"/><ellipse cx=\"334\" cy=\"166\" rx=\"6.60\" ry=\"12.00\" fill=\"#f2a7b8\" transform=\"rotate(0.0 334 178)\"/><ellipse cx=\"334\" cy=\"166\" rx=\"6.60\" ry=\"12.00\" fill=\"#f2a7b8\" transform=\"rotate(72.0 334 178)\"/><ellipse cx=\"334\" cy=\"166\" rx=\"6.60\" ry=\"12.00\" fill=\"#f2a7b8\" transform=\"rotate(144.0 334 178)\"/><ellipse cx=\"334\" cy=\"166\" rx=\"6.60\" ry=\"12.00\" fill=\"#f2a7b8\" transform=\"rotate(216.0 334 178)\"/><ellipse cx=\"334\" cy=\"166\" rx=\"6.60\" ry=\"12.00\" fill=\"#f2a7b8\" transform=\"rotate(288.0 334 178)\"/><circle cx=\"334\" cy=\"178\" r=\"5.04\" fill=\"#f6c453\"/><ellipse cx=\"374\" cy=\"181\" rx=\"4.95\" ry=\"9.00\" fill=\"#c9b6f2\" transform=\"rotate(20.0 374 190)\"/><ellipse cx=\"374\" cy=\"181\" rx=\"4.95\" ry=\"9.00\" fill=\"#c9b6f2\" transform=\"rotate(80.0 374 190)\"/><ellipse cx=\"374\" cy=\"181\" rx=\"4.95\" ry=\"9.00\" fill=\"#c9b6f2\" transform=\"rotate(140.0 374 190)\"/><ellipse cx=\"374\" cy=\"181\" rx=\"4.95\" ry=\"9.00\" fill=\"#c9b6f2\" transform=\"rotate(200.0 374 190)\"/><ellipse cx=\"374\" cy=\"181\" rx=\"4.95\" ry=\"9.00\" fill=\"#c9b6f2\" transform=\"rotate(260.0 374 190)\"/><ellipse cx=\"374\" cy=\"181\" rx=\"4.95\" ry=\"9.00\" fill=\"#c9b6f2\" transform=\"rotate(320.0 374 190)\"/><circle cx=\"374\" cy=\"190\" r=\"3.78\" fill=\"#f6c453\"/><ellipse cx=\"302\" cy=\"189\" rx=\"3.85\" ry=\"7.00\" fill=\"#f2a7b8\" transform=\"rotate(40.0 302 196)\"/><ellipse cx=\"302\" cy=\"189\" rx=\"3.85\" ry=\"7.00\" fill=\"#f2a7b8\" transform=\"rotate(112.0 302 196)\"/><ellipse cx=\"302\" cy=\"189\" rx=\"3.85\" ry=\"7.00\" fill=\"#f2a7b8\" transform=\"rotate(184.0 302 196)\"/><ellipse cx=\"302\" cy=\"189\" rx=\"3.85\" ry=\"7.00\" fill=\"#f2a7b8\" transform=\"rotate(256.0 302 196)\"/><ellipse cx=\"302\" cy=\"189\" rx=\"3.85\" ry=\"7.00\" fill=\"#f2a7b8\" transform=\"rotate(328.0 302 196)\"/><circle cx=\"302\" cy=\"196\" r=\"2.94\" fill=\"#f6c453\"/></svg>",
"ink": "#3a2a22",
"sub": "#8a7465",
"chip": [
"#d4b06a",
"#f3e2b3"
],
"tileAccent": true,
"line": "FOR MOM",
"lineColor": "#b5536e",
"season": [
415,
512
],
"glow": true
},
{
"id": "o-thanks",
"name": "Thank you",
"collection": "Occasions",
"note": "Year-round",
"bg": "linear-gradient(135deg,#eef4ef 0%,#dfeadf 100%)",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><ellipse cx=\"330\" cy=\"176\" rx=\"6\" ry=\"13\" fill=\"#7fa886\" opacity=\"0.50\" transform=\"rotate(-30 330 176)\"/><ellipse cx=\"360\" cy=\"166\" rx=\"6\" ry=\"13\" fill=\"#7fa886\" opacity=\"0.60\" transform=\"rotate(20 360 166)\"/><ellipse cx=\"390\" cy=\"184\" rx=\"6\" ry=\"13\" fill=\"#7fa886\" opacity=\"0.70\" transform=\"rotate(-60 390 184)\"/><ellipse cx=\"306\" cy=\"192\" rx=\"6\" ry=\"13\" fill=\"#7fa886\" opacity=\"0.80\" transform=\"rotate(40 306 192)\"/><ellipse cx=\"378\" cy=\"200\" rx=\"6\" ry=\"13\" fill=\"#7fa886\" opacity=\"0.90\" transform=\"rotate(10 378 200)\"/></svg>",
"ink": "#1f3324",
"sub": "#5d7a63",
"chip": [
"#d4b06a",
"#f3e2b3"
],
"tileAccent": true,
"line": "THANK YOU",
"lineColor": "#1f7a4d",
"glow": true
},
{
"id": "o-congrats",
"name": "Congratulations",
"collection": "Occasions",
"note": "Year-round",
"bg": "linear-gradient(135deg,#16171a 0%,#2a2b30 100%)",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><path transform=\"translate(311.3 67.4) scale(3.75)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.47\"/><path transform=\"translate(338.4 163.2) scale(4.62)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.96\"/><path transform=\"translate(267.5 98.7) scale(4.80)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.56\"/><path transform=\"translate(259.8 106.9) scale(1.68)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.78\"/><path transform=\"translate(270.4 142.0) scale(3.88)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.81\"/><path transform=\"translate(391.3 195.5) scale(4.71)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.98\"/><path transform=\"translate(286.2 21.6) scale(2.53)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.96\"/><path transform=\"translate(266.0 163.1) scale(4.63)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.45\"/><path transform=\"translate(366.6 198.0) scale(3.28)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.50\"/><path transform=\"translate(264.3 77.1) scale(4.67)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.91\"/><path transform=\"translate(317.7 162.3) scale(2.21)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.50\"/><path transform=\"translate(246.7 97.1) scale(4.70)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.52\"/><path transform=\"translate(398.5 157.6) scale(2.86)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.76\"/><path transform=\"translate(335.7 159.5) scale(2.83)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.91\"/><path transform=\"translate(253.0 0.1) scale(4.73)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.99\"/><path transform=\"translate(232.3 6.7) scale(4.45)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.72\"/><path transform=\"translate(342.5 174.1) scale(3.15)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.72\"/><path transform=\"translate(259.5 109.5) scale(1.52)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.42\"/><path transform=\"translate(323.7 170.3) scale(4.84)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.54\"/><path transform=\"translate(232.8 165.9) scale(4.60)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.87\"/><path transform=\"translate(418.8 191.9) scale(2.87)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.75\"/><path transform=\"translate(419.3 69.3) scale(3.48)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.50\"/><circle cx=\"415.0\" cy=\"185.7\" r=\"1.92\" fill=\"#d4b06a\"/><circle cx=\"388.4\" cy=\"201.9\" r=\"2.02\" fill=\"#f3e2b3\"/><circle cx=\"317.5\" cy=\"176.0\" r=\"1.19\" fill=\"#f3e2b3\"/><circle cx=\"393.5\" cy=\"200.3\" r=\"2.43\" fill=\"#d4b06a\"/><circle cx=\"400.4\" cy=\"199.7\" r=\"1.70\" fill=\"#d4b06a\"/><circle cx=\"274.0\" cy=\"69.2\" r=\"1.62\" fill=\"#f3e2b3\"/><circle cx=\"400.3\" cy=\"203.8\" r=\"1.45\" fill=\"#d4b06a\"/><circle cx=\"324.5\" cy=\"189.3\" r=\"1.63\" fill=\"#d4b06a\"/><circle cx=\"263.2\" cy=\"115.6\" r=\"2.51\" fill=\"#d4b06a\"/><circle cx=\"412.8\" cy=\"157.0\" r=\"1.87\" fill=\"#d4b06a\"/><circle cx=\"406.5\" cy=\"203.2\" r=\"1.58\" fill=\"#f3e2b3\"/><circle cx=\"307.9\" cy=\"262.6\" r=\"1.85\" fill=\"#f3e2b3\"/></svg>",
"ink": "#ffffff",
"sub": "rgba(255,255,255,.62)",
"chip": [
"#d4b06a",
"#f3e2b3"
],
"dark": true,
"tileAccent": true,
"line": "CONGRATULATIONS",
"lineColor": "#d4b06a",
"glow": true
},
{
"id": "o-wedding",
"name": "Wedding & anniversary",
"collection": "Occasions",
"note": "Year-round",
"bg": "linear-gradient(135deg,#fbf8f3 0%,#f1ebe1 100%)",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><g fill=\"none\" stroke-width=\"2.4\"><circle cx=\"330\" cy=\"176\" r=\"22\" stroke=\"#d4b06a\"/><circle cx=\"356\" cy=\"176\" r=\"22\" stroke=\"#e8d3a3\"/></g><path transform=\"translate(376.1 198.2) scale(2.37)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.60\"/><path transform=\"translate(312.0 178.5) scale(3.33)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.50\"/><path transform=\"translate(390.5 187.6) scale(2.65)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.51\"/><path transform=\"translate(306.4 180.0) scale(4.91)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.84\"/><path transform=\"translate(405.1 165.5) scale(1.86)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.98\"/><path transform=\"translate(314.9 169.6) scale(1.86)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.63\"/><path transform=\"translate(381.4 204.8) scale(4.94)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.88\"/><path transform=\"translate(310.1 160.1) scale(4.07)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#d4b06a\" opacity=\"0.66\"/></svg>",
"ink": "#2e2a24",
"sub": "#8b8174",
"chip": [
"#d4b06a",
"#f3e2b3"
],
"tileAccent": true,
"line": "WITH LOVE",
"lineColor": "#b08a4a",
"glow": true
},
{
"id": "o-selfcare",
"name": "Self-care",
"collection": "Occasions",
"note": "Year-round",
"bg": "linear-gradient(135deg,#eaf3f6 0%,#dcebf1 100%)",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><path d=\"M0 196 C70 176 120 214 200 200 S330 172 420 192 V265 H0Z\" fill=\"#bcd9e3\" opacity=\".45\"/><path d=\"M0 222 C90 206 150 236 240 224 S360 206 420 216 V265 H0Z\" fill=\"#bcd9e3\" opacity=\".75\"/></svg>",
"ink": "#16323b",
"sub": "#5c7f8a",
"chip": [
"#d4b06a",
"#f3e2b3"
],
"tileAccent": true,
"line": "TREAT YOURSELF",
"lineColor": "#2b7a8c",
"glow": true
},
{
"id": "o-newyear",
"name": "New Year",
"collection": "Occasions",
"note": "Shown Dec 26 – Jan 15",
"bg": "linear-gradient(135deg,#0f1020 0%,#1d1b3a 100%)",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><g transform=\"translate(330 178)\" stroke=\"#f6c453\" stroke-width=\"1.4\" stroke-linecap=\"round\"><line x1=\"0\" y1=\"0\" x2=\"14.00\" y2=\"0.00\"/><line x1=\"0\" y1=\"0\" x2=\"12.12\" y2=\"7.00\"/><line x1=\"0\" y1=\"0\" x2=\"7.00\" y2=\"12.12\"/><line x1=\"0\" y1=\"0\" x2=\"0.00\" y2=\"14.00\"/><line x1=\"0\" y1=\"0\" x2=\"-7.00\" y2=\"12.12\"/><line x1=\"0\" y1=\"0\" x2=\"-12.12\" y2=\"7.00\"/><line x1=\"0\" y1=\"0\" x2=\"-14.00\" y2=\"0.00\"/><line x1=\"0\" y1=\"0\" x2=\"-12.12\" y2=\"-7.00\"/><line x1=\"0\" y1=\"0\" x2=\"-7.00\" y2=\"-12.12\"/><line x1=\"0\" y1=\"0\" x2=\"-0.00\" y2=\"-14.00\"/><line x1=\"0\" y1=\"0\" x2=\"7.00\" y2=\"-12.12\"/><line x1=\"0\" y1=\"0\" x2=\"12.12\" y2=\"-7.00\"/></g><g transform=\"translate(378 196)\" stroke=\"#f472b6\" stroke-width=\"1.4\" stroke-linecap=\"round\"><line x1=\"0\" y1=\"0\" x2=\"14.00\" y2=\"0.00\"/><line x1=\"0\" y1=\"0\" x2=\"12.12\" y2=\"7.00\"/><line x1=\"0\" y1=\"0\" x2=\"7.00\" y2=\"12.12\"/><line x1=\"0\" y1=\"0\" x2=\"0.00\" y2=\"14.00\"/><line x1=\"0\" y1=\"0\" x2=\"-7.00\" y2=\"12.12\"/><line x1=\"0\" y1=\"0\" x2=\"-12.12\" y2=\"7.00\"/><line x1=\"0\" y1=\"0\" x2=\"-14.00\" y2=\"0.00\"/><line x1=\"0\" y1=\"0\" x2=\"-12.12\" y2=\"-7.00\"/><line x1=\"0\" y1=\"0\" x2=\"-7.00\" y2=\"-12.12\"/><line x1=\"0\" y1=\"0\" x2=\"-0.00\" y2=\"-14.00\"/><line x1=\"0\" y1=\"0\" x2=\"7.00\" y2=\"-12.12\"/><line x1=\"0\" y1=\"0\" x2=\"12.12\" y2=\"-7.00\"/></g><g transform=\"translate(300 196)\" stroke=\"#93c5fd\" stroke-width=\"1.4\" stroke-linecap=\"round\"><line x1=\"0\" y1=\"0\" x2=\"14.00\" y2=\"0.00\"/><line x1=\"0\" y1=\"0\" x2=\"12.12\" y2=\"7.00\"/><line x1=\"0\" y1=\"0\" x2=\"7.00\" y2=\"12.12\"/><line x1=\"0\" y1=\"0\" x2=\"0.00\" y2=\"14.00\"/><line x1=\"0\" y1=\"0\" x2=\"-7.00\" y2=\"12.12\"/><line x1=\"0\" y1=\"0\" x2=\"-12.12\" y2=\"7.00\"/><line x1=\"0\" y1=\"0\" x2=\"-14.00\" y2=\"0.00\"/><line x1=\"0\" y1=\"0\" x2=\"-12.12\" y2=\"-7.00\"/><line x1=\"0\" y1=\"0\" x2=\"-7.00\" y2=\"-12.12\"/><line x1=\"0\" y1=\"0\" x2=\"-0.00\" y2=\"-14.00\"/><line x1=\"0\" y1=\"0\" x2=\"7.00\" y2=\"-12.12\"/><line x1=\"0\" y1=\"0\" x2=\"12.12\" y2=\"-7.00\"/></g></svg>",
"ink": "#ffffff",
"sub": "rgba(255,255,255,.62)",
"chip": [
"#d4b06a",
"#f3e2b3"
],
"dark": true,
"tileAccent": true,
"line": "HELLO NEW YEAR",
"lineColor": "#f6c453",
"season": [
1226,
115
],
"glow": true
},
{
"id": "o-teacher",
"name": "Teacher appreciation",
"collection": "Occasions",
"note": "Shown May 1 – Jun 15",
"bg": "linear-gradient(135deg,#fff8e6 0%,#fdeec4 100%)",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><path transform=\"translate(259.2 169.1) scale(3.39)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#e0a100\" opacity=\"0.83\"/><path transform=\"translate(299.8 209.6) scale(3.29)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#e0a100\" opacity=\"0.78\"/><path transform=\"translate(248.4 160.0) scale(4.40)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#e0a100\" opacity=\"0.71\"/><path transform=\"translate(300.9 196.4) scale(2.94)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#e0a100\" opacity=\"0.97\"/><path transform=\"translate(334.8 198.5) scale(2.24)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#e0a100\" opacity=\"0.81\"/><path transform=\"translate(304.2 60.6) scale(2.87)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#e0a100\" opacity=\"0.86\"/><path transform=\"translate(374.8 185.5) scale(1.93)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#e0a100\" opacity=\"0.99\"/><path transform=\"translate(390.5 180.1) scale(2.74)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#e0a100\" opacity=\"0.43\"/><path transform=\"translate(282.6 166.5) scale(2.46)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#e0a100\" opacity=\"0.64\"/><path transform=\"translate(239.6 111.2) scale(1.55)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#e0a100\" opacity=\"0.65\"/><path transform=\"translate(376.5 189.0) scale(2.97)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#e0a100\" opacity=\"0.82\"/><path transform=\"translate(345.9 66.3) scale(2.73)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#e0a100\" opacity=\"0.56\"/><path transform=\"translate(227.6 144.0) scale(2.29)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#e0a100\" opacity=\"0.84\"/><path transform=\"translate(240.2 152.3) scale(4.79)\" d=\"M0-1.6L.4-.4 1.6 0 .4.4 0 1.6-.4.4-1.6 0-.4-.4Z\" fill=\"#e0a100\" opacity=\"0.72\"/></svg>",
"ink": "#3b2f12",
"sub": "#8a7440",
"chip": [
"#d4b06a",
"#f3e2b3"
],
"tileAccent": true,
"line": "THANK YOU, TEACHER",
"lineColor": "#c2410c",
"season": [
501,
615
],
"glow": true
},
{
"id": "o-fall",
"name": "Fall",
"collection": "Occasions",
"note": "Shown Sep 15 – Nov 25",
"bg": "linear-gradient(135deg,#fbefe3 0%,#f3dcc4 100%)",
"sheen": "",
"svg": "<svg viewBox=\"0 0 420 265\" preserveAspectRatio=\"xMidYMid slice\" style=\"position:absolute; inset:0; width:100%; height:100%\"><ellipse cx=\"330\" cy=\"176\" rx=\"6\" ry=\"13\" fill=\"#d97706\" opacity=\"0.50\" transform=\"rotate(-30 330 176)\"/><ellipse cx=\"360\" cy=\"166\" rx=\"6\" ry=\"13\" fill=\"#d97706\" opacity=\"0.60\" transform=\"rotate(20 360 166)\"/><ellipse cx=\"390\" cy=\"184\" rx=\"6\" ry=\"13\" fill=\"#d97706\" opacity=\"0.70\" transform=\"rotate(-60 390 184)\"/><ellipse cx=\"306\" cy=\"192\" rx=\"6\" ry=\"13\" fill=\"#d97706\" opacity=\"0.80\" transform=\"rotate(40 306 192)\"/><ellipse cx=\"378\" cy=\"200\" rx=\"6\" ry=\"13\" fill=\"#d97706\" opacity=\"0.90\" transform=\"rotate(10 378 200)\"/><ellipse cx=\"300\" cy=\"170\" rx=\"6\" ry=\"13\" fill=\"#b45309\" opacity=\"0.50\" transform=\"rotate(60 300 170)\"/><ellipse cx=\"346\" cy=\"198\" rx=\"6\" ry=\"13\" fill=\"#b45309\" opacity=\"0.60\" transform=\"rotate(-20 346 198)\"/><ellipse cx=\"396\" cy=\"170\" rx=\"6\" ry=\"13\" fill=\"#b45309\" opacity=\"0.70\" transform=\"rotate(30 396 170)\"/></svg>",
"ink": "#3d2614",
"sub": "#8a6a50",
"chip": [
"#d4b06a",
"#f3e2b3"
],
"tileAccent": true,
"line": "HELLO FALL",
"lineColor": "#b45309",
"season": [
915,
1125
],
"glow": true
}
];
