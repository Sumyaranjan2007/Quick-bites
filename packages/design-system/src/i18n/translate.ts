import en from './locales/en.json' with { type: 'json' };
import hi from './locales/hi.json' with { type: 'json' };
import kn from './locales/kn.json' with { type: 'json' };

export type SupportedLanguage = 'en' | 'hi' | 'kn';

export interface LanguageOption {
  code: SupportedLanguage;
  label: string;
  nativeLabel: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
  { code: 'kn', label: 'Kannada', nativeLabel: 'ಕನ್ನಡ' }
];

export const translations: Record<SupportedLanguage, any> = {
  en,
  hi,
  kn
};

export function getNestedTranslation(obj: any, path: string): string {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return path; // Fallback to key
    }
  }
  return typeof current === 'string' ? current : path;
}

export function translate(
  lang: SupportedLanguage,
  key: string,
  params?: Record<string, string | number>
): string {
  const localeData = translations[lang] || translations.en;
  let text = getNestedTranslation(localeData, key);

  if (text === key && lang !== 'en') {
    // Fallback to English
    text = getNestedTranslation(translations.en, key);
  }

  if (params) {
    for (const [paramKey, paramVal] of Object.entries(params)) {
      text = text.replace(new RegExp(`{{${paramKey}}}`, 'g'), String(paramVal));
    }
  }

  return text;
}
