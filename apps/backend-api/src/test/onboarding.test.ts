/**
 * Getting onto the platform.
 *
 * A restaurant and a rider sign themselves up, cannot trade, submit documents,
 * are approved by an administrator, and only then can take orders or start a
 * shift. Before this existed the only way in was a seeded account sharing one
 * password held in a single deployment's environment — which is precisely why
 * the staff apps could not be handed to a tester.
 *
 * The checks that matter most here are the negative ones: a pending restaurant
 * must be invisible and unorderable, and a pending rider must not be able to go
 * on shift. An approval flow whose gates do not hold is decoration.
 */
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { resetAuthRateLimit, resetRequestRateLimit } from '../middlewares/rateLimiter.ts';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';
import { riderRepository } from '../db/repositories/riderRepository.ts';
import { kycRepository } from '../db/repositories/kycRepository.ts';

console.log('====================================================');
console.log('     RUNNING ONBOARDING & APPROVAL TESTS            ');
console.log('====================================================\n');

const PORT = 4900 + Math.floor(Math.random() * 300);
const API = `http://127.0.0.1:${PORT}/api`;

let passed = 0;
let failed = 0;

function check(description: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`[PASS] ${description}`);
    passed++;
  } else {
    console.log(`[FAIL] ${description}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function api(path: string, options: { method?: string; body?: any } = {}, token?: string) {
  const res = await fetch(`${API}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* some errors carry no body */
  }
  return { status: res.status, json };
}

const unique = Date.now().toString().slice(-6);

