// src/lib/json-ld.ts — structured data for search engines, safe to put inside a <script> tag: business-entered text
// can't close the tag or start markup, because <, > and & are written as JSON escapes.
export const jsonLd = (data: unknown): string => JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
