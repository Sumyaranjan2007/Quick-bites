import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Interface language for the customer app.
 *
 * The picker used to set a value that nothing read, so choosing Hindi or Kannada
 * changed a highlighted chip and nothing else. Strings live here and every
 * screen reads them through `t()`, so a change actually moves the interface.
 *
 * Kannada is first among the translations for a reason: the service area is
 * Harohalli, on Kanakapura Road in Karnataka, where it is the state language.
 */
export type Language = 'en' | 'hi' | 'kn';

export const LANGUAGES: { code: Language; label: string; native: string }[] = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' }
];

type Dict = Record<string, string>;

const en: Dict = {
  'nav.delivery': 'Delivery',
  'nav.cart': 'Cart',
  'nav.profile': 'Profile',

  'feed.deliveringTo': 'Delivering to you',
  'feed.heroLine1': "WHAT'S YOUR",
  'feed.heroLine2': 'CRAVING?',
  'feed.heroSub': "We've got it.",
  'feed.searchPlaceholder': "Search for 'Biryani'",
  'feed.popular': 'Popular Restaurants',
  'feed.filter.all': 'All',
  'feed.filter.offers': 'Offers',
  'feed.filter.pureVeg': 'Pure Veg',
  'feed.filter.fastDelivery': 'Fast Delivery',
  'feed.filter.topRated': 'Top Rated',

  'profile.title': 'Profile',
  'profile.editProfile': 'Edit profile',
  'profile.editProfileSub': 'Name, phone and language',
  'profile.orders': 'Order history',
  'profile.ordersSub': 'Your past and current orders',
  'profile.addresses': 'Saved addresses',
  'profile.wallet': 'Quick Bites wallet',
  'profile.support': 'Help & support',
  'profile.supportSub': 'Talk to customer care',
  'profile.language': 'App language',
  'profile.notifications': 'Notifications',
  'profile.notificationsSub': 'Order updates and alerts',
  'profile.logout': 'Log out',
  'profile.account': 'Account',
  'profile.preferences': 'Preferences',
  'profile.activity': 'Activity',

  'orders.title': 'Order history',
  'orders.empty': 'No orders yet. Your completed orders will appear here.',
  'orders.reorder': 'Order again',
  'orders.viewOrder': 'Track order',
  'orders.rated': 'Rated',

  'support.title': 'Help & support',
  'support.callUs': 'Call customer care',
  'support.emailUs': 'Email support',
  'support.whatsapp': 'Chat on WhatsApp',
  'support.hours': 'Every day, 8:00 AM to 11:00 PM',

  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.saved': 'Saved',
  'common.back': 'Back',
  'common.home': 'Home'
};

const kn: Dict = {
  'nav.delivery': 'ಡೆಲಿವರಿ',
  'nav.cart': 'ಕಾರ್ಟ್',
  'nav.profile': 'ಪ್ರೊಫೈಲ್',

  'feed.deliveringTo': 'ನಿಮಗೆ ತಲುಪಿಸಲಾಗುತ್ತಿದೆ',
  'feed.heroLine1': 'ನಿಮ್ಮ ಇಷ್ಟದ',
  'feed.heroLine2': 'ಊಟ ಯಾವುದು?',
  'feed.heroSub': 'ನಮ್ಮಲ್ಲಿ ಸಿಗುತ್ತದೆ.',
  'feed.searchPlaceholder': "'ಬಿರಿಯಾನಿ' ಹುಡುಕಿ",
  'feed.popular': 'ಜನಪ್ರಿಯ ರೆಸ್ಟೋರೆಂಟ್‌ಗಳು',
  'feed.filter.all': 'ಎಲ್ಲಾ',
  'feed.filter.offers': 'ಆಫರ್‌ಗಳು',
  'feed.filter.pureVeg': 'ಶುದ್ಧ ಸಸ್ಯಾಹಾರ',
  'feed.filter.fastDelivery': 'ವೇಗದ ಡೆಲಿವರಿ',
  'feed.filter.topRated': 'ಅತ್ಯುತ್ತಮ ರೇಟಿಂಗ್',

  'profile.title': 'ಪ್ರೊಫೈಲ್',
  'profile.editProfile': 'ಪ್ರೊಫೈಲ್ ಬದಲಾಯಿಸಿ',
  'profile.editProfileSub': 'ಹೆಸರು, ಫೋನ್ ಮತ್ತು ಭಾಷೆ',
  'profile.orders': 'ಆರ್ಡರ್ ಇತಿಹಾಸ',
  'profile.ordersSub': 'ನಿಮ್ಮ ಹಿಂದಿನ ಮತ್ತು ಪ್ರಸ್ತುತ ಆರ್ಡರ್‌ಗಳು',
  'profile.addresses': 'ಉಳಿಸಿದ ವಿಳಾಸಗಳು',
  'profile.wallet': 'ಕ್ವಿಕ್ ಬೈಟ್ಸ್ ವಾಲೆಟ್',
  'profile.support': 'ಸಹಾಯ ಮತ್ತು ಬೆಂಬಲ',
  'profile.supportSub': 'ಗ್ರಾಹಕ ಸೇವೆಯೊಂದಿಗೆ ಮಾತನಾಡಿ',
  'profile.language': 'ಅಪ್ಲಿಕೇಶನ್ ಭಾಷೆ',
  'profile.notifications': 'ಅಧಿಸೂಚನೆಗಳು',
  'profile.notificationsSub': 'ಆರ್ಡರ್ ನವೀಕರಣಗಳು ಮತ್ತು ಎಚ್ಚರಿಕೆಗಳು',
  'profile.logout': 'ಲಾಗ್ ಔಟ್',
  'profile.account': 'ಖಾತೆ',
  'profile.preferences': 'ಆದ್ಯತೆಗಳು',
  'profile.activity': 'ಚಟುವಟಿಕೆ',

  'orders.title': 'ಆರ್ಡರ್ ಇತಿಹಾಸ',
  'orders.empty': 'ಇನ್ನೂ ಆರ್ಡರ್‌ಗಳಿಲ್ಲ. ಪೂರ್ಣಗೊಂಡ ಆರ್ಡರ್‌ಗಳು ಇಲ್ಲಿ ಕಾಣಿಸುತ್ತವೆ.',
  'orders.reorder': 'ಮತ್ತೆ ಆರ್ಡರ್ ಮಾಡಿ',
  'orders.viewOrder': 'ಆರ್ಡರ್ ಟ್ರ್ಯಾಕ್ ಮಾಡಿ',
  'orders.rated': 'ರೇಟ್ ಮಾಡಲಾಗಿದೆ',

  'support.title': 'ಸಹಾಯ ಮತ್ತು ಬೆಂಬಲ',
  'support.callUs': 'ಗ್ರಾಹಕ ಸೇವೆಗೆ ಕರೆ ಮಾಡಿ',
  'support.emailUs': 'ಇಮೇಲ್ ಬೆಂಬಲ',
  'support.whatsapp': 'ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಚಾಟ್ ಮಾಡಿ',
  'support.hours': 'ಪ್ರತಿದಿನ ಬೆಳಿಗ್ಗೆ 8:00 ರಿಂದ ರಾತ್ರಿ 11:00',

  'common.save': 'ಉಳಿಸಿ',
  'common.cancel': 'ರದ್ದುಮಾಡಿ',
  'common.saved': 'ಉಳಿಸಲಾಗಿದೆ',
  'common.back': 'ಹಿಂದೆ',
  'common.home': 'ಮುಖಪುಟ'
};

