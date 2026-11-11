import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createApiClient } from './api.js';
import { filterTickets, formatDate, percent, riskClass, ticketFromRecord } from './tickets.js';
import { useResource, useTickets } from './useTickets.js';
import './styles.css';

const api = createApiClient({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? '' });
const pages = ['queue', 'closed', 'ticket', 'closed-record', 'similar', 'policy', 'decision', 'saved', 'missing', 'log'];
const ticketPages = ['ticket', 'closed-record', 'similar', 'policy', 'decision', 'missing'];
const navItems = [['queue', 'Review Queue', '▦'], ['closed', 'Closed Tickets', '▤'], ['log', 'Action Log', '☷']];
const policyURL = 'https://www.phila.gov/services/trash-recycling-city-upkeep/report-a-problem-with-trash-recycling-or-city-upkeep/track-a-service-request-with-311/';
const signed = (value) => `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(2)}`;

function readRoute() {
  const [page, encodedId] = location.hash.slice(1).split('/');
  let id;
  try { id = encodedId ? decodeURIComponent(encodedId) : null; }
  catch { id = encodedId; }
  return { page: pages.includes(page) ? page === 'saved' ? 'log' : page : 'queue', id };
}

function Button({ children, primary, ...props }) {
  return <button className={`btn${primary ? ' primary' : ''}`} {...props}>{children}</button>;
}
function Notice({ children, type = '' }) {
  return <div className={`notice ${type}`}>{children}</div>;
}
function Head({ title, subtitle, children }) {
  return <div className="head"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{children}</div>;
}
function Loading({ children = 'Loading tickets…' }) {
  return <section className="card state" role="status"><h2>{children}</h2><div className="loading" /></section>;
}
function Failure({ title = 'Request unavailable', message, retry, children }) {
  return <section className="card state" role="alert"><h2>{title}</h2><p className="muted">{message}</p>
    <div className="actions">{retry && <Button primary onClick={retry}>Retry</Button>}{children}</div></section>;
}
function Fields({ items }) {
  return <div className="meta">{items.map(([label, value]) => <div key={label}>
    <div className="key">{label}</div><div className="value">{value ?? 'Not recorded'}</div>
  </div>)}</div>;
}
function Risk({ ticket }) {
  if (!ticket.prediction) return <span className="pill neutral">{ticket.scoreStatus === 'loading' ? 'Scoring…'
    : ticket.scoreStatus === 'invalid' ? 'No score' : 'Unavailable'}</span>;
  return <span><strong className={`prob ${riskClass(ticket.prediction.risk_band)}`}>{percent(ticket.prediction)}%</strong>
    <span className="secondary">{ticket.prediction.risk_band}</span></span>;
}
function TicketFields({ ticket, closed = false }) {
  const input = ticket.input;
  return <Fields items={[
    ['Service category', ticket.category], ['Department', ticket.dept],
    ['ZIP', ticket.zip === 'Missing' ? 'Not recorded' : ticket.zip], ['Submitted', formatDate(ticket.requestedDate)],
    ['Promised window', ticket.serviceNotice], ['Due date', formatDate(ticket.expectedDate)],
    ['Same-service requests, prior 7 days', input.prior_7d_service_volume],
    ['Same-ZIP requests, prior 7 days', input.prior_7d_zip_volume],
    ['Recent backlog share', `${Math.round(input.backlog_share * 100)}%`],
    ...(closed ? [['Closed', formatDate(ticket.closedDate)], ['Days to close', ticket.days]] : []),
  ]} />;
}

