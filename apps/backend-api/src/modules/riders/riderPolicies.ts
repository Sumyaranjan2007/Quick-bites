/**
 * The policies a delivery partner is held to, served to the rider app.
 *
 * Kept on the server rather than hard-coded into the app so a revision reaches
 * every rider the next time they open the screen, instead of waiting for them
 * to install a new build. The app caches the last copy it fetched so the
 * screen still works without a connection.
 */

export interface PolicyDocument {
  id: string;
  title: string;
  summary: string;
  updatedAt: string;
  sections: Array<{ heading: string; body: string }>;
}

const UPDATED_AT = '2026-09-14';

export const RIDER_POLICIES: PolicyDocument[] = [
  {
    id: 'privacy',
    title: 'Privacy Policy',
    summary: 'What Quick Bites collects about you, why, and how long it is kept.',
    updatedAt: UPDATED_AT,
    sections: [
      {
        heading: 'What we collect',
        body:
          'Your name, photograph, phone number, email address and the identity and vehicle documents you upload for verification. While you are on shift we also record your location, the trips you complete, the ratings customers give you, and the earnings and cash movements on your account.'
      },
      {
        heading: 'Your location',
        body:
          'Your position is recorded only while you are on shift and carrying an order, and it is shared with the customer waiting for that order and with Quick Bites operations. It is not shared with restaurants, and it is not collected when you are offline. Turning off location sharing stops new trips being offered to you, because a customer cannot be shown a rider who cannot be located.'
      },
      {
        heading: 'Who sees your data',
        body:
          'Customers on an active trip see your first name, photograph, vehicle type and live position. Restaurants see your name when you arrive to collect. Quick Bites operations staff can see your full profile, documents and trip history for verification, payouts and dispute resolution.'
      },
      {
        heading: 'How long it is kept',
        body:
          'Identity documents are retained for as long as your partner account is active and for seven years afterwards, as required for tax and transport records. Trip location traces are retained for 90 days and then deleted. Earnings records are retained for seven years.'
      },
      {
        heading: 'Your rights',
        body:
          'You may ask for a copy of your data, correct anything inaccurate, or ask for your account to be closed, by writing to partners@quickbites.app. Closing your account does not erase records the law requires us to keep, such as payout statements.'
      }
    ]
  },
  {
    id: 'terms',
    title: 'Terms & Conditions',
    summary: 'The agreement between you and Quick Bites as an independent delivery partner.',
    updatedAt: UPDATED_AT,
    sections: [
      {
        heading: 'Your relationship with Quick Bites',
        body:
          'You deliver as an independent partner, not an employee. You choose when to go on shift and which trips to accept, and you are responsible for your own vehicle, fuel, licence, insurance and taxes.'
      },
      {
        heading: 'Eligibility',
        body:
          'You must be at least 18, hold a valid driving licence for the vehicle you use, and keep your registration and insurance current. Your account stays active only while your documents are approved and unexpired.'
      },
      {
        heading: 'Accepting and completing trips',
        body:
          'A trip you accept is yours to complete. Collect the order using the restaurant pickup code, keep it sealed and upright, and hand it over only against the customer’s four-digit delivery code. Never ask a customer to read out their code before you have arrived.'
      },
      {
        heading: 'Cash orders',
        body:
          'Cash you collect on delivery belongs to Quick Bites and must be deposited as instructed. It is tracked against your account as cash in hand and is offset against your payouts.'
      },
      {
        heading: 'Ending the agreement',
        body:
          'You may stop delivering at any time. Quick Bites may suspend or close a partner account for fraud, repeated tampering with orders, threatening behaviour toward customers or restaurant staff, or delivering while unfit to ride.'
      }
    ]
  },
  {
    id: 'partner-code',
    title: 'Delivery Partner Code of Conduct',
    summary: 'What is expected of you on every trip.',
    updatedAt: UPDATED_AT,
    sections: [
      {
        heading: 'At the restaurant',
        body:
          'Arrive with a clean delivery bag, quote the pickup code, and check the item count against the order before you leave. Do not open sealed packaging. Do not argue with kitchen staff about preparation time — report a delay in the app instead.'
      },
      {
        heading: 'On the road',
        body:
          'Wear a helmet, obey traffic law, and never use the app while riding. Pull over to read an order. A trip is never worth a collision; no incentive target survives an accident.'
      },
      {
        heading: 'At the doorstep',
        body:
          'Call the customer from the gate rather than entering private property uninvited. Hand the order over politely, collect the exact cash where applicable, and enter the delivery code in front of the customer. Never mark an order delivered that you still hold.'
      },
      {
        heading: 'Conduct that ends an account',
        body:
          'Consuming or tampering with an order, demanding payment above the bill, recording or contacting customers outside the app, or abusive behaviour toward anyone on the platform.'
      }
    ]
  },
  {
    id: 'payouts',
    title: 'Earnings & Payout Policy',
    summary: 'How trip pay, incentives and cash settlement work.',
    updatedAt: UPDATED_AT,
    sections: [
      {
        heading: 'What a trip pays',
        body:
          'Every completed trip pays a base of Rs 40 plus the delivery fee charged on that order, which scales with the kitchen-to-doorstep distance. The figure is fixed when you accept the trip and shown on the offer before you accept it.'
      },
      {
        heading: 'Incentives',
        body:
          'Incentive targets are measured in Indian Standard Time: daily targets reset at midnight, weekly targets on Monday. A target pays once per period, automatically, the moment it is met — there is nothing to claim.'
      },
      {
        heading: 'Payouts',
        body:
          'Your wallet balance is transferred to the bank account on your profile every Tuesday for the week ending the previous Sunday. Cash you are holding from COD orders is deducted from that transfer.'
      },
      {
        heading: 'Disputes',
        body:
          'If a trip is missing from your earnings, raise it from the trip in your history within 14 days. Older claims cannot be reconciled against restaurant settlement records.'
      }
    ]
  },
  {
    id: 'safety',
    title: 'Safety Policy',
    summary: 'What Quick Bites does when you raise an SOS, and what to do first.',
    updatedAt: UPDATED_AT,
    sections: [
      {
        heading: 'Emergencies come first',
        body:
          'In a medical emergency, an accident with injuries, or immediate danger, call 112 before you open this app. The SOS button alerts Quick Bites operations — it does not summon an ambulance or the police.'
      },
      {
        heading: 'What SOS does',
        body:
          'Raising an SOS sends your identity, your live location and the trip you are on to the operations control room immediately. A member of staff calls the number on your profile. Your active trip is flagged so it can be reassigned without penalty.'
      },
      {
        heading: 'Your acceptance rate is protected',
        body:
          'Trips you could not complete because of an incident, a breakdown or unsafe conditions are excluded from your acceptance rate once operations close the report. Never complete a delivery you do not feel safe completing.'
      },
      {
        heading: 'Insurance',
        body:
          'Active partners are covered by accident insurance while on shift and carrying an order. Report any incident within 48 hours through SOS or partners@quickbites.app, or the claim cannot be filed.'
      }
    ]
  }
];

export function findPolicy(id: string): PolicyDocument | undefined {
  return RIDER_POLICIES.find(p => p.id === id);
}