async function run() {
  await seedDatabase();
  const app = createApp();
  const server = app.listen(PORT, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));

  resetAuthRateLimit();
  resetRequestRateLimit();

  // ------------------------------------------------------------------
  console.log('--- A restaurant signs itself up ---');

  const partnerReg = await api('/auth/register/partner', {
    method: 'POST',
    body: {
      fullName: 'Meera Rao',
      email: `meera${unique}@kitchen.test`,
      phone: `98${unique}1234`.slice(0, 10),
      password: 'PartnerPass123',
      restaurantName: `Meera's Kitchen ${unique}`,
      addressLine: '14 Residency Road',
      city: 'Bengaluru',
      pincode: '560025',
      fssaiLicenseNumber: 'FSSAI12345678901',
      latitude: 12.9716,
      longitude: 77.5946
    }
  });

  check('A partner can register without anyone provisioning them', partnerReg.status === 201,
    `status ${partnerReg.status} ${JSON.stringify(partnerReg.json).slice(0, 180)}`);
  check('and is told they are awaiting approval', partnerReg.json?.data?.awaitingApproval === true);
  check('and receives the restaurant_owner role, not customer',
    partnerReg.json?.data?.user?.role === 'restaurant_owner',
    String(partnerReg.json?.data?.user?.role));

  const partnerToken = partnerReg.json?.data?.token;
  const newRestaurantId = partnerReg.json?.data?.restaurant?.id;
  check('and a token, so they can upload documents straight away', typeof partnerToken === 'string');

  const created = newRestaurantId ? await restaurantRepository.findById(newRestaurantId) : null;
  check('The restaurant exists but is pending', created?.status === 'PENDING_APPROVAL', String(created?.status));

  // ------------------------------------------------------------------
  console.log('\n--- A pending restaurant cannot trade ---');

  resetRequestRateLimit();
  const discovery = await api('/restaurants?latitude=12.9716&longitude=77.5946');
  const listed = (discovery.json?.data?.restaurants || []).some((r: any) => r.id === newRestaurantId);
  check('It does not appear to customers browsing nearby', !listed);

  resetAuthRateLimit();
  const customerLogin = await api('/auth/login', {
    method: 'POST',
    body: { email: 'customer@quickbite.app', password: 'pass123' }
  });
  const customerToken = customerLogin.json?.data?.token;

  const orderAttempt = await api(
    '/orders',
    {
      method: 'POST',
      body: {
        restaurantId: newRestaurantId,
        deliveryAddressId: 'addr_sample_01',
        items: [{ dishId: 'dish_ck_biryani', quantity: 1 }],
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: `idem_pending_${unique}`
      }
    },
    customerToken
  );
  check('and an order placed against it directly is refused',
    orderAttempt.status === 409 || orderAttempt.status === 404,
    `status ${orderAttempt.status}`);

  // ------------------------------------------------------------------
  console.log('\n--- A rider signs themselves up ---');

  resetAuthRateLimit();
  const riderReg = await api('/auth/register/rider', {
    method: 'POST',
    body: {
      fullName: 'Arjun Nair',
      email: `arjun${unique}@rider.test`,
      phone: `97${unique}5678`.slice(0, 10),
      password: 'RiderPass123',
      vehicleType: 'BIKE',
      licenseNumber: 'KA0320240001'
    }
  });

  check('A rider can register', riderReg.status === 201,
    `status ${riderReg.status} ${JSON.stringify(riderReg.json).slice(0, 180)}`);
  check('and holds the rider role', riderReg.json?.data?.user?.role === 'rider');
  check('and starts pending approval', riderReg.json?.data?.rider?.kycStatus === 'PENDING_APPROVAL');

  const riderToken = riderReg.json?.data?.token;
  const newRiderId = riderReg.json?.data?.rider?.id;

  const shiftAttempt = await api('/riders/shift', { method: 'POST', body: { isOnline: true } }, riderToken);
  check('A pending rider cannot go on shift', shiftAttempt.status >= 400, `status ${shiftAttempt.status}`);

  // ------------------------------------------------------------------
  console.log('\n--- An administrator approves them ---');

  resetAuthRateLimit();
  const adminLogin = await api('/auth/login', {
    method: 'POST',
    body: { email: 'admin@quickbite.app', password: 'pass123' }
  });
  const adminToken = adminLogin.json?.data?.token;
  check('The administrator can sign in', Boolean(adminToken), String(adminLogin.status));

  // Documents are submitted by the applicants themselves, then reviewed.
  const partnerDoc = await api(
    '/kyc/submit',
    {
      method: 'POST',
      body: {
        entityType: 'RESTAURANT',
        entityId: newRestaurantId,
        entityName: 'Meera Rao Kitchen',
        documentType: 'FSSAI_LICENSE',
        fileUrl: 'https://example.test/fssai.jpg'
      }
    },
    partnerToken
  );
  check('The partner can submit their licence', partnerDoc.status === 200 || partnerDoc.status === 201,
    `status ${partnerDoc.status} ${JSON.stringify(partnerDoc.json).slice(0, 160)}`);

  const riderDoc = await api(
    '/kyc/submit',
    {
      method: 'POST',
      body: {
        entityType: 'RIDER',
        entityId: newRiderId,
        entityName: 'Arjun Nair',
        documentType: 'DRIVING_LICENSE',
        fileUrl: 'https://example.test/licence.jpg'
      }
    },
    riderToken
  );
  check('The rider can submit their licence', riderDoc.status === 200 || riderDoc.status === 201,
    `status ${riderDoc.status}`);

  const partnerDocId = partnerDoc.json?.data?.document?.id;
  const riderDocId = riderDoc.json?.data?.document?.id;

  const approvePartner = await api(
    '/admin/documents/review',
    { method: 'POST', body: { documentId: partnerDocId, action: 'APPROVE' } },
    adminToken
  );
  check('The administrator approves the restaurant', approvePartner.status === 200,
    `status ${approvePartner.status} ${JSON.stringify(approvePartner.json).slice(0, 160)}`);

  const approveRider = await api(
    '/admin/documents/review',
    { method: 'POST', body: { documentId: riderDocId, action: 'APPROVE' } },
    adminToken
  );
  check('and the rider', approveRider.status === 200, `status ${approveRider.status}`);

  // ------------------------------------------------------------------
  console.log('\n--- Approval is what opens the gates ---');

  const approved = newRestaurantId ? await restaurantRepository.findById(newRestaurantId) : null;
  check('The restaurant is active once approved', approved?.status === 'ACTIVE', String(approved?.status));

  resetRequestRateLimit();
  const discoveryAfter = await api('/restaurants?latitude=12.9716&longitude=77.5946');
  const listedAfter = (discoveryAfter.json?.data?.restaurants || []).some((r: any) => r.id === newRestaurantId);
  check('and now appears to customers nearby', listedAfter);

  const riderAfter = newRiderId ? await riderRepository.findById(newRiderId) : null;
  check('The rider is active once approved', riderAfter?.kycStatus === 'ACTIVE', String(riderAfter?.kycStatus));

  // ------------------------------------------------------------------
  console.log('\n--- Identity is not reusable ---');

  resetAuthRateLimit();
  const duplicateEmail = await api('/auth/register/rider', {
    method: 'POST',
    body: {
      fullName: 'Someone Else',
      email: `arjun${unique}@rider.test`,
      phone: `96${unique}9999`.slice(0, 10),
      password: 'AnotherPass123',
      vehicleType: 'EV',
      licenseNumber: 'KA0320240002'
    }
  });
  check('A second account cannot take an email already in use', duplicateEmail.status === 409,
    `status ${duplicateEmail.status}`);

  resetAuthRateLimit();
  const duplicatePhone = await api('/auth/register/partner', {
    method: 'POST',
    body: {
      fullName: 'Another Owner',
      email: `other${unique}@kitchen.test`,
      phone: `98${unique}1234`.slice(0, 10),
      password: 'OtherPass123',
      restaurantName: 'Another Kitchen',
      addressLine: '2 Brigade Road',
      city: 'Bengaluru',
      pincode: '560001',
      fssaiLicenseNumber: 'FSSAI99999999999'
    }
  });
  check('nor a mobile number already in use', duplicatePhone.status === 409, `status ${duplicatePhone.status}`);

  resetAuthRateLimit();
  const escalation = await api('/auth/register/rider', {
    method: 'POST',
    body: {
      fullName: 'Would Be Admin',
      email: `esc${unique}@rider.test`,
      phone: `95${unique}0000`.slice(0, 10),
      password: 'EscalatePass123',
      vehicleType: 'BIKE',
      licenseNumber: 'KA0320240003',
      role: 'super_admin'
    }
  });
  check(
    'A role in the request body is ignored — registration cannot mint an administrator',
    escalation.json?.data?.user?.role === 'rider',
    String(escalation.json?.data?.user?.role)
  );

  server.close();

  console.log('\n====================================================');
  if (failed === 0) {
    console.log(`     ALL ${passed} ONBOARDING CHECKS PASSED              `);
    console.log('====================================================\n');
    setTimeout(() => process.exit(0), 100);
  } else {
    console.log(`     ${failed} ONBOARDING CHECK(S) FAILED                `);
    console.log('====================================================\n');
    setTimeout(() => process.exit(1), 100);
  }
}

run().catch((err) => {
  console.error('[FAIL] Onboarding tests crashed:', err);
  process.exit(1);
});
