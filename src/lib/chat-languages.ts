// The languages team chat can translate into. A person picks theirs once; messages in another language show translated.
export const CHAT_LANGUAGES: { code: string; name: string }[] = [
  { code: 'en', name: 'English' }, { code: 'es', name: 'Español' }, { code: 'vi', name: 'Tiếng Việt' }, { code: 'zh', name: '中文' },
  { code: 'ko', name: '한국어' }, { code: 'pt', name: 'Português' }, { code: 'fr', name: 'Français' }, { code: 'ru', name: 'Русский' },
  { code: 'ar', name: 'العربية' }, { code: 'tl', name: 'Tagalog' }, { code: 'ht', name: 'Kreyòl ayisyen' }, { code: 'hi', name: 'हिन्दी' },
];
export const CHAT_LANGUAGE_EN: Record<string, string> = { en: 'English', es: 'Spanish', vi: 'Vietnamese', zh: 'Chinese (Simplified)', ko: 'Korean', pt: 'Portuguese', fr: 'French', ru: 'Russian', ar: 'Arabic', tl: 'Tagalog', ht: 'Haitian Creole', hi: 'Hindi' };
export const okLanguage = (c: any) => (typeof c === 'string' && c in CHAT_LANGUAGE_EN ? c : null);
