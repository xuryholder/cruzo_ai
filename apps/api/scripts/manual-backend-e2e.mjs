#!/usr/bin/env node

const API_BASE_URL = process.env.MANUAL_API_BASE_URL || 'http://localhost:4000';
const TODAY = new Date().toISOString().slice(0, 10);
const RUN_ID = Date.now().toString(36);

async function main() {
  const summary = {
    passed: 0,
    failed: 0,
    tests: [],
  };

  await runTest(summary, 'status transitions + idempotency', async () => {
    const contact = await createContact({
      name: 'E2E Success',
      email: uniqueEmail('e2e.success'),
    });

    const generated = await generateDraft(contact.id);
    assert(generated.status === 'draft', 'draft should be created with status=draft');

    const approved = await approveDraft(generated.id, {
      subject: 'Happy Birthday!',
      text: 'Happy Birthday! Wishing you a great year ahead.',
    });
    assert(approved.status === 'approved', 'draft should move to approved');

    const sendFirst = await sendNow(generated.id, 'email', idemKey('e2e-idem-1'));
    assert(sendFirst.draft.status === 'sent', 'send-now should move draft to sent');
    assert(sendFirst.idempotent === false, 'first send should not be idempotent');

    const sendSecond = await sendNow(generated.id, 'email', idemKey('e2e-idem-1'));
    assert(sendSecond.draft.status === 'sent', 'second send should still return sent draft');
    assert(sendSecond.idempotent === true, 'second send should be idempotent');
  });

  await runTest(summary, 'validation 409 (send without approve)', async () => {
    const contact = await createContact({
      name: 'E2E Conflict',
      email: uniqueEmail('e2e.conflict'),
    });

    const generated = await generateDraft(contact.id);
    const response = await api('POST', `/v1/manual/messages/${generated.id}/send-now`, {
      expectedStatus: 409,
      headers: {
        'x-idempotency-key': idemKey('e2e-conflict-1'),
      },
      body: {
        channel: 'email',
      },
    });

    assert(
      response.json?.message === 'send-now requires approved status',
      '409 should explain missing approve step',
    );
  });

  await runTest(summary, 'validation 501 (channel not implemented)', async () => {
    const contact = await createContact({
      name: 'E2E NotImplemented',
      email: uniqueEmail('e2e.notimpl'),
    });

    const generated = await generateDraft(contact.id);
    await approveDraft(generated.id, {
      subject: 'Subject',
      text: 'Body',
    });

    const response = await api('POST', `/v1/manual/messages/${generated.id}/send-now`, {
      expectedStatus: 501,
      headers: {
        'x-idempotency-key': idemKey('e2e-notimpl-1'),
      },
      body: {
        channel: 'telegram',
      },
    });

    assert(
      response.json?.error === 'Not Implemented',
      '501 should return Not Implemented error',
    );
  });

  await runTest(summary, 'validation 422 + retry failed->sent', async () => {
    const contact = await createContact({
      name: 'E2E Retry',
    });

    const generated = await generateDraft(contact.id);
    const approved = await approveDraft(generated.id, {
      subject: 'Retry Subject',
      text: 'Retry Body',
    });
    assert(approved.status === 'approved', 'draft should be approved before send attempt');

    const failedSend = await api('POST', `/v1/manual/messages/${generated.id}/send-now`, {
      expectedStatus: 422,
      headers: {
        'x-idempotency-key': idemKey('e2e-422-1'),
      },
      body: {
        channel: 'email',
      },
    });
    assert(
      failedSend.json?.message === 'Email channel requires contact email',
      '422 should explain missing contact email',
    );

    const failedDetail = await getMessageDetail(generated.id);
    assert(failedDetail.draft.status === 'failed', 'draft should become failed after 422 send');
    assert(
      failedDetail.logs.some((log) => log.action === 'send_failed'),
      'failed send should be written to message logs',
    );

    await updateContactEmail(contact.id, uniqueEmail('e2e.retry.fixed'));
    const retryResponse = await retrySend(generated.id, idemKey('e2e-retry-1'));
    assert(retryResponse.draft.status === 'sent', 'retry should move failed draft to sent');
    assert(retryResponse.idempotent === false, 'first retry should not be idempotent');
  });

  printSummary(summary);
  if (summary.failed > 0) {
    process.exit(1);
  }
}

async function runTest(summary, name, fn) {
  try {
    await fn();
    summary.passed += 1;
    summary.tests.push({ name, status: 'passed' });
    console.log(`PASS: ${name}`);
  } catch (error) {
    summary.failed += 1;
    summary.tests.push({
      name,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`FAIL: ${name}`);
    console.error(error);
  }
}

function printSummary(summary) {
  console.log('');
  console.log('Manual Backend E2E Summary');
  console.log(`Passed: ${summary.passed}`);
  console.log(`Failed: ${summary.failed}`);
  for (const test of summary.tests) {
    if (test.status === 'passed') {
      continue;
    }

    console.log(`- ${test.name}: ${test.error}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function uniqueEmail(prefix) {
  return `${prefix}+${RUN_ID}@example.com`;
}

function idemKey(prefix) {
  return `${prefix}-${RUN_ID}`;
}

async function createContact(input) {
  const response = await api('POST', '/v1/manual/contacts', {
    expectedStatus: 201,
    body: {
      name: input.name,
      email: input.email,
      birthdayDate: TODAY,
      source: 'manual_test',
    },
  });

  return response.json;
}

async function generateDraft(contactId) {
  const response = await api('POST', '/v1/manual/messages/generate', {
    expectedStatus: 201,
    body: { contactId },
  });

  return response.json;
}

async function approveDraft(messageId, input) {
  const response = await api('PATCH', `/v1/manual/messages/${messageId}/approve`, {
    expectedStatus: 200,
    body: input,
  });

  return response.json;
}

async function sendNow(messageId, channel, idempotencyKey) {
  const response = await api('POST', `/v1/manual/messages/${messageId}/send-now`, {
    expectedStatuses: [200, 201],
    headers: {
      'x-idempotency-key': idempotencyKey,
    },
    body: { channel },
  });

  return response.json;
}

async function retrySend(messageId, idempotencyKey) {
  const response = await api('POST', `/v1/manual/messages/${messageId}/retry`, {
    expectedStatuses: [200, 201],
    headers: {
      'x-idempotency-key': idempotencyKey,
    },
    body: {},
  });

  return response.json;
}

async function getMessageDetail(messageId) {
  const response = await api('GET', `/v1/manual/messages/${messageId}`, {
    expectedStatus: 200,
  });

  return response.json;
}

async function updateContactEmail(contactId, email) {
  const response = await api('PATCH', `/v1/manual/contacts/${contactId}`, {
    expectedStatus: 200,
    body: { email },
  });

  return response.json;
}

async function api(method, path, options = {}) {
  const headers = {
    'content-type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (options.expectedStatus && response.status !== options.expectedStatus) {
    throw new Error(
      `Unexpected status for ${method} ${path}: expected ${options.expectedStatus}, got ${response.status}. Body: ${text}`,
    );
  }
  if (options.expectedStatuses && !options.expectedStatuses.includes(response.status)) {
    throw new Error(
      `Unexpected status for ${method} ${path}: expected one of [${options.expectedStatuses.join(
        ', ',
      )}], got ${response.status}. Body: ${text}`,
    );
  }

  return {
    status: response.status,
    text,
    json,
  };
}

main().catch((error) => {
  console.error('Fatal test runner error');
  console.error(error);
  process.exit(1);
});