function TicketList({ tickets, total, page, setPage, scoring, closed, go }) {
  const [search, setSearch] = useState('');
  const [band, setBand] = useState('all');
  const [sort, setSort] = useState('risk');
  useEffect(() => setPage(0), [closed, setPage]);
  const collection = tickets.filter((ticket) => closed ? ticket.status === 'Closed' : ticket.status !== 'Closed');
  const rows = filterTickets(tickets, { search, band, sort, closed });
  const currentPage = page;
  const visible = rows;
  const metrics = [
    ['Requests', total],
    ['Requests at Risk', collection.filter((ticket) => ['High', 'Elevated'].includes(ticket.prediction?.risk_band)).length],
    ['Requests Needing Data Review', collection.filter((ticket) => ticket.scoreStatus === 'invalid').length],
  ];
  return <>
    <Head title={closed ? 'Historical Closed Tickets' : 'Review Queue'}
      subtitle={closed ? 'Recorded closures from the historical sample.' : 'Requests marked open in the saved export.'} />
    {!closed && <div className="grid three">{metrics.map(([label, value], i) => <div className={`card kpi kpi-${i + 1}`} key={label}>
      <div className="label">{label}</div><div className="num">{i > 0 && scoring ? '…' : value}</div>
    </div>)}</div>}
    {scoring && <p className="muted small score-progress" role="status">Calculating model estimates…</p>}
    <section className="card tablecard">
      <div className="toolbar"><h2>{closed ? 'Closed Requests' : 'Open Historical Requests'}</h2>
        <div className="filters">
          <input type="search" aria-label="Search tickets" placeholder="Search ID, category or ZIP" value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          <select aria-label="Filter risk" value={band} onChange={(e) => { setBand(e.target.value); setPage(0); }}>
            <option value="all">All risk levels</option><option value="High">High</option><option value="Elevated">Elevated</option>
            <option value="Standard">Standard</option><option value="missing">Needs data review</option>
          </select>
          {!closed && <select aria-label="Sort tickets" value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }}>
            <option value="risk">Risk: high to low</option><option value="date">Newest submitted</option>
          </select>}
        </div>
      </div>
      <div className="table-scroll"><table><thead><tr>{[
        'Request / category', 'Department', 'ZIP', 'Submitted', ...(closed ? ['Closed', 'Days to close'] : []), 'Delay risk', '',
      ].map((label, i) => <th scope="col" key={i}>{label}</th>)}</tr></thead>
        <tbody>{visible.map((ticket) => <tr className="clickrow" key={ticket.id}>
          <td><button className="ticketlink" onClick={() => go(closed ? 'closed-record' : 'ticket', ticket)}>{ticket.id}</button>
            <span className="secondary">{ticket.category}</span></td>
          <td>{ticket.dept}</td><td>{ticket.zip === 'Missing' ? '—' : ticket.zip}</td><td>{formatDate(ticket.requestedDate)}</td>
          {closed && <><td>{formatDate(ticket.closedDate)}</td><td>{ticket.days ?? '—'}</td></>}
          <td><Risk ticket={ticket} /></td><td className="right"><button className="textbtn" onClick={() => go('ticket', ticket)}>Review →</button></td>
        </tr>)}</tbody></table></div>
      {!rows.length && <div className="empty"><h2>No matching requests</h2><p className="muted small">Try another search or risk filter.</p></div>}
      <div className="tablefoot"><span>Showing {rows.length ? currentPage * 25 + 1 : 0}–{currentPage * 25 + rows.length} of {total} matching requests</span>
        <div className="actions"><Button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
          <Button disabled={(currentPage + 1) * 25 >= total} onClick={() => setPage(currentPage + 1)}>Next</Button></div>
      </div>
    </section>
  </>;
}

