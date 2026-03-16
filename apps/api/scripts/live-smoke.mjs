#!/usr/bin/env node

const API_BASE_URL = process.env.MANUAL_API_BASE_URL || 'http://localhost:4000';

async function main() {
  const summary = { passed: 0, failed: 0, tests: [] };

  await runTest(summary, 'health/live is reachable', async () => {
    const response = await api('GET', '/health/live', { expectedStatus: 200 });
    assert(response.json?.status === 'ok', 'health status must be ok');
    assert(typeof response.json?.liveAgentMode === 'string', 'liveAgentMode is required');
  });

  let liveSessionId = '';
  await runTest(summary, 'create live session', async () => {
    const response = await api('POST', '/v1/live/session', {
      expectedStatus: 201,
      body: {
        locale: 'en-US',
        persona: 'cruzo-live-smoke',
      },
    });
    assert(typeof response.json?.liveSessionId === 'string', 'liveSessionId is required');
    liveSessionId = response.json.liveSessionId;
  });

  let tokenPayload = null;
  await runTest(summary, 'mint live token', async () => {
    const response = await api('POST', '/v1/live/token', {
      expectedStatus: 200,
      headers: { 'x-live-session-id': liveSessionId },
      body: {},
    });
    tokenPayload = response.json;
    assert(typeof tokenPayload?.supported === 'boolean', 'supported must be boolean');
    assert(typeof tokenPayload?.model === 'string' && tokenPayload.model.length > 0, 'model is required');
  });

  await runTest(summary, 'stream turn emits ordered SSE events', async () => {
    const response = await fetch(`${API_BASE_URL}/v1/live/stream`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-live-session-id': liveSessionId,
      },
      body: JSON.stringify({
        text: 'Create a warm birthday greeting for Anna from our design team.',
        tone: 'warm',
        channel: 'text',
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`stream endpoint failed with status ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const events = [];
    const start = Date.now();

    while (Date.now() - start < 12000) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() || '';

      for (const frame of frames) {
        const eventLine = frame.split('\n').find((line) => line.startsWith('event:'));
        const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
        if (!eventLine || !dataLine) {
          continue;
        }
        const event = eventLine.slice(6).trim();
        events.push(event);
        if (event === 'turn_completed') {
          break;
        }
      }

      if (events.includes('turn_completed')) {
        break;
      }
    }

    assert(events.includes('thinking'), 'missing thinking event');
    assert(events.includes('draft_delta'), 'missing draft_delta event');
    assert(events.includes('turn_completed'), 'missing turn_completed event');
  });

  await runTest(summary, 'fallback turn endpoint returns output contract', async () => {
    const response = await api('POST', '/v1/live/turn', {
      expectedStatus: 200,
      headers: { 'x-live-session-id': liveSessionId },
      body: {
        text: 'Make it shorter and cheerful.',
        tone: 'friendly',
        channel: 'voice',
      },
    });
    assert(typeof response.json?.greetingDraft === 'string', 'greetingDraft must be string');
    assert(typeof response.json?.cardConcept === 'string', 'cardConcept must be string');
    assert(typeof response.json?.voiceSummary === 'string', 'voiceSummary must be string');
  });

  await runTest(summary, 'transcribe endpoint responds with contract', async () => {
    const response = await api('POST', '/v1/live/transcribe', {
      expectedStatus: 200,
      headers: { 'x-live-session-id': liveSessionId },
      body: {
        audioBase64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=',
        mimeType: 'audio/wav',
      },
    });
    assert(typeof response.json?.text === 'string', 'text must be string');
    assert(response.json?.provider === 'gemini' || response.json?.provider === 'fallback', 'invalid provider');
  });

  printSummary(summary, tokenPayload);
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
    console.error(error instanceof Error ? error.message : String(error));
  }
}

function printSummary(summary, tokenPayload) {
  console.log('\nLive Smoke Summary');
  console.log(`API: ${API_BASE_URL}`);
  console.log(`Passed: ${summary.passed}`);
  console.log(`Failed: ${summary.failed}`);
  if (tokenPayload) {
    console.log(
      `Token: supported=${tokenPayload.supported} model=${tokenPayload.model} message="${tokenPayload.message}"`,
    );
  }
  for (const test of summary.tests) {
    if (test.status === 'failed') {
      console.log(`- ${test.name}: ${test.error}`);
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function api(method, path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
    body: method === 'GET' ? undefined : JSON.stringify(options.body ?? {}),
  });

  const text = await response.text();
  const json = tryParseJson(text);
  const expectedStatuses = options.expectedStatuses || [options.expectedStatus ?? 200];
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(
      `${method} ${path} expected ${expectedStatuses.join(',')} got ${response.status} body=${text.slice(0, 300)}`,
    );
  }

  return { status: response.status, json, text };
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
