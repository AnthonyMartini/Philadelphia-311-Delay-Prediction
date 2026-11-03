const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});

export function formatDate(value) {
  return value ? dateFormatter.format(new Date(`${value}T00:00:00Z`)) : 'Not recorded';
}

export function daysBetween(start, end) {
  return start && end ? Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) : null;
}

export function ticketFromRecord(record) {
  return {
    id: record.ticket.request_id, category: record.ticket.service_name,
    dept: record.ticket.agency_responsible, zip: record.ticket.zipcode ?? 'Missing',
    requestedDate: record.requested_date, expectedDate: record.expected_date, closedDate: record.closed_date,
    status: record.status, source: record.source ?? 'held_out', serviceNotice: record.service_notice,
    days: daysBetween(record.requested_date, record.closed_date), input: record.ticket,
    prediction: null, scoreStatus: 'loading', scoreError: '',
  };
}

export function withScores(tickets, { predictions, errors }) {
  return tickets.map((ticket) => ({ ...ticket, prediction: predictions.get(ticket.id) ?? null,
    scoreStatus: errors.has(ticket.id) ? 'invalid' : predictions.has(ticket.id) ? 'ready' : 'unavailable',
    scoreError: errors.get(ticket.id) ?? '',
  }));
}

export function filterTickets(tickets, { search = '', band = 'all', sort = 'risk', closed = false } = {}) {
  const query = search.toLowerCase().trim();
  return tickets.filter((ticket) => (closed ? ticket.status === 'Closed' : ticket.status !== 'Closed'))
    .filter((ticket) => `${ticket.id} ${ticket.category} ${ticket.dept} ${ticket.zip}`.toLowerCase().includes(query))
    .filter((ticket) => band === 'all' || (band === 'missing' ? ticket.scoreStatus === 'invalid' : ticket.prediction?.risk_band === band))
    .sort((a, b) => closed ? (b.closedDate ?? '').localeCompare(a.closedDate ?? '')
      : sort === 'date' ? b.requestedDate.localeCompare(a.requestedDate)
        : (b.prediction?.delay_probability ?? -1) - (a.prediction?.delay_probability ?? -1));
}

export const percent = (prediction) => prediction ? Math.round(prediction.delay_probability * 100) : null;
export const riskClass = (band) => ({ High: 'high', Elevated: 'medium', Standard: 'low' })[band] ?? 'neutral';