function TicketPage({ ticket, detail, go }) {
  const prediction = ticket.prediction;
  const explanation = detail.value?.explanation;
  const factors = explanation?.contributions ?? [];
  const scale = Math.max(0.01, ...factors.map((factor) => Math.abs(factor.value)));
  const [expanded, setExpanded] = useState(false);
  return <div className="grid detailgrid">
    <section className="card"><h2>Estimated delay risk at intake</h2>
      {prediction ? <><div className="riskfigure">{percent(prediction)}<span>%</span></div>
        <span className={`pill ${riskClass(prediction.risk_band)}`}>{prediction.risk_band}</span>
        <p className="muted small score-progress">Probability of missing the promised completion window.</p>
        <div className="gauge"><div style={{ width: `${prediction.delay_probability * 100}%` }} /></div></>
        : <p role="status">{detail.loading ? 'Calculating estimate…' : 'Estimate unavailable.'}</p>}
      <TicketFields ticket={ticket} />
      <div className="rule" /><p className="muted small">This estimates risk at submission using historical conditions. It is not a current status update.</p>
      {prediction?.warnings.map((warning) => <Notice key={warning} type="warning">{warning}</Notice>)}
    </section>
    <section className="card"><div className="head"><h2>SHAP Breakdown</h2>
      <Button disabled={!explanation} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Hide Explanation' : 'Explain this estimate'}</Button></div>
      {detail.loading && <div role="status"><p className="muted">Loading model explanation…</p><div className="loading" /></div>}
      {detail.error && <Failure title="Explanation unavailable" message={detail.error.message} retry={detail.retry} />}
      {explanation && <>
        <div className="figurelabel"><span>Model contributions in log-odds</span><span>Blue raises · gray lowers the estimate</span></div>
        {factors.map(({ feature, label, value }) => <div className="factor" key={feature}>
          <span>{label}</span><div className={`track ${value < 0 ? 'negative' : ''}`}><span style={{ width: `${Math.abs(value) / scale * 100}%` }} /></div>
          <strong>{signed(value)}</strong></div>)}
        <div className="equation">
          <div>Base log-odds<strong>{explanation.base_log_odds.toFixed(2)}</strong></div><span>+</span>
          <div>Contributions<strong>{signed(factors.reduce((sum, factor) => sum + factor.value, 0))}</strong></div><span>=</span>
          <div>Output log-odds<strong>{explanation.output_log_odds.toFixed(2)}</strong></div><span>→</span>
          <div>Probability<strong>≈ {percent(detail.value)}%</strong></div>
        </div>
        {expanded && <div className="answer"><h3>Understanding this estimate</h3>
          <p>The model starts at a baseline probability of {Math.round(100 / (1 + Math.exp(-explanation.base_log_odds)))}%.
            The factors below move the estimate to {percent(detail.value)}%.</p>
          <ul>{[...factors].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).map((factor) => <li key={factor.feature}>
            <strong>{factor.label}</strong> {factor.value < 0 ? 'lowers' : 'raises'} the estimate ({signed(factor.value)} log-odds).
          </li>)}</ul><p className="muted small">These describe associations in the model, not causes of delay. Log-odds contributions are not percentage-point changes.</p>
        </div>}
      </>}
      <div className="actions score-progress"><Button primary onClick={() => go('similar')}>Find similar tickets →</Button>
        <Button onClick={() => go('policy')}>Check official guidance →</Button></div>
    </section>
  </div>;
}

function SimilarPage({ resource, go }) {
  if (resource.loading) return <Loading>Loading comparable closed records…</Loading>;
  if (resource.error) return <Failure title="Similar tickets unavailable" message={resource.error.message} retry={resource.retry} />;
  const matches = resource.value?.tickets ?? [];
  return <><Head title="Comparable Closed Records" subtitle={`Outcomes known before ${formatDate(resource.value?.as_of)}.`} />
    {!matches.length ? <section className="card empty"><h2>No suitable earlier records</h2><p className="muted">No closed requests of this modeled service category were available before submission.</p></section>
      : <div className="grid three">{matches.map((record) => {
        const ticket = ticketFromRecord(record);
        return <article className="card" key={ticket.id}><h2>{ticket.id}</h2><p className="small">{ticket.category}</p>
          <span className={`pill ${record.outcome === 'On time' ? 'low' : 'high'}`}>{record.outcome}</span>
          <Fields items={[
            ['Submitted', formatDate(ticket.requestedDate)], ['Closed', formatDate(ticket.closedDate)],
            ['Time to close', `${record.days_to_close} days`], ['ZIP', ticket.zip],
          ]} /><div className="rule" /><p className="muted small">Matched by modeled service category and intake workload, with ZIP included in the comparison.</p>
          <button className="textbtn" onClick={() => go('closed-record', ticket)}>Inspect source record ↗</button></article>;
      })}</div>}
    <div className="actions score-progress"><Button primary onClick={() => go('policy')}>Open policy guidance →</Button><Button onClick={() => go('ticket')}>Back to explanation</Button></div>
  </>;
}

function ClosedRecord({ ticket, go }) {
  return <><Head title={`${ticket.id} : ${ticket.category}`}><span className="pill low">{ticket.status}</span></Head>
    <section className="card"><p className="muted small">{ticket.source === 'training_reference' ? 'Historical comparison record from the training reference sample.' : 'Historical record from the held-out evaluation sample.'}</p>
      <TicketFields ticket={ticket} closed /><div className="rule" /><h3>Estimated risk at intake</h3><Risk ticket={ticket} />
      {ticket.scoreError && <p className="error">{ticket.scoreError}</p>}
      <p className="muted small score-progress">Closure status records when the case was closed; it does not document how the issue was resolved.</p>
      <div className="actions"><Button onClick={() => go('ticket')}>View estimate and explanation</Button><Button onClick={() => go('closed')}>Back to closed tickets</Button></div>
    </section></>;
}

