/**
 * One record per person (master plan B7, #11).
 *
 * What must hold:
 *  - Admin → People → restaurant | rider | customer → Record returns, for that
 *    one person: documents grouped by type (no file bodies in the list),
 *    photos, support tickets and refund cases, and the audit history;
 *  - each part needs its own permission: no `users.<kind>.view` → refused; no
 *    `documents.view` / `support.tickets.view` / `admin.audit.view` → that part
 *    is withheld (null), never leaked;
 *  - each document downloads, but only through the person it belongs to, and
 *    "Download all" returns every file as one ZIP; both are written to the
 *    audit log (identity papers);
 *  - only staff reach any of it.
 */
import assert from 'node:assert/strict';
import http from 'http';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';
import { kycRepository } from '../db/repositories/kycRepository.ts';
import { supportRepository } from '../db/repositories/supportRepository.ts';
import { auditRepository } from '../db/repositories/auditRepository.ts';

let passed = 0;
let failed = 0;
function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 400)}`);
  }
}

await seedDatabase();
const server = http.createServer(createApp());
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const API = `http://127.0.0.1:${(server.address() as any).port}/api`;

async function get(pathname: string, token?: string) {
  const res = await fetch(`${API}${pathname}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    redirect: 'manual',
    signal: AbortSignal.timeout(15000)
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json: any = null;
  try { json = JSON.parse(buf.toString('utf8')); } catch { /* a file */ }
  return { status: res.status, type: res.headers.get('content-type') || '', disposition: res.headers.get('content-disposition') || '', location: res.headers.get('location'), buf, json };
}
async function login(email: string) {
  resetAuthRateLimit();
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'pass123' })
  });
  return ((await res.json()) as any)?.data?.token as string;
}
/** File names in a ZIP's central directory. */
const zipNames = (buf: Buffer) => {
  const names: string[] = [];
  for (let i = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); i >= 0; i = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), i + 4)) {
    names.push(buf.subarray(i + 46, i + 46 + buf.readUInt16LE(i + 28)).toString('utf8'));
  }
  return names;
};

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const aadhaar = await kycRepository.submitDocument({
  entityType: 'RIDER', entityId: 'rdr_vikram_01', entityName: 'Vikram Singh', documentType: 'AADHAAR',
  documentNumber: '1234 5678 9012', fileUrl: `data:image/png;base64,${PNG.toString('base64')}`
} as any);
const missing = await kycRepository.submitDocument({
  entityType: 'RIDER', entityId: 'rdr_vikram_01', entityName: 'Vikram Singh', documentType: 'INSURANCE', fileUrl: ''
} as any);
const ticket = await supportRepository.create({
  raisedByUserId: 'usr_rider_01', raisedByRole: 'rider', raisedByName: 'Vikram Singh', subject: 'Payout late',
  category: 'PAYMENT', message: 'My payout has not arrived yet', attachments: []
} as any);
await auditRepository.record({
  actorUserId: 'usr_admin_01', actorName: 'Admin', actorRole: 'super_admin', action: 'RIDER_APPROVED',
  entityType: 'RIDER', entityId: 'rdr_vikram_01', summary: 'Approved Vikram Singh'
} as any);
await auditRepository.record({
  actorUserId: 'usr_admin_01', actorName: 'Admin', actorRole: 'super_admin', action: 'RIDER_APPROVED',
  entityType: 'RIDER', entityId: 'rdr_someone_else', summary: 'Approved somebody else'
} as any);

try {
  const admin = await login('admin@quickbite.app');
  const ops = await login('ops@quickbite.app');
  const finance = await login('finance@quickbite.app');
  const support = await login('support@quickbite.app');
  const partner = await login('partner@quickbite.app');
  const RIDER = '/admin/records/rider/rdr_vikram_01';

  console.log('\n-- A rider\'s record, everything');
  const r = await get(RIDER, admin);
  const rec = r.json?.data;
  it('Super admin gets the record', () => assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 200)));
  it('...names the person and their account', () => {
    assert.equal(rec.name, 'Vikram Singh');
    assert.equal(rec.userId, 'usr_rider_01');
  });
  const group = (title: string) => rec.documents.find((g: any) => g.group === title);
  it('Documents grouped by type: licences, identity', () => {
    assert.ok(group('Licences').items.some((d: any) => d.documentType === 'DRIVING_LICENSE'));
    assert.ok(group('Identity').items.some((d: any) => d.id === aadhaar.id));
  });
  it('...with status, date and how to get the file, never the file itself', () => {
    const doc = group('Identity').items.find((d: any) => d.id === aadhaar.id);
    assert.equal(doc.status, 'PENDING');
    assert.ok(doc.submittedAt);
    assert.equal(doc.file, 'image');
    assert.equal(doc.downloadPath, `/api/admin/records/rider/rdr_vikram_01/documents/${aadhaar.id}/file`);
    assert.ok(!JSON.stringify(rec.documents).includes('base64'), 'a file body is in the document list');
  });
  it('Aadhaar number shows only its last 4 digits', () => {
    const doc = group('Identity').items.find((d: any) => d.id === aadhaar.id);
    assert.equal(doc.documentNumber, 'XXXX XXXX 9012');
  });
  it('A document with no file says so', () =>
    assert.equal(group('Licences').items.find((d: any) => d.id === missing.id)?.file, 'missing'));
  it('Photos: the rider\'s profile photo', () => assert.ok(rec.photos.some((p: any) => p.label === 'Profile photo' && p.url)));
  it('Support: their tickets', () => assert.ok(rec.support.tickets.some((t: any) => t.id === ticket.id)));
  it('History: audit lines about them, and not about anybody else', () => {
    assert.ok(rec.history.some((h: any) => h.summary === 'Approved Vikram Singh'));
    assert.ok(!rec.history.some((h: any) => h.summary === 'Approved somebody else'));
  });

  console.log('\n-- Each part needs its own permission');
  const fin = (await get(RIDER, finance)).json?.data;
  it('Finance (people view, no documents/support/audit) gets the record without those parts', () => {
    assert.equal(fin?.name, 'Vikram Singh');
    assert.equal(fin.documents, null);
    assert.equal(fin.support, null);
    assert.equal(fin.history, null);
  });
  const opsRec = (await get(RIDER, ops)).json?.data;
  it('Operations (documents, support, no audit) gets those but not the history', () => {
    assert.ok(Array.isArray(opsRec?.documents));
    assert.ok(opsRec.support);
    assert.equal(opsRec.history, null);
  });
  const noKitchens = await get('/admin/records/restaurant/rst_bbh_01', support);
  it('Support (no restaurants view) cannot open a restaurant\'s record', () => assert.equal(noKitchens.status, 403));
  const asPartner = await get(RIDER, partner);
  it('A partner cannot open any record', () => assert.equal(asPartner.status, 403));
  const anon = await get(RIDER);
  it('Signed out is 401', () => assert.equal(anon.status, 401));
  const badKind = await get('/admin/records/wizard/rdr_vikram_01', admin);
  it('An unknown kind is 400', () => assert.equal(badKind.status, 400));
  const nobody = await get('/admin/records/rider/rdr_nobody', admin);
  it('An unknown person is 404', () => assert.equal(nobody.status, 404));

  console.log('\n-- Files');
  const file = await get(`${RIDER}/documents/${aadhaar.id}/file`, ops);
  it('A document downloads as its own file', () => {
    assert.equal(file.status, 200);
    assert.match(file.type, /image\/png/);
    assert.ok(file.buf.equals(PNG));
    assert.match(file.disposition, /attachment; filename="Vikram-Singh-AADHAAR\.png"/);
  });
  const logged = (await auditRepository.list({ action: 'DOCUMENT_DOWNLOADED' })).find(a => a.entityId === aadhaar.id);
  it('...and the download is in the audit log', () => assert.ok(logged, 'no audit line'));
  const finFile = await get(`${RIDER}/documents/${aadhaar.id}/file`, finance);
  it('Without documents.view the file is refused', () => assert.equal(finFile.status, 403));
  const fssai = (await kycRepository.findByEntity('RESTAURANT', 'rst_bbh_01'))[0];
  const crossed = await get(`${RIDER}/documents/${fssai.id}/file`, admin);
  it('A document is only reachable through its own person', () => assert.equal(crossed.status, 404));
  const gone = await get(`${RIDER}/documents/${missing.id}/file`, admin);
  it('A missing file is 404 FILE_MISSING', () => assert.equal(gone.json?.error?.code, 'FILE_MISSING'));
  const link = await get(`/admin/records/restaurant/rst_bbh_01/documents/${fssai.id}/file`, admin);
  it('A document kept as a link redirects to it', () => {
    assert.equal(link.status, 302);
    assert.equal(link.location, fssai.fileUrl);
  });

  const all = await get(`${RIDER}/documents.zip`, ops);
  const names = zipNames(all.buf);
  const riderDocs = (await kycRepository.findByEntity('RIDER', 'rdr_vikram_01')).filter(d => d.fileUrl.startsWith('data:'));
  it('Download all: one ZIP', () => {
    assert.equal(all.status, 200);
    assert.match(all.type, /application\/zip/);
  });
  it('...with every stored file and an index listing links and missing files', () => {
    assert.equal(names.filter(n => n !== 'index.txt').length, riderDocs.length, names.join(','));
    assert.ok(names.includes('Vikram-Singh-AADHAAR.png'));
    assert.ok(names.includes('index.txt'));
  });
  const finZip = await get(`${RIDER}/documents.zip`, finance);
  it('...refused without documents.view', () => assert.equal(finZip.status, 403));

  console.log('\n-- Restaurants and customers');
  const kitchen = (await get('/admin/records/restaurant/rst_bbh_01', admin)).json?.data;
  it('A restaurant\'s record: tax and licence papers, cover photo, owner\'s account', () => {
    assert.ok(kitchen.documents.find((g: any) => g.group === 'Licences').items.some((d: any) => d.documentType === 'FSSAI'));
    assert.ok(kitchen.photos.some((p: any) => p.label === 'Cover'));
    assert.equal(kitchen.userId, 'usr_partner_01');
  });
  const cust = (await get('/admin/records/customer/usr_customer_01', admin)).json?.data;
  it('A customer\'s record has no document groups and their own tickets', () => {
    assert.deepEqual(cust.documents, []);
    assert.ok(Array.isArray(cust.support.tickets));
  });
  const notCustomer = await get('/admin/records/customer/usr_rider_01', admin);
  it('A rider\'s account is not a customer record', () => assert.equal(notCustomer.status, 404));
} finally {
  // Wait for the close: exiting while it is in flight crashes Node on Windows (UV_HANDLE_CLOSING).
  await new Promise(r => server.close(() => r(null)));
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
