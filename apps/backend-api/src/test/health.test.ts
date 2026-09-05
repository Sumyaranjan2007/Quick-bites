import { createApp } from '../app.ts';
import http from 'http';

console.log('====================================================');
console.log('  RUNNING CHUNK 02 INTEGRATION VERIFICATION TESTS   ');
console.log('====================================================\n');

const app = createApp();
const server = http.createServer(app);

server.listen(0, async () => {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to obtain ephemeral port for test server.');
  }
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Test 1: GET /health returns 200 and HEALTHY status
    console.log('Test 1: Testing GET /health ...');
    const healthRes = await fetch(`${baseUrl}/health`);
    if (healthRes.status !== 200) {
      throw new Error(`Expected status 200, got ${healthRes.status}`);
    }
    const healthData = await healthRes.json();
    if (healthData.status !== 'HEALTHY') {
      throw new Error(`Expected status HEALTHY, got ${healthData.status}`);
    }
    console.log('[PASS] Test 1: GET /health returns 200 HEALTHY');

    // Test 2: Correlation ID header propagation
    console.log('Test 2: Verifying X-Correlation-ID header ...');
    const testCorrelationId = 'req_custom_test_12345';
    const corrRes = await fetch(`${baseUrl}/health`, {
      headers: { 'X-Correlation-ID': testCorrelationId }
    });
    const returnedCorrId = corrRes.headers.get('x-correlation-id');
    if (returnedCorrId !== testCorrelationId) {
      throw new Error(`Correlation ID mismatch: expected ${testCorrelationId}, got ${returnedCorrId}`);
    }
    console.log('[PASS] Test 2: X-Correlation-ID propagated correctly');

    // Test 3: Security Headers (Helmet)
    console.log('Test 3: Verifying HTTP Security Headers ...');
    if (corrRes.headers.get('x-frame-options') !== 'DENY') {
      throw new Error('X-Frame-Options: DENY header missing or incorrect');
    }
    if (corrRes.headers.get('x-content-type-options') !== 'nosniff') {
      throw new Error('X-Content-Type-Options: nosniff header missing');
    }
    console.log('[PASS] Test 3: Security headers (X-Frame-Options, nosniff) verified');

    // Test 4: Zod Validation Middleware on /api/v1/test/echo
    console.log('Test 4: Testing Zod validation on /api/v1/test/echo ...');
    const invalidRes = await fetch(`${baseUrl}/api/v1/test/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' }) // Invalid: message min length is 1
    });
    if (invalidRes.status !== 400) {
      throw new Error(`Expected 400 Bad Request on invalid payload, got ${invalidRes.status}`);
    }
    const invalidData = await invalidRes.json();
    if (invalidData.error?.code !== 'VALIDATION_ERROR') {
      throw new Error(`Expected error code VALIDATION_ERROR, got ${invalidData.error?.code}`);
    }
    console.log('[PASS] Test 4: Zod validation rejects invalid request with 400');

    // Test 5: Auth Middleware with Demo Customer Token
    console.log('Test 5: Testing Auth Middleware with Demo Token ...');
    const authRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { 'Authorization': 'Bearer demo-customer-token' }
    });
    if (authRes.status !== 200) {
      throw new Error(`Expected 200 OK with demo token, got ${authRes.status}`);
    }
    const authData = await authRes.json();
    if (authData.data?.user?.role !== 'customer') {
      throw new Error(`Expected customer role, got ${authData.data?.user?.role}`);
    }
    console.log('[PASS] Test 5: Demo customer authentication verified');

    // Test 6: 404 Route Handling
    console.log('Test 6: Testing 404 handler on non-existent route ...');
    const notFoundRes = await fetch(`${baseUrl}/api/v1/non-existent-route`);
    if (notFoundRes.status !== 404) {
      throw new Error(`Expected 404, got ${notFoundRes.status}`);
    }
    const notFoundData = await notFoundRes.json();
    if (notFoundData.error?.code !== 'NOT_FOUND') {
      throw new Error(`Expected NOT_FOUND code, got ${notFoundData.error?.code}`);
    }
    console.log('[PASS] Test 6: 404 error handler returned standard error envelope');

    console.log('\n====================================================');
    console.log('  ALL 6 INTEGRATION CHECKS PASSED SUCCESSFULLY!     ');
    console.log('====================================================\n');
    server.close();
    setTimeout(() => {
      process.exit(0);
    }, 100);
  } catch (err: any) {
    console.error('\n[FAIL] Test failed:', err.message);
    server.close();
    setTimeout(() => {
      process.exit(1);
    }, 100);
  }
});