function Unscorable({ ticket, go }) {
  return <section className="card state"><div className="bigicon" aria-hidden="true">!</div>
    <h1>This request could not be scored.</h1><p className="muted">{ticket.id} · {ticket.category}</p>
    <Notice type="warning">{ticket.scoreError || 'The supplied ticket values are unsupported by the model.'}</Notice>
    <p className="muted small score-progress">Preserve standard processing and request data review. An unavailable estimate does not imply low risk.</p>
    <TicketFields ticket={ticket} /><div className="actions score-progress"><Button primary onClick={() => go('decision')}>Request human review</Button>
      <Button onClick={() => go(ticket.status === 'Closed' ? 'closed' : 'queue')}>Return to requests</Button></div>
  </section>;
}

function PolicyPage({ go }) {
  const [question, setQuestion] = useState('How can a resident check the status of an existing 311 request?');
  const [answer, setAnswer] = useState('supported');
  return <div className="grid policygrid"><section className="card"><h2>Policy guidance</h2>
    <p className="muted small">Prewritten guidance based on a public City source.</p>
    <label htmlFor="question">Operational question</label><textarea id="question" value={question} onChange={(e) => setQuestion(e.target.value)} />
    <Button primary disabled={!question.trim()} onClick={() => setAnswer(/(status|track|check)/i.test(question) && !/(guarantee|crew|tomorrow)/i.test(question) ? 'supported' : 'unsupported')}>Show guidance</Button>
    <div className="answer score-progress">{answer === 'supported' ? <><span className="sourcetag">PREWRITTEN GUIDANCE</span>
      <p className="score-progress">Use the service request number to look up the request. If a case is private, the resident may need the account used when submitting it. A resident can also contact 311 for a status update.</p>
      <p className="muted small">This does not guarantee a completion date or identify a crew.</p>
      <a href={policyURL} target="_blank" rel="noopener noreferrer">[1] Track a service request with 311 ↗</a>
    </> : <><span className="pill high">Unsupported by available sources</span><h3 className="score-progress">No verified instruction available.</h3>
      <p>I cannot verify crew assignments, internal escalation rules, or guaranteed completion times from this source.</p>
      <Button onClick={() => go('decision')}>Continue to human review</Button></>}</div>
  </section><aside className="card"><h2>Official public guidance</h2><p className="muted small">Policy answers here are prewritten. The prediction model runs separately.</p>
    <div className="sourcecard"><h3>Track a service request with 311</h3><p className="muted">City of Philadelphia</p>
      <a href={policyURL} target="_blank" rel="noopener noreferrer">Open original guidance ↗</a></div></aside></div>;
}

const actions = ['Request expedited review', 'Confirm standard processing', 'Request more information'];
const actionDescriptions = ['Ask a human to review potential delay.', 'Preserve the normal handling pathway.', 'Resolve missing or uncertain inputs.'];
function DecisionPage({ ticket, onSave, go }) {
  const [action, setAction] = useState(ticket.scoreStatus === 'invalid' ? actions[2] : actions[0]);
  const [rationale, setRationale] = useState('');
  const [ack, setAck] = useState(false);
  const [error, setError] = useState('');
  function submit(event) {
    event.preventDefault();
    if (rationale.trim().length < 10 || !ack) { setError('Add a rationale of at least 10 characters and acknowledge the review conditions.'); return; }
    onSave({ ticket_id: ticket.id, action, rationale: rationale.trim(), at: new Date().toISOString(),
      delay_probability: ticket.prediction?.delay_probability ?? null, risk_band: ticket.prediction?.risk_band ?? null,
      model_version: ticket.prediction?.model_version ?? null, scored_at: ticket.prediction?.scored_at ?? null,
      prediction_error: ticket.scoreError || (!ticket.prediction ? 'Prediction unavailable at review time.' : null),
      features: ticket.prediction?.features ?? ticket.input, city_submission: false, mode: 'simulation' });
  }
  return <><Head title="Review a Ticket" /><div className="grid two"><section className="card"><h2>Review decision</h2>
    <form onSubmit={submit}>{actions.map((choice, i) => <label className="option" key={choice}><input type="radio" name="action" checked={action === choice} onChange={() => setAction(choice)} />
      <span><b>{choice}</b><br /><small>{actionDescriptions[i]}</small></span></label>)}
      <label htmlFor="rationale">Review rationale (required)</label><textarea id="rationale" value={rationale} maxLength={500}
        onChange={(e) => setRationale(e.target.value)} aria-describedby="decisionError" />
      <label className="checkrow"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>I understand that the estimate is noncausal. This simulated decision will not change a City request.</span></label>
      <p className="error" id="decisionError" role="alert">{error}</p><div className="actions"><Button primary type="submit">Save simulated decision</Button>
        <Button type="button" onClick={() => go('ticket')}>Cancel</Button></div>
    </form></section><section className="card"><h2>{ticket.id}</h2><Risk ticket={ticket} />
      {ticket.scoreError && <p className="error">{ticket.scoreError}</p>}<TicketFields ticket={ticket} />
      <div className="rule" /><p className="muted small">Review decisions stay in this browser session. Refreshing the page clears the log.</p></section></div></>;
}

