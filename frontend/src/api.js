export class ApiError extends Error {
  constructor(message, status = 0, details = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

const fieldLabels = {
  service_name: 'Service category', agency_responsible: 'Department', zipcode: 'ZIP',
  sla_business_days: 'Promised window', day_of_week: 'Submission weekday',
  prior_7d_service_volume: 'Prior service volume', prior_7d_zip_volume: 'Prior ZIP volume',
  backlog_share: 'Recent backlog share', request_id: 'Request ID',
};

export function errorMessage(detail) {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((item) => {
    const field = item.loc?.at(-1);
    const message = item.msg?.replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/g, (name) => fieldLabels[name]?.toLowerCase() ?? name);
    return `${typeof field === 'string' && field !== 'body' ? `${fieldLabels[field] ?? field}: ` : ''}${message}`;
  }).join(' ');
  return 'The prediction service could not complete this request.';
}

export function createApiClient({ baseUrl = '', fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const base = baseUrl.replace(/\/+$/, '');

  async function request(path, { signal, ...options } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await fetchImpl(`${base}/api/v1${path}`, { ...options, signal: controller.signal });
      let data;
      try { data = await response.json(); }
      catch {
        if (response.status >= 500) throw new ApiError('The prediction service is unavailable. Check that the backend is running, then retry.', response.status);
        throw new ApiError('The prediction service returned an unreadable response.', response.status);
      }
      if (!response.ok) throw new ApiError(errorMessage(data.detail), response.status, data.detail);
      return data;
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
      if (timedOut) throw new ApiError('The prediction service took too long to respond. Please retry.');
      if (error instanceof ApiError) throw error;
      throw new ApiError('Cannot reach the prediction service. Check that the backend is running, then retry.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  const getRecord = (id, options) => request(`/tickets/${encodeURIComponent(id)}`, options);
  const getPrediction = (id, options) => request(`/tickets/${encodeURIComponent(id)}/prediction`, options);
  const getSimilar = (id, options) => request(`/tickets/${encodeURIComponent(id)}/similar`, options);

  async function getTickets({ page = 0, pageSize = 25, status = 'open', signal } = {}) {
    const offset = page * pageSize;
    const result = await request(`/tickets?limit=${pageSize}&offset=${offset}&status=${status}`, { signal });
    if (!Array.isArray(result.tickets) || !Number.isInteger(result.total) || result.total < 0
        || result.tickets.length > pageSize || offset > result.total && result.tickets.length) {
      throw new ApiError('The ticket list returned by the service is incomplete. Please retry.');
    }
    return result;
  }

  async function scoreTickets(tickets, { signal } = {}) {
    const predictions = new Map();
    const errors = new Map();
    for (let start = 0; start < tickets.length; start += 1000) {
      let pending = tickets.slice(start, start + 1000);
      while (pending.length) {
        try {
          const result = await request('/predictions/batch', {
            method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tickets: pending, include_explanation: false }),
          });
          if (!Array.isArray(result.predictions) || result.predictions.length !== pending.length
              || result.predictions.some((p, i) => p.request_id !== pending[i].request_id
                || !Number.isFinite(p.delay_probability) || p.delay_probability < 0 || p.delay_probability > 1)) {
            throw new ApiError('The service returned incomplete prediction results. Please retry.');
          }
          result.predictions.forEach((prediction) => predictions.set(prediction.request_id, prediction));
          break;
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 422 || !Array.isArray(error.details)) throw error;
          const rejected = new Map();
          for (const detail of error.details) {
            const [body, collection, index] = detail.loc ?? [];
            if (body !== 'body' || collection !== 'tickets' || !Number.isInteger(index) || !pending[index]) throw error;
            const messages = rejected.get(index) ?? [];
            messages.push(detail);
            rejected.set(index, messages);
          }
          if (!rejected.size) throw error;
          for (const [index, details] of rejected) errors.set(pending[index].request_id, errorMessage(details));
          // Each retry removes at least one rejected row; valid records keep their original order.
          pending = pending.filter((_, index) => !rejected.has(index));
        }
      }
    }
    return { predictions, errors };
  }

  return { getTickets, getRecord, getPrediction, getSimilar, scoreTickets };
}
