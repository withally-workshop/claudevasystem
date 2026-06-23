'use strict';

// Unit test for the createCustomer email-dedup backstop (2026-06-23 "Get Customers"
// duplicate incident). Stubs https.request so no network is hit.
// NOTE: lives in test/ (NOT tools/) — server.js auto-requires every tools/*.js at boot,
// so a self-running test there would crash startup. Run: node test/airwallex.dedup.test.js

const assert = require('node:assert/strict');
const https = require('https');

process.env.AIRWALLEX_CLIENT_ID = 'test-client';
process.env.AIRWALLEX_API_KEY = 'test-key';

let createCalled = false;

const EXISTING = {
  id: 'bcus_existing',
  name: 'Get Customers PTE LTD', // note: different casing from the request below
  email: 'contactlenney@gmail.com',
  address: { country_code: 'SG' },
};

https.request = function stubRequest(options, cb) {
  const { path, method } = options;
  let body = {};
  if (path === '/api/v1/authentication/login') {
    body = { token: 'tok' };
  } else if (method === 'GET' && path.startsWith('/api/v1/billing_customers')) {
    body = { items: [EXISTING] };
  } else if (method === 'POST' && path === '/api/v1/billing_customers/create') {
    createCalled = true;
    body = { id: 'bcus_NEW_DUPLICATE', name: 'Get Customers Pte Ltd' };
  }
  const res = {
    statusCode: 200,
    on(event, handler) {
      if (event === 'data') handler(Buffer.from(JSON.stringify(body)));
      if (event === 'end') handler();
      return res;
    },
  };
  process.nextTick(() => cb(res));
  return {
    on() { return this; },
    setTimeout() { return this; },
    write() {},
    end() {},
  };
};

const { handlers } = require('../tools/airwallex.js');

(async () => {
  // 1. Exact email match (case-different name) -> reuse, never create.
  createCalled = false;
  const reused = await handlers.airwallex_create_customer({
    name: 'Get Customers Pte Ltd',
    email: 'contactlenney@gmail.com',
    country_code: 'SG',
  });
  assert.equal(reused.id, 'bcus_existing', 'should reuse the existing customer id');
  assert.equal(reused.reused_existing, true, 'should flag reused_existing');
  assert.equal(createCalled, false, 'must NOT create a customer when an exact-email match exists');

  // 2. No email match -> creates a new customer.
  createCalled = false;
  const created = await handlers.airwallex_create_customer({
    name: 'Brand New Co',
    email: 'brand-new@example.com',
    country_code: 'US',
  });
  assert.equal(createCalled, true, 'should create when no email match exists');
  assert.equal(created.id, 'bcus_NEW_DUPLICATE', 'should return the freshly created id');

  // 3. Blank email -> still creates (we do not block blank-email creates here).
  createCalled = false;
  await handlers.airwallex_create_customer({ name: 'No Email Co', country_code: 'US' });
  assert.equal(createCalled, true, 'should create when no email is supplied (dedup only applies with an email)');

  console.log('airwallex createCustomer dedup test passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
