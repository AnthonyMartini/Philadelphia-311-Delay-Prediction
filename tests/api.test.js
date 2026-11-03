import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApiClient } from '../src/api.js';

const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
const tickets = [{ request_id: 'PHL-1' }, { request_id: 'PHL-2' }, { request_id: 'PHL-3' }];
const prediction = (ticket) => ({ request_id: ticket.request_id, delay_probability: 0.6, risk_band: 'Elevated' });

test('batch validation isolates rejected tickets and retries only valid records', async () => {
  const requests = [];
  const api = createApiClient({ fetchImpl: async (_, options) => {
    const payload = JSON.parse(options.body);
    requests.push(payload);
    return requests.length === 1 ? response({ detail: [
      { loc: ['body', 'tickets', 0, 'agency_responsible'], msg: 'Unsupported department' },
      { loc: ['body', 'tickets', 2, 'zipcode'], msg: 'Unsupported ZIP' },
    ] }, 422) : response({ predictions: payload.tickets.map(prediction) });
  } });
  const result = await api.scoreTickets(tickets);
  assert.deepEqual(requests[1].tickets, [tickets[1]]);
  assert.equal(requests[1].include_explanation, false);
  assert.equal(result.predictions.get('PHL-2').delay_probability, 0.6);
  assert.match(result.errors.get('PHL-1'), /Department/);
  assert.match(result.errors.get('PHL-3'), /ZIP/);
});

test('batch errors with no valid row index stop instead of looping or dropping tickets', async () => {
  let calls = 0;
  const api = createApiClient({ fetchImpl: async () => {
    calls++;
    return response({ detail: [{ loc: ['body'], msg: 'Invalid batch' }] }, 422);
  } });
  await assert.rejects(api.scoreTickets(tickets), (error) => error instanceof ApiError && error.status === 422);
  assert.equal(calls, 1);
});

test('a completely rejected batch returns individual errors without fabricated scores', async () => {
  const api = createApiClient({ fetchImpl: async () => response({ detail: [
    { loc: ['body', 'tickets', 0, 'agency_responsible'], msg: 'Unsupported department' },
  ] }, 422) });
  const result = await api.scoreTickets([tickets[0]]);
  assert.equal(result.predictions.size, 0);
  assert.equal(result.errors.size, 1);
});

test('incomplete predictions are rejected', async () => {
  const api = createApiClient({ fetchImpl: async () => response({ predictions: [] }) });
  await assert.rejects(api.scoreTickets(tickets), /incomplete prediction/);
});

test('large batches are split to respect the server limit', async () => {
  const sizes = [];
  const api = createApiClient({ fetchImpl: async (_, options) => {
    const payload = JSON.parse(options.body);
    sizes.push(payload.tickets.length);
    return response({ predictions: payload.tickets.map(prediction) });
  } });
  const inputs = Array.from({ length: 1001 }, (_, i) => ({ request_id: `PHL-${i}` }));
  const result = await api.scoreTickets(inputs);
  assert.deepEqual(sizes, [1000, 1]);
  assert.equal(result.predictions.size, 1001);
});

test('ticket loading follows pagination and rejects prematurely empty pages', async () => {
  const urls = [];
  const api = createApiClient({ fetchImpl: async (url) => {
    urls.push(url);
    return response({ total: 2, tickets: [{ ticket: tickets[urls.length - 1] }] });
  } });
  assert.equal((await api.getTickets()).length, 2);
  assert.match(urls[1], /offset=1$/);
  const incomplete = createApiClient({ fetchImpl: async () => response({ total: 2, tickets: [] }) });
  await assert.rejects(incomplete.getTickets(), /incomplete ticket list/);
});

test('base URLs and ticket IDs are composed safely', async () => {
  let observed;
  const api = createApiClient({ baseUrl: 'https://api.example/', fetchImpl: async (url) => { observed = url; return response({}); } });
  await api.getRecord('PHL-1/extra');
  assert.equal(observed, 'https://api.example/api/v1/tickets/PHL-1%2Fextra');
});

test('network errors produce an actionable message', async () => {
  const api = createApiClient({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(api.getTickets(), /backend is running/);
});

const untilAborted = (_, { signal }) => new Promise((resolve, reject) => {
  const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'));
  if (signal.aborted) rejectAbort();
  else signal.addEventListener('abort', rejectAbort, { once: true });
});

test('timeouts are reported separately from navigation cancellation', async () => {
  const api = createApiClient({ fetchImpl: untilAborted, timeoutMs: 10 });
  await assert.rejects(api.getTickets(), /too long/);
  const controller = new AbortController();
  const pending = api.getTickets({ signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error.name === 'AbortError');
});
