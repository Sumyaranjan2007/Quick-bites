/**
 * Phone sign-in.
 *
 * A customer is a phone number and a six-digit code, so this endpoint is the
 * entire front door to every customer account on the platform. The checks below
 * are written against the ways that door gets kicked in: guessing the code,
 * replaying one that was already used, keeping a code alive past its life,
 * asking whether a given number has an account, and — the one that is easy to
 * miss — a fixed test code surviving into production.
 */
import http from 'http';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { otpService } from '../modules/auth/otpService.ts';
import { userRepository } from '../db/repositories/userRepository.ts';
import { config } from '../config/env.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';

console.log('====================================================');
console.log('        RUNNING PHONE / OTP SIGN-IN TESTS           ');
console.log('====================================================\n');

const PORT = 4600 + Math.floor(Math.random() * 300);
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

async function api(path: string, options: { method?: string; body?: any } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
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

const FIXED = config.OTP_FIXED_CODE;

async function run() {
  await seedDatabase();
  const app = createApp();
  const server = app.listen(PORT, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));

  // ------------------------------------------------------------------
  resetAuthRateLimit();
  console.log('--- A number nobody holds becomes an account ---');

  const newNumber = '9812' + String(Math.floor(100000 + Math.random() * 899999));
  otpService.forget(newNumber);

  const requested = await api('/auth/otp/request', { method: 'POST', body: { phone: newNumber } });
  check('A code can be requested for an unrecognised number', requested.status === 200,
    `status ${requested.status}`);
  check('The response never contains the code itself',
    !JSON.stringify(requested.json).includes(FIXED),
    'the code was echoed back to the caller');

  const wrong = await api('/auth/otp/verify', { method: 'POST', body: { phone: newNumber, code: '000000' } });
  check('A wrong code is refused', wrong.status === 400);

  const verified = await api('/auth/otp/verify', {
    method: 'POST',
    body: { phone: newNumber, code: FIXED, fullName: 'New Customer' }
  });
  check('The right code signs in', verified.status === 200, `status ${verified.status}`);
  check('and the account was created on first verification', verified.json?.data?.isNewAccount === true);
  check('with the customer role, never anything higher', verified.json?.data?.user?.role === 'customer');
  check('and a usable token', typeof verified.json?.data?.token === 'string' && verified.json.data.token.length > 20);

  const stored = await userRepository.findByPhone(newNumber);
  check('The account is findable by phone number afterwards', stored !== null);

  // ------------------------------------------------------------------
  resetAuthRateLimit();
  console.log('\n--- A code is good once, briefly ---');

  const replay = await api('/auth/otp/verify', { method: 'POST', body: { phone: newNumber, code: FIXED } });
  check('The same code cannot be used twice', replay.status === 400, `status ${replay.status}`);

  await api('/auth/otp/request', { method: 'POST', body: { phone: newNumber } });
  const returning = await api('/auth/otp/verify', { method: 'POST', body: { phone: newNumber, code: FIXED } });
  check('A returning customer signs into the SAME account', returning.json?.data?.user?.id === stored?.id);
  check('and is not told they are new', returning.json?.data?.isNewAccount === false);

  // ------------------------------------------------------------------
  resetAuthRateLimit();
  console.log('\n--- Guessing is capped ---');

  const guessNumber = '9823' + String(Math.floor(100000 + Math.random() * 899999));
  otpService.forget(guessNumber);
  await api('/auth/otp/request', { method: 'POST', body: { phone: guessNumber } });

  for (let i = 0; i < config.OTP_MAX_ATTEMPTS; i++) {
    await api('/auth/otp/verify', { method: 'POST', body: { phone: guessNumber, code: '111111' } });
  }
  const afterCap = await api('/auth/otp/verify', { method: 'POST', body: { phone: guessNumber, code: FIXED } });
  check(
    'After the attempt cap even the correct code is refused — the code is destroyed, not merely locked',
    afterCap.status === 400,
    `status ${afterCap.status}`
  );

  // ------------------------------------------------------------------
  resetAuthRateLimit();
  console.log('\n--- The endpoint answers nothing about who has an account ---');

  const known = await api('/auth/otp/request', { method: 'POST', body: { phone: '9876543210' } });
  const unknown = await api('/auth/otp/request', { method: 'POST', body: { phone: '9111100000' } });
  check('A known and an unknown number get the same status', known.status === unknown.status);
  check(
    'and the same message — no way to ask whether someone is a customer',
    known.json?.message === unknown.json?.message,
    `${known.json?.message} vs ${unknown.json?.message}`
  );
  check(
    'The apps are told whether SMS delivery exists at all, which is a property of the deployment',
    typeof known.json?.data?.deliveryConfigured === 'boolean'
  );

  // ------------------------------------------------------------------
  resetAuthRateLimit();
  console.log('\n--- Rubbish input ---');

  const shortNumber = await api('/auth/otp/request', { method: 'POST', body: { phone: '12345' } });
  check('A number that is not a mobile number is rejected', shortNumber.status === 400);

  const landline = await api('/auth/otp/request', { method: 'POST', body: { phone: '1234567890' } });
  check('An Indian mobile must start 6-9', landline.status === 400);

  const spaced = await api('/auth/otp/request', { method: 'POST', body: { phone: '+91 98765 43210' } });
  check('A number typed with +91 and spaces is the same number', spaced.status === 200);

  // ------------------------------------------------------------------
  resetAuthRateLimit();
  console.log('\n--- Staff cannot be minted or hijacked through this door ---');

  // The seeded partner's phone. Verifying it must not produce a partner token.
  const partner = await userRepository.findByEmail('partner@quickbite.app');
  if (partner?.phone) {
    await api('/auth/otp/request', { method: 'POST', body: { phone: partner.phone } });
    const staffAttempt = await api('/auth/otp/verify', {
      method: 'POST',
      body: { phone: partner.phone, code: FIXED }
    });
    check(
      "A staff member's number does not hand out a staff token through phone sign-in",
      staffAttempt.status === 403,
      `status ${staffAttempt.status} role ${staffAttempt.json?.data?.user?.role}`
    );
  } else {
    check('Seeded partner has a phone number to test against', false, 'no phone on partner account');
  }

  // ------------------------------------------------------------------
  resetAuthRateLimit();
  console.log('\n--- A fixed code must not survive into production ---');

  // Simulated rather than deployed: the service reads configuration on every
  // request precisely so a host flipping a variable cannot leave a running
  // process issuing codes it should not.
  const realIsProduction = (config as any).IS_PRODUCTION;
  const realAllow = (config as any).OTP_ALLOW_FIXED_IN_PRODUCTION;

  (config as any).IS_PRODUCTION = true;
  (config as any).OTP_ALLOW_FIXED_IN_PRODUCTION = false;
  const inProduction = await api('/auth/otp/request', { method: 'POST', body: { phone: '9876500001' } });
  check(
    'With a fixed code and no SMS provider, production refuses to issue codes at all',
    inProduction.status === 503,
    `status ${inProduction.status}`
  );

  (config as any).OTP_ALLOW_FIXED_IN_PRODUCTION = true;
  const allowed = await api('/auth/otp/request', { method: 'POST', body: { phone: '9876500001' } });
  check(
    'and permits them only when the tester-phase variable is set deliberately',
    allowed.status === 200,
    `status ${allowed.status}`
  );

  (config as any).IS_PRODUCTION = realIsProduction;
  (config as any).OTP_ALLOW_FIXED_IN_PRODUCTION = realAllow;

  // ------------------------------------------------------------------
  resetAuthRateLimit();
  console.log('\n--- The email recovery flow is gone, not merely unused ---');

  const forgot = await api('/auth/forgot-password', { method: 'POST', body: { email: 'customer@quickbite.app' } });
  check('POST /auth/forgot-password no longer exists', forgot.status === 404, `status ${forgot.status}`);
  const reset = await api('/auth/reset-password', { method: 'POST', body: { email: 'x@y.z', code: '1', newPassword: 'aaaaaaaaaa' } });
  check('POST /auth/reset-password no longer exists', reset.status === 404, `status ${reset.status}`);

  server.close();

  console.log('\n====================================================');
  if (failed === 0) {
    console.log(`        ALL ${passed} PHONE SIGN-IN CHECKS PASSED          `);
    console.log('====================================================\n');
    setTimeout(() => process.exit(0), 100);
  } else {
    console.log(`        ${failed} PHONE SIGN-IN CHECK(S) FAILED            `);
    console.log('====================================================\n');
    setTimeout(() => process.exit(1), 100);
  }
}

run().catch((err) => {
  console.error('[FAIL] Phone sign-in tests crashed:', err);
  process.exit(1);
});
