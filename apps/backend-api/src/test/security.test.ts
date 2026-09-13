import http from 'http';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.ts';
import { config } from '../config/env.ts';
import { seedDatabase } from '../db/seed.ts';
import { userRepository } from '../db/repositories/userRepository.ts';
import { saveStoreToFile, loadStoreFromFile, memoryStore } from '../db/client.ts';

console.log('====================================================');
console.log('    RUNNING SECURITY & PRODUCTION HARDENING TESTS   ');
console.log('====================================================\n');

async function runSecurityTests() {
  // 1. Database seed
  console.log('Step 1: Initializing database seed with bcrypt hashes...');
  await seedDatabase();

  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 2. Test Bcrypt Hashing on User Registration
    console.log('Step 2: Testing bcrypt password hashing on registration...');
    const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser@quickbite.app',
        password: 'securePassword123!',
        fullName: 'New Secure User',
        phone: '9876543210',
        role: 'customer'
      })
    });

    if (regRes.status !== 201) {
      throw new Error(`Registration failed with status ${regRes.status}`);
    }
    const regData = await regRes.json();
    const storedUser = await userRepository.findByEmail('newuser@quickbite.app');
    if (!storedUser || !storedUser.passwordHash) {
      throw new Error('User was not stored in database');
    }
    if (storedUser.passwordHash === 'securePassword123!') {
      throw new Error('SECURITY VIOLATION: Password stored in plaintext!');
    }
    const isBcrypt = await bcrypt.compare('securePassword123!', storedUser.passwordHash);
    if (!isBcrypt) {
      throw new Error('Stored password hash failed bcrypt verification');
    }
    console.log('[PASS] Step 2: Password securely hashed with bcrypt (hash starts with $2a/$2b)');

    // 3. Test Login with Real JWT Generation
    console.log('Step 3: Testing login and cryptographic JWT signing...');
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser@quickbite.app',
        password: 'securePassword123!'
      })
    });
    if (loginRes.status !== 200) {
      throw new Error(`Login failed with status ${loginRes.status}`);
    }
    const loginData = await loginRes.json();
    const token = loginData.data.token;
    if (!token) throw new Error('No token returned on login');

    // Cryptographically verify token
    const decoded = jwt.verify(token, config.JWT_SECRET) as any;
    if (decoded.sub !== storedUser.id || decoded.role !== 'customer') {
      throw new Error('JWT claims mismatch');
    }
    console.log('[PASS] Step 3: Real HS256 JWT issued and cryptographically verified');

    // 4. Test Tampered JWT Rejection
    console.log('Step 4: Testing tampered JWT rejection...');
    const parts = token.split('.');
    const fakePayload = Buffer.from(JSON.stringify({
      sub: storedUser.id,
      email: storedUser.email,
      role: 'super_admin' // Privilege escalation attempt!
    })).toString('base64url');
    const tamperedToken = `${parts[0]}.${fakePayload}.${parts[2]}`;

    const tamperedRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { 'Authorization': `Bearer ${tamperedToken}` }
    });
    if (tamperedRes.status !== 401) {
      throw new Error(`Expected 401 on tampered JWT, got ${tamperedRes.status}`);
    }
    console.log('[PASS] Step 4: Tampered JWT with forged role correctly rejected with 401');

    // 5. Test Admin Route Protection (Anonymous blocked)
    console.log('Step 5: Testing admin route protection against unauthenticated access...');
    const anonAdminRes = await fetch(`${baseUrl}/api/v1/admin/metrics`);
    if (anonAdminRes.status !== 401) {
      throw new Error(`Expected 401 on anonymous admin access, got ${anonAdminRes.status}`);
    }
    console.log('[PASS] Step 5: Anonymous access to admin endpoints blocked with 401');

    // 6. Test Admin Route Protection (Customer token rejected with 403)
    console.log('Step 6: Testing admin route RBAC against unauthorized role...');
    const customerAdminRes = await fetch(`${baseUrl}/api/v1/admin/metrics`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (customerAdminRes.status !== 403) {
      throw new Error(`Expected 403 Forbidden for customer role on admin route, got ${customerAdminRes.status}`);
    }
    console.log('[PASS] Step 6: Customer role forbidden from accessing admin endpoints (403)');

    // 7. Test Admin Login and Authorized Access
    console.log('Step 7: Testing admin access with legitimate admin token...');
    const adminLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@quickbite.app',
        password: 'pass123',
        role: 'admin'
      })
    });
    const adminToken = (await adminLoginRes.json()).data.token;
    const adminRes = await fetch(`${baseUrl}/api/v1/admin/metrics`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (adminRes.status !== 200) {
      throw new Error(`Admin failed to access metrics, got ${adminRes.status}`);
    }
    console.log('[PASS] Step 7: Legitimate admin granted access to admin tower metrics (200)');

    // 8. Test Wallet Ownership Protection
    console.log('Step 8: Testing wallet ownership isolation...');
    // Attempt to access another user's wallet with customer token
    const otherWalletRes = await fetch(`${baseUrl}/api/v1/wallets/usr_admin_01`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (otherWalletRes.status !== 403) {
      throw new Error(`Expected 403 when accessing another user's wallet, got ${otherWalletRes.status}`);
    }
    // Access own wallet
    const ownWalletRes = await fetch(`${baseUrl}/api/v1/wallets/${storedUser.id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (ownWalletRes.status !== 200) {
      throw new Error(`Expected 200 on own wallet, got ${ownWalletRes.status}`);
    }
    console.log('[PASS] Step 8: Wallet data strictly isolated to owner; foreign access blocked (403)');

    // 9. Test Restaurant Mutation Route Protection
    console.log('Step 9: Testing restaurant mutation protection...');
    const unauthStockRes = await fetch(`${baseUrl}/api/v1/restaurants/rst_bbh_01/menu/toggle-stock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` // Customer token, not restaurant_owner
      },
      body: JSON.stringify({ dishId: 'dish_ck_biryani', isAvailable: false })
    });
    if (unauthStockRes.status !== 403) {
      throw new Error(`Expected 403 for non-owner stock toggle, got ${unauthStockRes.status}`);
    }
    console.log('[PASS] Step 9: Restaurant mutation endpoints protected with role check (403)');

    // 10. Test New Endpoints: GET /orders and GET /restaurants/:id/orders
    console.log('Step 10: Testing new GET orders endpoints...');
    const ordersRes = await fetch(`${baseUrl}/api/v1/orders`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (ordersRes.status !== 200) {
      throw new Error(`GET /orders failed with status ${ordersRes.status}`);
    }
    console.log('[PASS] Step 10: GET /api/v1/orders endpoint operational');

    // 11. Test JSON File Persistence
    console.log('Step 11: Testing JSON file persistence and hydration...');
    saveStoreToFile();
    const loaded = loadStoreFromFile();
    if (!loaded) {
      throw new Error('Failed to load store from persistent JSON file');
    }
    if (!memoryStore.users.has('newuser@quickbite.app')) {
      // Find by email in loaded users
      const userFound = Array.from(memoryStore.users.values()).some((u: any) => u.email === 'newuser@quickbite.app');
      if (!userFound) {
        throw new Error('Persisted user not found in hydrated memoryStore');
      }
    }
    console.log('[PASS] Step 11: Database state successfully persisted to and hydrated from disk');

    /*
     * Steps 12-16 are regression tests for vulnerabilities found in the September 2026
     * audit. Each one describes an attack that used to succeed against this server.
     */

    console.log('Step 12: Testing that self-registration cannot claim a staff role...');
    const escalationRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'escalate@quickbite.app',
        password: 'securePassword123!',
        fullName: 'Privilege Escalation Attempt',
        role: 'super_admin'
      })
    });
    if (escalationRes.status === 201) {
      const created = await escalationRes.json();
      if (created.data?.user?.role !== 'customer') {
        throw new Error(
          `Registration honoured a caller-supplied role: got '${created.data?.user?.role}'. ` +
            'Anyone could mint an administrator account.'
        );
      }
    } else if (escalationRes.status !== 400) {
      throw new Error(`Unexpected status ${escalationRes.status} registering with role=super_admin`);
    }
    console.log('[PASS] Step 12: Caller-supplied role ignored; self-registration yields a customer');

    console.log('Step 13: Testing that a user cannot credit their own wallet...');
    const selfCreditRes = await fetch(`${baseUrl}/api/v1/wallets/${storedUser.id}/credit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ amount: 999999, description: 'free money' })
    });
    if (selfCreditRes.status !== 403) {
      throw new Error(
        `Self wallet credit returned ${selfCreditRes.status}, expected 403. ` +
          'A customer could top themselves up without paying.'
      );
    }
    console.log('[PASS] Step 13: Wallet credits rejected for non-staff (403)');

    console.log('Step 14: Testing that a customer cannot drive another order\'s status...');
    // Place a genuine order as the seeded customer, then attack it from the unrelated
    // account created in step 2.
    const victimLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'customer@quickbite.app', password: 'pass123' })
    });
    const victimToken = (await victimLogin.json()).data?.token;

    const victimAddress = Array.from(memoryStore.addresses.values()).find(
      (a: any) => a.userId === 'usr_customer_01'
    ) as any;
    const victimMenu = await (await fetch(`${baseUrl}/api/v1/restaurants/rst_bbh_01/menu`)).json();
    const firstDish = victimMenu?.data?.menu?.categories?.[0]?.items?.[0];

    let foreignOrderId = '';
    if (victimToken && victimAddress && firstDish) {
      const placed = await fetch(`${baseUrl}/api/v1/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${victimToken}` },
        body: JSON.stringify({
          restaurantId: 'rst_bbh_01',
          deliveryAddressId: victimAddress.id,
          items: [{ dishId: firstDish.id, quantity: 1 }],
          paymentMethod: 'CASH_ON_DELIVERY',
          idempotencyKey: `sec-test-${Date.now()}`
        })
      });
      foreignOrderId = (await placed.json())?.data?.order?.id || '';
    }

    if (foreignOrderId) {
      const statusRes = await fetch(`${baseUrl}/api/v1/orders/${foreignOrderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'ACCEPTED' })
      });
      if (statusRes.status !== 403) {
        throw new Error(
          `Order status transition by an unrelated customer returned ${statusRes.status}, expected 403.`
        );
      }
      console.log('[PASS] Step 14: Order transitions restricted to the parties on the order (403)');
    } else {
      console.log('[SKIP] Step 14: no seeded order available to test against');
    }

    console.log('Step 15: Testing that the search reindex is not publicly triggerable...');
    const syncRes = await fetch(`${baseUrl}/api/v1/search/sync`, { method: 'POST' });
    if (syncRes.status !== 401 && syncRes.status !== 403) {
      throw new Error(`Unauthenticated POST /search/sync returned ${syncRes.status}, expected 401/403.`);
    }
    console.log('[PASS] Step 15: Catalogue reindex requires authentication');

    console.log('Step 16: Testing that login is rate limited against brute force...');
    let sawRateLimit = false;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const guess = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'newuser@quickbite.app', password: `wrong-${attempt}` })
      });
      if (guess.status === 429) {
        sawRateLimit = true;
        break;
      }
    }
    if (!sawRateLimit) {
      throw new Error('15 consecutive failed logins were accepted without a 429; brute force is unthrottled.');
    }
    console.log('[PASS] Step 16: Repeated failed logins throttled with 429');

    console.log('\n====================================================');
    console.log('  ALL SECURITY & PRODUCTION HARDENING CHECKS PASSED! ');
    console.log('====================================================\n');
  } finally {
    server.close();
  }
}

runSecurityTests().catch((err) => {
  console.error('\n[FAIL] Security test failed:', err);
  process.exit(1);
});
