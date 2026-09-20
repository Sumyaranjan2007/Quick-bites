import bcrypt from 'bcryptjs';
import { memoryStore, triggerAutoSave } from './client.ts';
import { userRepository } from './repositories/userRepository.ts';
import { walletRepository } from './repositories/walletRepository.ts';

/**
 * A delivery partner account that can actually be signed into.
 *
 * The seeded accounts take their password from `SEED_DEFAULT_PASSWORD`, and on a
 * deployment where that was unset when the store was first written they were
 * given a random one — so nobody can sign in as a rider to check that live
 * tracking, offers or the trip flow work. Re-seeding would fix it and destroy
 * every real order in the process, so it is not an option on a live deployment.
 *
 * This runs on every boot, like the system roles beside it, and is idempotent:
 * it provisions the account the first time and resets its password to the
 * configured value on later boots, so the operator can always get back in by
 * changing the variable and redeploying.
 *
 * Deliberately opt-in. With `TEST_RIDER_EMAIL` and `TEST_RIDER_PASSWORD` unset
 * nothing is created at all — a known-password account is a liability on a
 * deployment nobody asked for one on, and a password committed to a public
 * repository would be worse. The operator chooses the credential; this file
 * never contains one.
 */
export async function ensureTestRider(): Promise<void> {
  const email = String(process.env.TEST_RIDER_EMAIL || '').trim().toLowerCase();
  const password = process.env.TEST_RIDER_PASSWORD || '';

  if (!email || !password) return;

  if (password.length < 8) {
    console.warn('[test-rider] TEST_RIDER_PASSWORD is shorter than 8 characters; refusing to provision.');
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await userRepository.findByEmail(email);

  const user = existing
    ? await userRepository.update(existing.id, { passwordHash, role: 'rider' })
    : await userRepository.create({
        id: `usr_testrider_${Date.now()}`,
        email,
        passwordHash,
        fullName: process.env.TEST_RIDER_NAME || 'Test Delivery Partner',
        phone: process.env.TEST_RIDER_PHONE || '9000000001',
        role: 'rider',
        isGold: false,
        preferredLanguage: 'en'
      });

  if (!user) return;

  // The rider profile is what dispatch actually looks at. Without it the account
  // signs in and then has nothing to go on shift with.
  let rider = Array.from(memoryStore.riders.values()).find((r: any) => r.userId === user.id);
  if (!rider) {
    rider = {
      id: `rdr_test_${Date.now()}`,
      userId: user.id,
      driverCode: 'QB-RID-TEST',
      fullName: user.fullName,
      phone: user.phone,
      vehicleType: 'BIKE',
      licenseNumber: 'TESTLICENCE0001',
      vehicleRcNumber: 'KA01TEST0001',
      // Verified on purpose: this account exists to exercise the trip flow, and
      // a partner stuck in document review cannot be handed a delivery.
      kycStatus: 'ACTIVE',
      isOnline: false,
      codCashInHand: 0,
      offersReceived: 0,
      offersAccepted: 0,
      // Near the seeded restaurants, so offers are actually within range.
      currentCoordinates: { latitude: 12.683, longitude: 77.476 },
      createdAt: new Date().toISOString()
    };
    memoryStore.riders.set(rider.id, rider);
  } else {
    // A previously suspended test account should come back usable.
    rider.kycStatus = 'ACTIVE';
    memoryStore.riders.set(rider.id, rider);
  }

  // getByUserId creates the wallet if the rider has none, which is what we want
  // here: earnings have somewhere to land the first time a trip completes.
  await walletRepository.getByUserId(user.id);

  triggerAutoSave();

  console.log(
    JSON.stringify({
      level: 'INFO',
      timestamp: new Date().toISOString(),
      event: 'TEST_RIDER_PROVISIONED',
      email,
      riderId: rider.id,
      driverCode: rider.driverCode,
      // Never the password.
      note: 'Signs in with TEST_RIDER_PASSWORD from the environment.'
    })
  );
}
