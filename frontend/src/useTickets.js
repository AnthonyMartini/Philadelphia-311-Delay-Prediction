import { useEffect, useRef, useState } from 'react';
import { ticketFromRecord, withScores } from './tickets.js';

export function useTickets(api) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ tickets: [], loading: true, scoring: false, error: '' });
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    let tickets = [];
    setState({ tickets, loading: true, scoring: false, error: '' });
    (async () => {
      try {
        tickets = (await api.getTickets({ signal })).map(ticketFromRecord);
        if (signal.aborted) return;
        setState({ tickets, loading: false, scoring: true, error: '' });
        const scores = await api.scoreTickets(tickets.map((ticket) => ticket.input), { signal });
        if (!signal.aborted) setState({ tickets: withScores(tickets, scores), loading: false, scoring: false, error: '' });
      } catch (error) {
        if (!signal.aborted) setState({
          tickets: tickets.map((ticket) => ({ ...ticket, scoreStatus: 'unavailable' })),
          loading: false, scoring: false, error: error.message,
        });
      }
    })();
    return () => controller.abort();
  }, [api, revision]);
  return { ...state, revision, reload: () => setRevision((value) => value + 1) };
}

export function useResource(id, loader, revision, enabled = true) {
  const cache = useRef(new Map());
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ key: null, value: null, error: null, loading: false });
  const key = `${revision}:${id}`;
  useEffect(() => { cache.current.clear(); }, [revision]);
  useEffect(() => {
    if (!enabled || !id) return;
    if (cache.current.has(key)) {
      setState({ key, value: cache.current.get(key), error: null, loading: false });
      return;
    }
    const controller = new AbortController();
    setState({ key, value: null, error: null, loading: true });
    loader(id, { signal: controller.signal }).then((value) => {
      if (!controller.signal.aborted) {
        cache.current.set(key, value);
        setState({ key, value, error: null, loading: false });
      }
    }).catch((error) => {
      if (!controller.signal.aborted) setState({ key, value: null, error, loading: false });
    });
    return () => controller.abort();
  }, [id, loader, revision, enabled, key, attempt]);
  const current = state.key === key ? state : { value: cache.current.get(key) ?? null, error: null, loading: enabled && Boolean(id) };
  return { ...current, retry: () => { cache.current.delete(key); setAttempt((value) => value + 1); } };
}
