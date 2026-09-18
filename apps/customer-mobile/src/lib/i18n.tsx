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

/** `{seconds}`, `{minutes}` and the like, filled in by `t(key, vars)`. */
const PLACEHOLDER = /[{]([a-zA-Z0-9_]+)[}]/g;

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
  'common.home': 'Home',

  "auth.signInTitle": "Sign in or sign up",
  "auth.signInBody": "Enter your mobile number. We will send you a verification code — no password needed.",
  "auth.mobileNumber": "Mobile Number",
  "auth.mobilePlaceholder": "10-digit mobile",
  "auth.sendCode": "Send Code",
  "auth.enterCode": "Enter the code",
  "auth.verificationCode": "Verification Code",
  "auth.verify": "Verify",
  "auth.resend": "Resend code",
  "auth.resendIn": "Resend code in {seconds}s",
  "auth.welcome": "Welcome to Quick Bites",
  "auth.nameBody": "What should we call you? Your rider will see this name.",
  "auth.yourName": "Your Name",
  "auth.namePlaceholder": "Your name",
  "auth.startOrdering": "Start Ordering",
  "auth.skip": "Skip for now",
  "auth.tagline": "Your craving, delivered fast.",
  "cart.toPay": "To pay",
  "cart.tipTitle": "Tip your delivery partner",
  "cart.tipSubtitle": "100% of it goes to the rider. No commission, no tax.",
  "cart.tipNone": "No tip",
  "cart.tipCustom": "Enter another amount",
  "cart.tipForRider": "Rider tip",
  "cart.tipGoesToRider": "Your rider receives this in full.",
  "cart.tipCapped": "The most you can tip in the app is ₹500.",
  "tracking.eta": "Arriving in",
  "tracking.etaMinutes": "{minutes} min",
  "tracking.etaPrep": "The kitchen is still cooking",
  "tracking.etaEnRoute": "Your rider is on the way",
  "tracking.etaArrived": "Delivered",
  "tracking.etaUnknown": "We will show a time once the kitchen confirms",
  "tracking.cancelOrder": "Cancel order",
  "tracking.cancelTitle": "Why are you cancelling?",
  "tracking.cancelBody": "Tell us what went wrong so we can fix it. If you have paid, your refund starts straight away.",
  "tracking.cancelNote": "Tell us more",
  "tracking.cancelConfirm": "Cancel this order",
  "tracking.cancelKeep": "Keep my order",
  "tracking.cancelTooLate": "This order has gone too far to cancel. Contact support for help.",
  "tracking.refundStarted": "Your refund has been started.",
  "orders.reorderTitle": "Order again",
  "orders.reorderChanged": "Some things have changed since last time",
  "orders.reorderPriceChanged": "Prices have changed",
  "orders.reorderUnavailable": "Out of stock right now",
  "orders.reorderRemoved": "No longer on the menu",
  "orders.reorderAddToCart": "Add to cart",
  "orders.reorderNothing": "Nothing from this order can be ordered right now.",
  "feed.filter.underThirty": "Under 30 min",
  "feed.filter.rated4": "Rated 4.0+",
  "feed.filter.openNow": "Open now",
  "feed.filter.budget": "Under ₹400 for two",
  "feed.sort.relevance": "Relevance",
  "feed.sort.rating": "Rating",
  "feed.sort.deliveryTime": "Delivery time",
  "feed.sort.costLowToHigh": "Cost: low to high",
  "feed.sort.costHighToLow": "Cost: high to low"
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
  'common.home': 'ಮುಖಪುಟ',

  "auth.signInTitle": "ಸೈನ್ ಇನ್ ಅಥವಾ ಸೈನ್ ಅಪ್ ಮಾಡಿ",
  "auth.signInBody": "ನಿಮ್ಮ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ ನಮೂದಿಸಿ. ನಾವು ನಿಮಗೆ ಪರಿಶೀಲನಾ ಕೋಡ್ ಕಳುಹಿಸುತ್ತೇವೆ — ಪಾಸ್‌ವರ್ಡ್ ಬೇಕಿಲ್ಲ.",
  "auth.mobileNumber": "ಮೊಬೈಲ್ ಸಂಖ್ಯೆ",
  "auth.mobilePlaceholder": "10 ಅಂಕಿಯ ಮೊಬೈಲ್",
  "auth.sendCode": "ಕೋಡ್ ಕಳುಹಿಸಿ",
  "auth.enterCode": "ಕೋಡ್ ನಮೂದಿಸಿ",
  "auth.verificationCode": "ಪರಿಶೀಲನಾ ಕೋಡ್",
  "auth.verify": "ಪರಿಶೀಲಿಸಿ",
  "auth.resend": "ಕೋಡ್ ಮತ್ತೆ ಕಳುಹಿಸಿ",
  "auth.resendIn": "{seconds} ಸೆಕೆಂಡ್‌ಗಳಲ್ಲಿ ಮತ್ತೆ ಕಳುಹಿಸಿ",
  "auth.welcome": "ಕ್ವಿಕ್ ಬೈಟ್ಸ್‌ಗೆ ಸ್ವಾಗತ",
  "auth.nameBody": "ನಿಮ್ಮನ್ನು ಏನೆಂದು ಕರೆಯಬೇಕು? ನಿಮ್ಮ ರೈಡರ್ ಈ ಹೆಸರನ್ನು ನೋಡುತ್ತಾರೆ.",
  "auth.yourName": "ನಿಮ್ಮ ಹೆಸರು",
  "auth.namePlaceholder": "ನಿಮ್ಮ ಹೆಸರು",
  "auth.startOrdering": "ಆರ್ಡರ್ ಮಾಡಲು ಪ್ರಾರಂಭಿಸಿ",
  "auth.skip": "ಈಗ ಬಿಟ್ಟುಬಿಡಿ",
  "auth.tagline": "ನಿಮ್ಮ ಇಷ್ಟದ ಊಟ, ವೇಗವಾಗಿ ತಲುಪಿಸಲಾಗುತ್ತದೆ.",
  "cart.toPay": "ಪಾವತಿಸಬೇಕಾದದ್ದು",
  "cart.tipTitle": "ನಿಮ್ಮ ಡೆಲಿವರಿ ಪಾಲುದಾರರಿಗೆ ಟಿಪ್ ನೀಡಿ",
  "cart.tipSubtitle": "ಟಿಪ್ ಸಂಪೂರ್ಣವಾಗಿ ರೈಡರ್‌ಗೆ ಸೇರುತ್ತದೆ. ಕಮಿಷನ್ ಇಲ್ಲ, ತೆರಿಗೆ ಇಲ್ಲ.",
  "cart.tipNone": "ಟಿಪ್ ಬೇಡ",
  "cart.tipCustom": "ಬೇರೆ ಮೊತ್ತ ನಮೂದಿಸಿ",
  "cart.tipForRider": "ರೈಡರ್ ಟಿಪ್",
  "cart.tipGoesToRider": "ಈ ಮೊತ್ತ ಪೂರ್ತಿಯಾಗಿ ನಿಮ್ಮ ರೈಡರ್‌ಗೆ ಸಿಗುತ್ತದೆ.",
  "cart.tipCapped": "ಆ್ಯಪ್‌ನಲ್ಲಿ ಗರಿಷ್ಠ ₹500 ಟಿಪ್ ನೀಡಬಹುದು.",
  "tracking.eta": "ತಲುಪಲು",
  "tracking.etaMinutes": "{minutes} ನಿಮಿಷ",
  "tracking.etaPrep": "ಅಡುಗೆಮನೆಯಲ್ಲಿ ಇನ್ನೂ ತಯಾರಾಗುತ್ತಿದೆ",
  "tracking.etaEnRoute": "ನಿಮ್ಮ ರೈಡರ್ ದಾರಿಯಲ್ಲಿದ್ದಾರೆ",
  "tracking.etaArrived": "ತಲುಪಿಸಲಾಗಿದೆ",
  "tracking.etaUnknown": "ಅಡುಗೆಮನೆ ದೃಢಪಡಿಸಿದ ನಂತರ ಸಮಯ ತೋರಿಸುತ್ತೇವೆ",
  "tracking.cancelOrder": "ಆರ್ಡರ್ ರದ್ದುಮಾಡಿ",
  "tracking.cancelTitle": "ನೀವು ಏಕೆ ರದ್ದುಮಾಡುತ್ತಿದ್ದೀರಿ?",
  "tracking.cancelBody": "ಏನು ತಪ್ಪಾಯಿತು ಎಂದು ತಿಳಿಸಿ, ನಾವು ಸರಿಪಡಿಸುತ್ತೇವೆ. ನೀವು ಪಾವತಿಸಿದ್ದರೆ, ಮರುಪಾವತಿ ತಕ್ಷಣ ಪ್ರಾರಂಭವಾಗುತ್ತದೆ.",
  "tracking.cancelNote": "ಇನ್ನಷ್ಟು ತಿಳಿಸಿ",
  "tracking.cancelConfirm": "ಈ ಆರ್ಡರ್ ರದ್ದುಮಾಡಿ",
  "tracking.cancelKeep": "ಆರ್ಡರ್ ಉಳಿಸಿಕೊಳ್ಳಿ",
  "tracking.cancelTooLate": "ಈ ಆರ್ಡರ್ ರದ್ದುಮಾಡಲು ತುಂಬಾ ಮುಂದೆ ಹೋಗಿದೆ. ಸಹಾಯಕ್ಕಾಗಿ ಬೆಂಬಲವನ್ನು ಸಂಪರ್ಕಿಸಿ.",
  "tracking.refundStarted": "ನಿಮ್ಮ ಮರುಪಾವತಿ ಪ್ರಾರಂಭವಾಗಿದೆ.",
  "orders.reorderTitle": "ಮತ್ತೆ ಆರ್ಡರ್ ಮಾಡಿ",
  "orders.reorderChanged": "ಕಳೆದ ಬಾರಿಯಿಂದ ಕೆಲವು ವಿಷಯಗಳು ಬದಲಾಗಿವೆ",
  "orders.reorderPriceChanged": "ಬೆಲೆಗಳು ಬದಲಾಗಿವೆ",
  "orders.reorderUnavailable": "ಈಗ ಸ್ಟಾಕ್‌ನಲ್ಲಿ ಇಲ್ಲ",
  "orders.reorderRemoved": "ಇನ್ನು ಮೆನುವಿನಲ್ಲಿ ಇಲ್ಲ",
  "orders.reorderAddToCart": "ಕಾರ್ಟ್‌ಗೆ ಸೇರಿಸಿ",
  "orders.reorderNothing": "ಈ ಆರ್ಡರ್‌ನಿಂದ ಈಗ ಏನನ್ನೂ ಆರ್ಡರ್ ಮಾಡಲಾಗುವುದಿಲ್ಲ.",
  "feed.filter.underThirty": "30 ನಿಮಿಷಕ್ಕಿಂತ ಕಡಿಮೆ",
  "feed.filter.rated4": "4.0+ ರೇಟಿಂಗ್",
  "feed.filter.openNow": "ಈಗ ತೆರೆದಿದೆ",
  "feed.filter.budget": "ಇಬ್ಬರಿಗೆ ₹400ಕ್ಕಿಂತ ಕಡಿಮೆ",
  "feed.sort.relevance": "ಪ್ರಸ್ತುತತೆ",
  "feed.sort.rating": "ರೇಟಿಂಗ್",
  "feed.sort.deliveryTime": "ಡೆಲಿವರಿ ಸಮಯ",
  "feed.sort.costLowToHigh": "ಬೆಲೆ: ಕಡಿಮೆಯಿಂದ ಹೆಚ್ಚು",
  "feed.sort.costHighToLow": "ಬೆಲೆ: ಹೆಚ್ಚಿನಿಂದ ಕಡಿಮೆ"
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
  'common.home': 'होम',

  "auth.signInTitle": "साइन इन या साइन अप करें",
  "auth.signInBody": "अपना मोबाइल नंबर डालें। हम आपको एक वेरिफिकेशन कोड भेजेंगे — पासवर्ड की ज़रूरत नहीं।",
  "auth.mobileNumber": "मोबाइल नंबर",
  "auth.mobilePlaceholder": "10 अंकों का मोबाइल",
  "auth.sendCode": "कोड भेजें",
  "auth.enterCode": "कोड डालें",
  "auth.verificationCode": "वेरिफिकेशन कोड",
  "auth.verify": "वेरिफ़ाई करें",
  "auth.resend": "कोड दोबारा भेजें",
  "auth.resendIn": "{seconds} सेकंड में दोबारा भेजें",
  "auth.welcome": "क्विक बाइट्स में आपका स्वागत है",
  "auth.nameBody": "हम आपको क्या कहकर बुलाएँ? आपका राइडर यही नाम देखेगा।",
  "auth.yourName": "आपका नाम",
  "auth.namePlaceholder": "आपका नाम",
  "auth.startOrdering": "ऑर्डर करना शुरू करें",
  "auth.skip": "अभी छोड़ें",
  "auth.tagline": "आपकी पसंद, तेज़ी से पहुँचाई गई।",
  "cart.toPay": "कुल देय",
  "cart.tipTitle": "अपने डिलीवरी पार्टनर को टिप दें",
  "cart.tipSubtitle": "पूरी टिप राइडर को जाती है। कोई कमीशन नहीं, कोई टैक्स नहीं।",
  "cart.tipNone": "टिप नहीं",
  "cart.tipCustom": "कोई और राशि डालें",
  "cart.tipForRider": "राइडर टिप",
  "cart.tipGoesToRider": "यह पूरी राशि आपके राइडर को मिलेगी।",
  "cart.tipCapped": "ऐप में अधिकतम ₹500 तक टिप दी जा सकती है।",
  "tracking.eta": "पहुँचने में",
  "tracking.etaMinutes": "{minutes} मिनट",
  "tracking.etaPrep": "रसोई में खाना अभी बन रहा है",
  "tracking.etaEnRoute": "आपका राइडर रास्ते में है",
  "tracking.etaArrived": "डिलीवर हो गया",
  "tracking.etaUnknown": "रसोई की पुष्टि के बाद समय दिखाया जाएगा",
  "tracking.cancelOrder": "ऑर्डर रद्द करें",
  "tracking.cancelTitle": "आप ऑर्डर क्यों रद्द कर रहे हैं?",
  "tracking.cancelBody": "बताइए क्या गड़बड़ हुई ताकि हम उसे ठीक कर सकें। अगर आपने पैसे दिए हैं, तो रिफ़ंड तुरंत शुरू हो जाएगा।",
  "tracking.cancelNote": "और बताइए",
  "tracking.cancelConfirm": "यह ऑर्डर रद्द करें",
  "tracking.cancelKeep": "ऑर्डर रहने दें",
  "tracking.cancelTooLate": "यह ऑर्डर रद्द करने के लिए बहुत आगे बढ़ चुका है। मदद के लिए सहायता से संपर्क करें।",
  "tracking.refundStarted": "आपका रिफ़ंड शुरू कर दिया गया है।",
  "orders.reorderTitle": "दोबारा ऑर्डर करें",
  "orders.reorderChanged": "पिछली बार से कुछ चीज़ें बदल गई हैं",
  "orders.reorderPriceChanged": "कीमतें बदल गई हैं",
  "orders.reorderUnavailable": "अभी स्टॉक में नहीं",
  "orders.reorderRemoved": "अब मेन्यू में नहीं है",
  "orders.reorderAddToCart": "कार्ट में डालें",
  "orders.reorderNothing": "इस ऑर्डर में से अभी कुछ भी ऑर्डर नहीं किया जा सकता।",
  "feed.filter.underThirty": "30 मिनट से कम",
  "feed.filter.rated4": "4.0+ रेटिंग",
  "feed.filter.openNow": "अभी खुला है",
  "feed.filter.budget": "दो लोगों के लिए ₹400 से कम",
  "feed.sort.relevance": "प्रासंगिकता",
  "feed.sort.rating": "रेटिंग",
  "feed.sort.deliveryTime": "डिलीवरी का समय",
  "feed.sort.costLowToHigh": "कीमत: कम से ज़्यादा",
  "feed.sort.costHighToLow": "कीमत: ज़्यादा से कम"
};

const DICTS: Record<Language, Dict> = { en, kn, hi };

interface I18nValue {
  language: Language;
  setLanguage: (next: Language) => void;
  /**
   * `vars` fills `{name}` placeholders in the translated string.
   *
   * Strings are interpolated rather than concatenated because word order is not
   * the same in the three languages this app ships: building "Resend code in " +
   * n + "s" in code produces a sentence that can only ever be right in English.
   */
  t: (key: string, vars?: Record<string, string | number>) => string;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  // An unknown placeholder is left as written rather than replaced with
  // "undefined": a visible {name} is a bug report, and "undefined" is a mystery.
  return template.replace(PLACEHOLDER, (match, name) =>
    name in vars ? String(vars[name]) : match
  );
}

const I18nContext = createContext<I18nValue>({
  language: 'en',
  setLanguage: () => {},
  t: (key, vars) => interpolate(en[key] ?? key, vars)
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
      t: (key: string, vars?: Record<string, string | number>) =>
        interpolate(DICTS[language][key] ?? en[key] ?? key, vars)
    }),
    [language, setLanguage]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useTranslation(): I18nValue {
  return useContext(I18nContext);
}