function ActionLog({ logs, exportLog, go }) {
  return <><Head title="A record of human review." subtitle="Session-only simulated decisions, including the actual model output used during review." />
    <Button onClick={exportLog} disabled={!logs.length}>Export JSON log</Button><section className="card tablecard">
      {!logs.length ? <div className="empty"><h2>No review decisions yet</h2><p className="muted small">Open a request and record a review.</p><Button onClick={() => go('queue')}>Open review queue</Button></div>
        : <div className="table-scroll"><table><thead><tr>{['Ticket', 'Action', 'Rationale', 'Created', 'Model estimate'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{logs.map((log, i) => <tr key={i}><td>{log.ticket_id}</td><td>{log.action}</td><td className="log-rationale">{log.rationale}</td>
            <td>{new Date(log.at).toLocaleString()}</td><td>{log.delay_probability === null ? 'No score' : `${Math.round(log.delay_probability * 100)}% · ${log.risk_band}`}
              <span className="secondary">Simulation</span></td></tr>)}</tbody></table></div>}
    </section></>;
}

function App() {
  const [route, setRoute] = useState(readRoute);
  const data = useTickets(api, route.page === 'closed');
  const [logs, setLogs] = useState([]);
  const [message, setMessage] = useState('');
  const needsTicket = ticketPages.includes(route.page);
  const listTicket = data.tickets.find((ticket) => ticket.id === route.id);
  const record = useResource(route.id, api.getRecord, data.revision, needsTicket && !listTicket && !data.loading);
  const baseTicket = listTicket ?? (record.value ? ticketFromRecord(record.value) : null);
  const detail = useResource(baseTicket?.id, api.getPrediction, data.revision,
    Boolean(baseTicket) && ['ticket', 'closed-record', 'decision', 'missing'].includes(route.page) && baseTicket.scoreStatus !== 'invalid');
  const selected = baseTicket ? { ...baseTicket,
    prediction: detail.value ?? baseTicket.prediction,
    scoreStatus: detail.value ? 'ready' : detail.error?.status === 422 ? 'invalid' : detail.error && !baseTicket.prediction ? 'unavailable' : baseTicket.scoreStatus,
    scoreError: detail.error?.status === 422 ? detail.error.message : baseTicket.scoreError,
  } : null;
  const page = route.page === 'ticket' && selected?.scoreStatus === 'invalid' ? 'missing'
    : route.page === 'missing' && selected?.prediction ? 'ticket' : route.page;
  const similar = useResource(selected?.id, api.getSimilar, data.revision, page === 'similar');

  useEffect(() => {
    const handler = () => setRoute(readRoute());
    window.addEventListener('hashchange', handler);
    window.addEventListener('popstate', handler);
    return () => { window.removeEventListener('hashchange', handler); window.removeEventListener('popstate', handler); };
  }, []);
  useEffect(() => {
    if (!message) return;
    const timeout = setTimeout(() => setMessage(''), 5000);
    return () => clearTimeout(timeout);
  }, [message]);

  function go(next, ticket = selected) {
    const id = ticketPages.includes(next) || next === 'saved' ? ticket?.id ?? null : null;
    setRoute({ page: next, id });
    history.pushState(null, '', `#${next}${id ? `/${encodeURIComponent(id)}` : ''}`);
    window.scrollTo(0, 0);
  }
  function exportLog() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ historical: true, session_only: true,
      generated_at: new Date().toISOString(), records: logs }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = '311_review_log.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('Exported the session review log. No City request changed.');
  }

  let content;
  if (page === 'log') content = <ActionLog logs={logs} exportLog={exportLog} go={go} />;
  else if (page === 'saved') content = <section className="card state"><div className="bigicon">✓</div><h1>Review recorded.</h1>
    <p>{logs.at(-1)?.action} · {logs.at(-1)?.ticket_id}</p><Notice type="success">Saved in this browser session. No City request changed.</Notice>
    <div className="actions score-progress"><Button primary onClick={() => go('queue')}>Return to review queue</Button><Button onClick={() => go('log')}>View action log</Button></div></section>;
  else if (data.loading) content = <Loading />;
  else if (data.error && !data.tickets.length) content = <Failure title="Tickets could not be loaded" message={data.error} retry={data.reload} />;
  else if (page === 'queue' || page === 'closed') content = <TicketList key={`${page}:${data.revision}`} tickets={data.tickets}
    total={data.total} page={data.page} setPage={data.setPage} scoring={data.scoring} closed={page === 'closed'} go={go} />;
  else if (!selected) content = record.loading ? <Loading>Loading request…</Loading> : <Failure
    title={record.error?.status === 404 || !route.id ? 'Ticket not found' : 'Request unavailable'}
    message={record.error?.message ?? 'This request does not exist in the historical data.'}
    retry={record.error && record.error.status !== 404 ? record.retry : undefined}>
    <Button onClick={() => go('queue')}>Return to queue</Button></Failure>;
  else {
    const body = page === 'missing' ? <Unscorable ticket={selected} go={go} />
      : page === 'closed-record' ? <ClosedRecord ticket={selected} go={go} />
        : page === 'similar' ? <SimilarPage resource={similar} go={go} />
          : page === 'policy' ? <PolicyPage key={selected.id} go={go} />
            : page === 'decision' ? <DecisionPage key={selected.id} ticket={selected} go={go} onSave={(entry) => { setLogs((previous) => [...previous, entry]); go('saved'); }} />
              : <TicketPage key={selected.id} ticket={selected} detail={detail} go={go} />;
    content = <><div className="crumb"><button className="textbtn" onClick={() => go(selected.status === 'Closed' ? 'closed' : 'queue')}>
      {selected.status === 'Closed' ? 'Closed tickets' : 'Review queue'}</button><span>/</span>{selected.id}</div>
      {!['closed-record', 'decision'].includes(page) && <><Head title={`${selected.id} : ${selected.category}`}>
        <Button primary onClick={() => go('decision')}>Record a review decision →</Button></Head>
        <div className="tabs">{[['ticket', 'Risk & explanation'], ['similar', 'Similar tickets'], ['policy', 'Policy guidance']].map(([key, label]) =>
          <button key={key} className={`tab ${page === key || page === 'missing' && key === 'ticket' ? 'active' : ''}`} onClick={() => go(key)}>{label}</button>)}</div></>}
      {body}</>;
  }
  const activeSection = ['queue', 'closed', 'log'].includes(page) ? page : selected?.status === 'Closed' ? 'closed' : 'queue';
  return <div className="shell"><aside className="sidebar">{navItems.map(([key, label, icon]) => <button key={key}
    className={`navbutton ${activeSection === key ? 'active' : ''}`} aria-current={activeSection === key ? 'page' : undefined} onClick={() => go(key)}>
    <span aria-hidden="true">{icon}</span>{label}</button>)}</aside><div className="workspace">
    <header className="topbar"><div className="topbar-brand"><img className="app-logo" src={`${import.meta.env.BASE_URL}311-logo.png`} alt="" width="40" height="40" />
      <strong>Philadelphia 311 Delay Insight</strong></div><div><span>Dispatcher view</span><b className="avatar">DD</b></div></header>
    <main className="content"><div className="dataset-banner"><div><span className="sourcetag">HISTORICAL DATA · MODEL ESTIMATES</span>
      <p>Saved Philadelphia 311 requests. Status reflects the export; this is not a live City queue.</p></div>
      <Button disabled={data.loading || data.scoring} onClick={data.reload}>Reload tickets</Button></div>
      {data.error && data.tickets.length > 0 && <div className="request-warning" role="alert"><Notice type="warning">{data.error} Scores are unavailable until a successful retry.</Notice><Button onClick={data.reload}>Retry scoring</Button></div>}
      {content}
    </main></div>{message && <div className="toast" role="status">{message}</div>}</div>;
}

createRoot(document.getElementById('root')).render(<App />);
