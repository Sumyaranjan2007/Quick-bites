/**
 * Replacing and re-verifying documents (owner, 18 Oct 2026).
 *
 *   - A rider (and a partner, see accountBlocking/partner) may replace ANY
 *     document, approved or not; the replacement is checked again.
 *   - While it waits, or if it is refused, the approved one keeps standing:
 *     the rider stays verified and can go on shift; the new licence number
 *     reaches the profile only when an admin approves it.
 *   - An admin may re-verify (withdraw) an approved document at any time; once
 *     a replacement was approved, withdrawing it leaves nothing standing.
 */
import assert from 'node:assert/strict';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';

const PORT = 5311;
const API = `http://127.0.0.1:${PORT}/api`;
const RIDER = 'rdr_vikram_01';
const PHOTO = 'data:image/png;base64,iVBORw0KGgo=';

let passed = 0;
let failed = 0;
function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 400)}`);
  }
}
async function api(pathname: string, init: any = {}, token?: string) {
  resetAuthRateLimit();
  const res = await fetch(`${API}${pathname}`, {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15000),
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
const login = async (email: string) =>
  (await api('/auth/login', { method: 'POST', body: { email, password: 'pass123' } })).json?.data?.token as string;
const licence = (docs: any) => (docs.json?.data?.documents || []).find((d: any) => d.documentType === 'DRIVING_LICENSE');
const rider = () => memoryStore.riders.get(RIDER) as any;
const review = (token: string, documentId: string, action: string, rejectionReason?: string) =>
  api('/admin/documents/review', { method: 'POST', body: { documentId, action, rejectionReason } }, token);

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

try {
  const riderToken = await login('rider@quickbite.app');
  const admin = await login('admin@quickbite.app');
  const oldNumber = rider().licenseNumber;

  const replaced = await api('/riders/documents', { method: 'POST', body: { documentType: 'DRIVING_LICENSE', documentNumber: 'KA05 2026 0001234', fileUrl: PHOTO } }, riderToken);
  it('A rider can replace an approved licence (it is checked again)', () => assert.equal(replaced.status, 201, JSON.stringify(replaced.json).slice(0, 200)));

  const waiting = licence(await api('/riders/documents', {}, riderToken));
  it('While it waits, the app shows "in review" with the old one still verified', () => {
    assert.equal(waiting?.status, 'PENDING');
    assert.equal(waiting?.stillVerified, true);
    assert.equal(waiting?.canReupload, true);
  });
  it('...and the new number is not on the profile before an admin checks it', () => assert.equal(rider().licenseNumber, oldNumber));
  const shift = await api('/riders/shift', { method: 'POST', body: { isOnline: true } }, riderToken);
  it('...and the rider can still go on shift', () => assert.equal(shift.status, 200, JSON.stringify(shift.json).slice(0, 200)));
  await api('/riders/shift', { method: 'POST', body: { isOnline: false } }, riderToken);

  const again = await api('/riders/documents', { method: 'POST', body: { documentType: 'DRIVING_LICENSE', documentNumber: 'KA05 2026 0001235', fileUrl: PHOTO } }, riderToken);
  it('A waiting replacement can be replaced; only one waits', () => {
    assert.equal(again.status, 201);
    const pending = [...memoryStore.kycDocuments.values()].filter((d: any) => d.entityId === RIDER && d.documentType === 'DRIVING_LICENSE' && d.status === 'PENDING');
    assert.equal(pending.length, 1);
  });

  await review(admin, again.json?.data?.document?.id, 'REJECT', 'Photo is blurred.');
  const refused = licence(await api('/riders/documents', {}, riderToken));
  it('A refused replacement: the reason is shown and the old licence still stands', () => {
    assert.equal(refused?.status, 'REJECTED');
    assert.equal(refused?.rejectionReason, 'Photo is blurred.');
    assert.equal(refused?.stillVerified, true);
    assert.equal(rider().kycStatus, 'ACTIVE');
  });

  const record = await api(`/admin/records/rider/${RIDER}`, {}, admin);
  const licences = (record.json?.data?.documents || []).flatMap((g: any) => g.items).filter((d: any) => d.documentType === 'DRIVING_LICENSE');
  it("Admin's record: the refused upload is current and the approved one is marked as still counting", () => {
    assert.equal(licences.find((d: any) => d.current)?.status, 'REJECTED');
    assert.equal(licences.find((d: any) => d.standing)?.status, 'APPROVED');
    assert.equal(licences.filter((d: any) => d.current).length, 1);
  });

  const third = await api('/riders/documents', { method: 'POST', body: { documentType: 'DRIVING_LICENSE', documentNumber: 'KA05 2026 0001236', fileUrl: PHOTO } }, riderToken);
  const approved = await review(admin, third.json?.data?.document?.id, 'APPROVE');
  it("Approving the replacement puts its number on the rider's profile", () => {
    assert.equal(approved.status, 200);
    assert.equal(rider().licenseNumber, 'KA05 2026 0001236');
    assert.equal(rider().kycStatus, 'ACTIVE');
  });

  const withdraw = await review(admin, third.json?.data?.document?.id, 'REJECT', 'Licence suspended by RTO.');
  const after = licence(await api('/riders/documents', {}, riderToken));
  it('Re-verifying: an admin can withdraw an approved licence, and no older one comes back', () => {
    assert.equal(withdraw.status, 200);
    assert.equal(after?.status, 'REJECTED');
    assert.equal(after?.stillVerified, false);
    assert.equal(rider().kycStatus, 'REJECTED');
  });
  const blocked = await api('/riders/shift', { method: 'POST', body: { isOnline: true } }, riderToken);
  it('...and the rider cannot go on shift until a new one is approved', () => assert.equal(blocked.status, 409));

  const reapprove = await review(admin, third.json?.data?.document?.id, 'APPROVE');
  it('An admin can approve it again; the old refusal reason is cleared', () => {
    assert.equal(reapprove.status, 200);
    const doc = memoryStore.kycDocuments.get(third.json?.data?.document?.id) as any;
    assert.equal(doc.status, 'APPROVED');
    assert.equal(doc.rejectionReason, undefined);
    assert.equal(rider().kycStatus, 'ACTIVE');
  });
} finally {
  await new Promise(r => server.close(() => r(null)));
}

console.log(`\n  ${passed} passed, ${failed} failed`);
// A moment for Node to finish closing handles: exiting mid-close crashes it on Windows.
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