const hi: Dict = {
  'nav.delivery': 'डिलीवरी',
  'nav.cart': 'कार्ट',
  'nav.profile': 'प्रोफ़ाइल',

  'feed.deliveringTo': 'आप तक पहुँचाया जा रहा है',
  'feed.heroLine1': 'आज क्या',
  'feed.heroLine2': 'खाने का मन है?',
  'feed.heroSub': 'हमारे पास सब है।',
  'feed.searchPlaceholder': "'बिरयानी' खोजें",
  'feed.popular': 'लोकप्रिय रेस्टोरेंट',
  'feed.filter.all': 'सभी',
  'feed.filter.offers': 'ऑफ़र',
  'feed.filter.pureVeg': 'शुद्ध शाकाहारी',
  'feed.filter.fastDelivery': 'तेज़ डिलीवरी',
  'feed.filter.topRated': 'टॉप रेटेड',

  'profile.title': 'प्रोफ़ाइल',
  'profile.editProfile': 'प्रोफ़ाइल बदलें',
  'profile.editProfileSub': 'नाम, फ़ोन और भाषा',
  'profile.orders': 'ऑर्डर इतिहास',
  'profile.ordersSub': 'आपके पिछले और मौजूदा ऑर्डर',
  'profile.addresses': 'सहेजे गए पते',
  'profile.wallet': 'क्विक बाइट्स वॉलेट',
  'profile.support': 'सहायता और समर्थन',
  'profile.supportSub': 'ग्राहक सेवा से बात करें',
  'profile.language': 'ऐप की भाषा',
  'profile.notifications': 'सूचनाएँ',
  'profile.notificationsSub': 'ऑर्डर अपडेट और अलर्ट',
  'profile.logout': 'लॉग आउट',
  'profile.account': 'खाता',
  'profile.preferences': 'प्राथमिकताएँ',
  'profile.activity': 'गतिविधि',

  'orders.title': 'ऑर्डर इतिहास',
  'orders.empty': 'अभी कोई ऑर्डर नहीं। पूरे हुए ऑर्डर यहाँ दिखेंगे।',
  'orders.reorder': 'दोबारा ऑर्डर करें',
  'orders.viewOrder': 'ऑर्डर ट्रैक करें',
  'orders.rated': 'रेट किया गया',

  'support.title': 'सहायता और समर्थन',
  'support.callUs': 'ग्राहक सेवा को कॉल करें',
  'support.emailUs': 'ईमेल सहायता',
  'support.whatsapp': 'व्हाट्सएप पर चैट करें',
  'support.hours': 'हर दिन सुबह 8:00 से रात 11:00 बजे तक',

  'common.save': 'सहेजें',
  'common.cancel': 'रद्द करें',
  'common.saved': 'सहेजा गया',
  'common.back': 'वापस',
  'common.home': 'होम'
};

const DICTS: Record<Language, Dict> = { en, kn, hi };

interface I18nValue {
  language: Language;
  setLanguage: (next: Language) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nValue>({
  language: 'en',
  setLanguage: () => {},
  t: key => en[key] ?? key
});

export const I18nProvider: React.FC<{
  initialLanguage?: Language;
  onLanguageChange?: (next: Language) => void;
  children: React.ReactNode;
}> = ({ initialLanguage = 'en', onLanguageChange, children }) => {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  const setLanguage = useCallback(
    (next: Language) => {
      setLanguageState(next);
      onLanguageChange?.(next);
    },
    [onLanguageChange]
  );

  const value = useMemo<I18nValue>(
    () => ({
      language,
      setLanguage,
      // Falls back to English, then to the key itself, so a missing translation
      // shows readable text rather than a blank space.
      t: (key: string) => DICTS[language][key] ?? en[key] ?? key
    }),
    [language, setLanguage]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useTranslation(): I18nValue {
  return useContext(I18nContext);
}
