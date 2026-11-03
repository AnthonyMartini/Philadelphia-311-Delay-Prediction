import test from 'node:test';
import assert from 'node:assert/strict';
import { daysBetween, filterTickets, formatDate, percent, ticketFromRecord, withScores } from '../src/tickets.js';

test('record dates and source details survive mapping without invented intake fields', () => {
  const ticket = ticketFromRecord({ ticket: { request_id: 'PHL-1', service_name: 'Graffiti Removal', agency_responsible: 'Department', zipcode: null },
    requested_date: '2026-03-07', expected_date: '2026-03-10', closed_date: '2026-03-09', status: 'Closed', service_notice: '1 Business Day' });
  assert.equal(ticket.days, 2);
  assert.equal(ticket.zip, 'Missing');
  assert.equal(ticket.prediction, null);
  assert.equal(ticket.scoreStatus, 'loading');
  assert.equal(ticket.channel, undefined);
  assert.equal(ticket.time, undefined);
  assert.equal(formatDate('2026-03-07'), 'Mar 7, 2026');
  assert.equal(daysBetween('2026-03-07', null), null);
});

test('scores and validation errors attach by request ID', () => {
  const result = withScores([{ id: 'valid' }, { id: 'invalid' }], {
    predictions: new Map([['valid', { delay_probability: 0.6499, risk_band: 'Elevated' }]]),
    errors: new Map([['invalid', 'Unsupported department']]),
  });
  assert.equal(percent(result[0].prediction), 65);
  assert.equal(result[0].scoreStatus, 'ready');
  assert.equal(result[1].scoreStatus, 'invalid');
  assert.equal(result[1].prediction, null);
});

test('queue filters use server risk bands rather than rounded percentages', () => {
  const tickets = [
    { id: 'PHL-1', category: 'Graffiti', dept: 'Dept', zip: '19121', status: 'Open', requestedDate: '2026-01-01', prediction: { delay_probability: 0.6499, risk_band: 'Elevated' } },
    { id: 'PHL-2', category: 'Graffiti', dept: 'Dept', zip: '19121', status: 'Open', requestedDate: '2026-01-02', prediction: { delay_probability: 0.65, risk_band: 'High' } },
    { id: 'PHL-3', category: 'Graffiti', dept: 'Dept', zip: '19121', status: 'Closed', closedDate: '2026-01-03', scoreStatus: 'invalid' },
  ];
  assert.deepEqual(filterTickets(tickets, { band: 'Elevated' }).map((ticket) => ticket.id), ['PHL-1']);
  assert.deepEqual(filterTickets(tickets, { band: 'High' }).map((ticket) => ticket.id), ['PHL-2']);
  assert.deepEqual(filterTickets(tickets).map((ticket) => ticket.id), ['PHL-2', 'PHL-1']);
  assert.deepEqual(filterTickets(tickets, { closed: true, band: 'missing' }).map((ticket) => ticket.id), ['PHL-3']);
  assert.equal(filterTickets(tickets, { search: 'unknown' }).length, 0);
});
