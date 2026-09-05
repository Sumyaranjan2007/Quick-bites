import React, { createContext, useContext, useState } from 'react';
import { translate, SupportedLanguage } from './translate';
export * from './translate';

const STORAGE_KEY = 'qb_lang';

interface I18nContextValue {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export interface I18nProviderProps {
  children: React.ReactNode;
  defaultLanguage?: SupportedLanguage;
}

export function I18nProvider({ children, defaultLanguage = 'en' }: I18nProviderProps) {
  const [language, setLanguageState] = useState<SupportedLanguage>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(STORAGE_KEY) as SupportedLanguage | null;
      if (stored && (stored === 'en' || stored === 'hi' || stored === 'kn')) {
        return stored;
      }
    }
    return defaultLanguage;
  });

  const setLanguage = (lang: SupportedLanguage) => {
    setLanguageState(lang);
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, lang);
    }
  };

  const t = (key: string, params?: Record<string, string | number>) => {
    return translate(language, key, params);
  };

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    // Standalone fallback if outside provider
    return {
      language: 'en' as SupportedLanguage,
      setLanguage: () => {},
      t: (key: string, params?: Record<string, string | number>) => translate('en', key, params)
    };
  }
  return context;
}
