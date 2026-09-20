/**
 * Why an order was cancelled — as a closed list, not free text.
 *
 * A free-text box produces "didnt want", "Didn't want it", "no reason" and a
 * hundred other spellings of the same thing, which cannot be counted. The
 * cancellation rate by reason is the number that tells you whether the kitchens
 * are too slow or the customers are changing their minds, and it only exists if
 * the reason is a code.
 *
 * The sentence is served alongside the code, translated, so the apps do not
 * carry their own copy. Adding a reason here reaches every installed app on the
 * next screen open; it does not need a release.
 */
import type { LanguageCode } from '@quick-bites/shared-types';

/** Who may pick a given reason. A kitchen does not cancel because it "ordered by mistake". */
export type CancellationActor = 'customer' | 'restaurant' | 'admin';

export interface CancellationReason {
  code: string;
  /** The audiences allowed to select it. */
  actors: CancellationActor[];
  label: Record<LanguageCode, string>;
  /**
   * Whether choosing it lets the customer add a sentence of their own. Only the
   * catch-all does, which is what keeps the other codes countable.
   */
  allowsNote?: boolean;
}

export const CANCELLATION_REASONS: CancellationReason[] = [
  {
    code: 'ORDERED_BY_MISTAKE',
    actors: ['customer'],
    label: {
      en: 'I ordered by mistake',
      hi: 'मैंने गलती से ऑर्डर कर दिया',
      kn: 'ನಾನು ತಪ್ಪಾಗಿ ಆರ್ಡರ್ ಮಾಡಿದೆ'
    }
  },
  {
    code: 'WRONG_ITEMS',
    actors: ['customer'],
    label: {
      en: 'I chose the wrong items',
      hi: 'मैंने गलत आइटम चुन लिए',
      kn: 'ನಾನು ತಪ್ಪಾದ ಐಟಂಗಳನ್ನು ಆಯ್ಕೆ ಮಾಡಿದೆ'
    }
  },
  {
    code: 'WRONG_ADDRESS',
    actors: ['customer'],
    label: {
      en: 'The delivery address is wrong',
      hi: 'डिलीवरी का पता गलत है',
      kn: 'ವಿತರಣಾ ವಿಳಾಸ ತಪ್ಪಾಗಿದೆ'
    }
  },
  {
    code: 'TOO_LONG',
    actors: ['customer'],
    label: {
      en: 'It is taking too long',
      hi: 'बहुत ज़्यादा समय लग रहा है',
      kn: 'ತುಂಬಾ ಸಮಯ ತೆಗೆದುಕೊಳ್ಳುತ್ತಿದೆ'
    }
  },
  {
    code: 'CHANGED_MY_MIND',
    actors: ['customer'],
    label: {
      en: 'I changed my mind',
      hi: 'मैंने अपना मन बदल दिया',
      kn: 'ನಾನು ನನ್ನ ಮನಸ್ಸು ಬದಲಾಯಿಸಿದೆ'
    }
  },
  {
    code: 'ITEM_UNAVAILABLE',
    actors: ['restaurant', 'admin'],
    label: {
      en: 'An item is out of stock',
      hi: 'एक आइटम स्टॉक में नहीं है',
      kn: 'ಒಂದು ಐಟಂ ಸ್ಟಾಕ್‌ನಲ್ಲಿ ಇಲ್ಲ'
    }
  },
  {
    code: 'KITCHEN_OVERLOADED',
    actors: ['restaurant', 'admin'],
    label: {
      en: 'The kitchen cannot take this order right now',
      hi: 'रसोई अभी यह ऑर्डर नहीं ले सकती',
      kn: 'ಅಡುಗೆಮನೆ ಈಗ ಈ ಆರ್ಡರ್ ಸ್ವೀಕರಿಸಲಾಗುವುದಿಲ್ಲ'
    }
  },
  {
    code: 'KITCHEN_CLOSED',
    actors: ['restaurant', 'admin'],
    label: {
      en: 'The kitchen has closed',
      hi: 'रसोई बंद हो गई है',
      kn: 'ಅಡುಗೆಮನೆ ಮುಚ್ಚಲಾಗಿದೆ'
    }
  },
  {
    // Chosen by the platform itself, not by a person. Kept in the same
    // catalogue as every other reason so that reports counting why orders are
    // lost see automated cancellations alongside human ones rather than
    // missing them entirely.
    code: 'RESTAURANT_DID_NOT_RESPOND',
    actors: ['admin'],
    label: {
      en: 'The restaurant did not respond in time',
      hi: 'रेस्टोरेंट ने समय पर जवाब नहीं दिया',
      kn: 'ರೆಸ್ಟೋರೆಂಟ್ ಸಮಯಕ್ಕೆ ಪ್ರತಿಕ್ರಿಯಿಸಲಿಲ್ಲ'
    }
  },
  {
    // Also chosen by the platform: reconciliation cancels an order once the
    // gateway has confirmed it captured nothing.
    code: 'PAYMENT_FAILED',
    actors: ['admin'],
    label: {
      en: 'Payment was not completed',
      hi: 'भुगतान पूरा नहीं हुआ',
      kn: 'ಪಾವತಿ ಪೂರ್ಣಗೊಂಡಿಲ್ಲ'
    }
  },
  {
    code: 'NO_RIDER_AVAILABLE',
    actors: ['admin'],
    label: {
      en: 'No delivery partner was available',
      hi: 'कोई डिलीवरी पार्टनर उपलब्ध नहीं था',
      kn: 'ಯಾವುದೇ ವಿತರಣಾ ಪಾಲುದಾರರು ಲಭ್ಯವಿರಲಿಲ್ಲ'
    }
  },
  {
    code: 'CUSTOMER_UNREACHABLE',
    actors: ['admin'],
    label: {
      en: 'The customer could not be reached',
      hi: 'ग्राहक से संपर्क नहीं हो सका',
      kn: 'ಗ್ರಾಹಕರನ್ನು ಸಂಪರ್ಕಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ'
    }
  },
  {
    code: 'OTHER',
    actors: ['customer', 'restaurant', 'admin'],
    allowsNote: true,
    label: {
      en: 'Another reason',
      hi: 'कोई और कारण',
      kn: 'ಬೇರೊಂದು ಕಾರಣ'
    }
  }
];

export function findCancellationReason(code: string): CancellationReason | undefined {
  return CANCELLATION_REASONS.find(r => r.code === code);
}

/**
 * The reasons one audience may choose, in one language.
 *
 * Falls back to English for a language a reason has not been translated into,
 * rather than returning an empty string: an untranslated sentence is a worse
 * screen than an English one, but a blank button is not a screen at all.
 */
export function cancellationReasonsFor(
  actor: CancellationActor,
  language: LanguageCode = 'en'
): Array<{ code: string; label: string; allowsNote: boolean }> {
  return CANCELLATION_REASONS.filter(r => r.actors.includes(actor)).map(r => ({
    code: r.code,
    label: r.label[language] || r.label.en,
    allowsNote: Boolean(r.allowsNote)
  }));
}

/**
 * Maps the caller's role onto the audience whose reasons they may use.
 * `super_admin` and `rider` both fall to `admin`, because a trip cancelled from
 * the control room is an operations decision whoever typed it.
 */
export function actorForRole(role: string | undefined): CancellationActor {
  if (role === 'customer') return 'customer';
  if (role === 'restaurant_owner') return 'restaurant';
  return 'admin';
}
