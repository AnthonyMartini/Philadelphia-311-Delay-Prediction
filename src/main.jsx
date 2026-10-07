import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const tickets = [
  {
    id: "DEMO-1042",
    category: "Illegal dumping",
    dept: "Sanitation",
    zip: "19121",
    time: "09:12",
    risk: 78,
    channel: "Web",
    volume: 43,
  },
  {
    id: "DEMO-1043",
    category: "Pothole",
    dept: "Streets ",
    zip: "19145",
    time: "09:24",
    risk: 64,
    channel: "Phone",
    volume: 31,
  },
  {
    id: "DEMO-1044",
    category: "Street light outage",
    dept: "Streets ",
    zip: "19134",
    time: "09:31",
    risk: 42,
    channel: "Mobile app",
    volume: 20,
  },
  {
    id: "DEMO-1045",
    category: "Graffiti removal",
    dept: "Public property ",
    zip: "19147",
    time: "09:42",
    risk: 21,
    channel: "Web",
    volume: 12,
  },
  {
    id: "DEMO-1046",
    category: "Category missing",
    dept: "Unverified",
    zip: "19132",
    time: "09:51",
    risk: null,
    channel: "Web",
    volume: null,
  },
];
const closedTickets = [
  {
    ...tickets[0],
    id: "HIST-1017",
    submitted: "Sep 01",
    closed: "Sep 25, 2026",
    days: 24,
  },
  {
    ...tickets[1],
    id: "HIST-1088",
    submitted: "Aug 20",
    closed: "Sep 27, 2026",
    days: 38,
  },
  {
    ...tickets[3],
    id: "HIST-1124",
    submitted: "Sep 10",
    closed: "Sep 29, 2026",
    days: 19,
  },
];
// Illustrative contributions for the wireframe; these are not fitted-model SHAP results.
const demoContributions = {
  "DEMO-1042": [1.1, 0.7, 0.35],
  "DEMO-1043": [0.75, 0.5, 0.2],
  "DEMO-1044": [0.3, 0.2, -0.12],
  "DEMO-1045": [-0.25, -0.2, 0.08],
};
function explanationFor(ticket) {
  if (ticket.risk === null) return null;
  const base = -0.8;
  const output = Math.log(ticket.risk / (100 - ticket.risk));
  const leading = demoContributions[ticket.id] || [0.3, 0.2, 0.1];
  const values = [
    ...leading,
    output - base - leading.reduce((sum, value) => sum + value, 0),
  ];
  return {
    base,
    output,
    total: output - base,
    factors: values.map((value, i) => ({
      label: [
        "Prior local request volume",
        "Service category",
        "Submission month",
        "Intake channel",
      ][i],
      value,
    })),
  };
}
const signed = (value) =>
  `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(2)}`;
const policyURL =
  "https://www.phila.gov/services/trash-recycling-city-upkeep/report-a-problem-with-trash-recycling-or-city-upkeep/track-a-service-request-with-311/";
const pages = [
  "closed-record",
  "queue",
  "closed",
  "ticket",
  "similar",
  "policy",
  "decision",
  "saved",
  "missing",
  "log",
];
const navItems = [
  ["queue", "Review Queue", "▦"],
  ["closed", "Closed Tickets", "▤"],
  ["log", "Action Log", "☷"],
];
const actions = [
  "Request expedited review",
  "Confirm standard processing",
  "Request more information",
];
const actionDescriptions = [
  "Ask a human to review potential delay; not an automatic priority change.",
  "Preserve the normal handling pathway.",
  "Resolve missing or uncertain inputs without assuming low risk.",
];

function readRoute() {
  const [page, id] = location.hash.slice(1).split("/");
  const selected =
    [...tickets, ...closedTickets].find((t) => t.id === id) ||
    (page === "missing" ? tickets[4] : tickets[0]);
  return {
    page: pages.includes(page) && page !== "saved" ? page : "queue",
    selected,
  };
}
function Button({ children, primary, onClick, ...props }) {
  return (
    <button
      className={`btn${primary ? " primary" : ""}`}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
}
function Notice({ children, type = "" }) {
  return <div className={`notice ${type}`}>{children}</div>;
}
function Head({ title, subtitle, children }) {
  return (
    <div className="head">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}
function Risk({ ticket }) {
  if (ticket.risk === null)
    return <span className="pill neutral">No score</span>;
  const level =
    ticket.risk >= 60 ? "high" : ticket.risk >= 35 ? "medium" : "low";
  return <span className={`prob ${level}`}>{ticket.risk}%</span>;
}

function App() {
  const [route, setRoute] = useState(readRoute);
  const { page, selected } = route;
  const activeSection =
    page === "closed-record"
      ? "closed"
      : [
            "ticket",
            "similar",
            "policy",
            "decision",
            "saved",
            "missing",
          ].includes(page)
        ? "queue"
        : page;
  const explanation = explanationFor(selected);
  const [logs, setLogs] = useState([]);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("risk");
  const [question, setQuestion] = useState(
    "How can a resident check the status of an existing 311 request?",
  );
  const [answer, setAnswer] = useState("supported");
  const [action, setAction] = useState(actions[0]);
  const [rationale, setRationale] = useState("");
  const [ack, setAck] = useState(false);
  const [error, setError] = useState("");
  const [explainedTicket, setExplainedTicket] = useState(null);

  useEffect(() => {
    setExplainedTicket(null);
  }, [page, selected.id]);

  useEffect(() => {
    const handler = () => setRoute(readRoute());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 5500);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    if (answer !== "loading" || page !== "policy") return;
    const timer = setTimeout(
      () =>
        setAnswer(
          /(status|track|check)/i.test(question) &&
            !/(guarantee|crew|tomorrow)/i.test(question)
            ? "supported"
            : "unsupported",
        ),
      650,
    );
    return () => clearTimeout(timer);
  }, [answer, page, question]);

  function go(next, ticket = selected) {
    if (next === "ticket" && ticket.risk === null) next = "missing";
    setRoute({ page: next, selected: ticket });
    history.pushState(null, "", `#${next}/${ticket.id}`);
    if (next === "queue" || next === "closed") {
      setSearch("");
      setFilter("all");
      setSort("risk");
    }
    if (next === "policy") {
      setAnswer("supported");
      setQuestion(
        "How can a resident check the status of an existing 311 request?",
      );
    }
    if (next === "decision") {
      setAction(ticket.risk === null ? actions[2] : actions[0]);
      setRationale("");
      setAck(false);
      setError("");
    }
    window.scrollTo(0, 0);
  }
  useEffect(() => {
    const handler = () => setRoute(readRoute());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);
  function exportLog() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              prototype: true,
              generated_at: new Date().toISOString(),
              records: logs,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "311_demo_action_log.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("Exported a local demo log. Nothing was submitted to the City.");
  }
  function saveDecision(event) {
    event.preventDefault();
    if (rationale.trim().length < 10 || !ack) {
      setError(
        "Add a rationale of at least 10 characters and acknowledge the prototype safeguards.",
      );
      return;
    }
    setLogs((previous) => [
      ...previous,
      {
        ticket_id: selected.id,
        action,
        rationale: rationale.trim(),
        at: new Date().toISOString(),
        risk: selected.risk,
        model: "MOCK-NO-MODEL",
        city_submission: false,
      },
    ]);
    go("saved");
  }
  const isClosed = page === "closed";
  const queueTickets = isClosed ? closedTickets : tickets;
  const rows = queueTickets
    .filter((t) =>
      `${t.id} ${t.category} ${t.zip}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .filter(
      (t) =>
        isClosed ||
        filter === "all" ||
        (filter === "high" && t.risk !== null && t.risk >= 60) ||
        (filter === "missing" && t.risk === null),
    )
    .sort((a, b) =>
      isClosed
        ? b.closed.localeCompare(a.closed)
        : sort === "risk"
          ? (b.risk ?? -1) - (a.risk ?? -1)
          : a.time.localeCompare(b.time),
    );
  const ticketTabs = (
    <>
      <div className="crumb">
        <button className="textbtn" onClick={() => go("queue")}>
          Review queue
        </button>
        <span>/</span>
        {selected.id}
      </div>
      <div className="head">
        <div>
          <h1>
            {selected.id} : {selected.category}
          </h1>
        </div>
        <Button primary onClick={() => go("decision")}>
          Record a review decision →
        </Button>
      </div>
      <div className="tabs">
        {[
          ["ticket", "Risk & explanation"],
          ["similar", "Similar tickets"],
          ["policy", "Policy guidance"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`tab ${page === key ? "active" : ""}`}
            onClick={() => go(key)}
          >
            {label}{" "}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        {navItems.map(([key, label, icon]) => (
          <button
            key={key}
            className={`navbutton ${activeSection === key ? "active" : ""}`}
            aria-current={activeSection === key ? "page" : undefined}
            onClick={() => go(key)}
          >
            <span aria-hidden="true">{icon}</span>
            {label}
          </button>
        ))}
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-brand">
            <img
              className="app-logo"
              src={`${import.meta.env.BASE_URL}311-logo.png`}
              alt=""
              width="40"
              height="40"
            />
            <strong>Philadelphia 311 Delay Insight</strong>
          </div>
          <div>
            <span>Demo dispatcher</span>
            <b className="avatar">DD</b>
          </div>
        </header>

        <main className="content" aria-live="polite">
          {(page === "queue" || isClosed) && (
            <>
              <Head
                title={isClosed ? "Historical Closed Tickets" : "Review Queue"}
              />
              {!isClosed && (
                <div className="grid three">
                  {[
                    ["Requests", "5"],
                    ["Requests at Risk", "2"],
                    ["Requests Needing Data Review", "1"],
                  ].map(([label, num], i) => (
                    <div className={`card kpi kpi-${i + 1}`} key={label}>
                      <div className="label">{label}</div>
                      <div className="num">{num}</div>
                    </div>
                  ))}
                </div>
              )}

              <section className="card tablecard">
                <div className="toolbar">
                  <h2 style={{ margin: 0 }}>
                    {isClosed ? "Closed Requests" : "Incoming Review Queue"}
                  </h2>
                  <div className="filters">
                    <input
                      type="search"
                      aria-label="Search tickets"
                      placeholder="Search ID, category or ZIP"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {!isClosed && (
                      <select
                        aria-label="Filter risk"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option value="all">All risk levels</option>
                        <option value="high">Elevated risk</option>
                        <option value="missing">Needs data review</option>
                      </select>
                    )}
                    {!isClosed && (
                      <select
                        aria-label="Sort tickets"
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        <option value="risk">Risk: high to low</option>
                        <option value="time">Submission time</option>
                      </select>
                    )}
                  </div>
                </div>
                <table>
                  <thead>
                    <tr>
                      {[
                        "Request / category",
                        "Department",
                        "ZIP",
                        "Submitted",
                        isClosed ? "Closed" : "Delay risk",
                        ...(!isClosed ? ["Needs Data Review"] : []),
                        isClosed ? "Days to close" : "",
                      ].map((label, i) => (
                        <th key={i} scope="col">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => (
                      <tr className="clickrow" key={t.id}>
                        <td>
                          {isClosed ? (
                            <button
                              className="ticketlink"
                              onClick={() => go("closed-record", t)}
                            >
                              {t.id}
                            </button>
                          ) : (
                            <button
                              className="ticketlink"
                              onClick={() => go("ticket", t)}
                            >
                              {t.id}
                            </button>
                          )}
                          <span className="secondary">{t.category}</span>
                        </td>
                        <td>{t.dept}</td>
                        <td>{t.zip}</td>
                        <td>
                          {t.time}
                          <span className="secondary">
                            {t.submitted || "Oct 03"}
                          </span>
                        </td>
                        <td>{isClosed ? t.closed : <Risk ticket={t} />}</td>
                        {!isClosed && (
                          <td>
                            {t.risk === null ? (
                              <span className="pill high">Yes</span>
                            ) : (
                              "No"
                            )}
                          </td>
                        )}
                        <td className="right">
                          {isClosed ? (
                            `${t.days} days`
                          ) : (
                            <button
                              className="textbtn"
                              onClick={() => go("ticket", t)}
                            >
                              Review →
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length && (
                  <div className="empty">
                    <h2>No matching requests</h2>
                    <p className="muted small">
                      Try another search or risk filter.
                    </p>
                  </div>
                )}
                <div className="tablefoot">
                  <span>
                    Showing {rows.length} of {queueTickets.length} requests
                  </span>
                </div>
              </section>
            </>
          )}

          {page === "closed-record" && (
            <>
              <div className="crumb">
                <button className="textbtn" onClick={() => go("closed")}>
                  Historical Closed Tickets
                </button>
                <span>/</span>
                {selected.id}
              </div>
              <Head title={`${selected.id} : ${selected.category}`}>
                <span className="pill low">Closed</span>
              </Head>
              <section className="card">
                <h2>Request Details</h2>
                <div className="meta">
                  {[
                    ["Request ID", selected.id],
                    ["Service category", selected.category],
                    ["Status", "Closed"],
                    ["Department", selected.dept.trim()],
                    ["Location", `ZIP ${selected.zip}`],
                    ["Intake channel", selected.channel],
                    [
                      "Submitted",
                      `${selected.submitted}, 2026 · ${selected.time}`,
                    ],
                    ["Closed", selected.closed],
                    ["Time to close", `${selected.days} days`],
                    [
                      "Prior 7-day volume at intake",
                      `${selected.volume} requests`,
                    ],
                    ["Risk estimate at intake", `${selected.risk}%`],
                    ["Resolution notes", "Not available"],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <div className="key">{label}</div>
                      <div className="value">{value}</div>
                    </div>
                  ))}
                </div>
                <div className="rule" />
                <Button onClick={() => go("closed")}>
                  Back to Closed Tickets
                </Button>
              </section>
            </>
          )}
          {page === "ticket" && (
            <>
              {ticketTabs}
              <div className="grid detailgrid">
                <section className="card">
                  <h2 style={{ marginTop: 20 }}>Estimated delay risk</h2>
                  <div className="riskfigure">
                    {selected.risk}
                    <span>%</span>
                  </div>
                  <p className="muted small">
                    Estimated probability, not a measured prediction.
                  </p>
                  <div className="gauge">
                    <div style={{ width: `${selected.risk}%` }} />
                  </div>
                  <div className="meta">
                    {[
                      ["Department", selected.dept],
                      ["Submitted", `${selected.time} · Oct 03`],
                      ["Intake channel", selected.channel],
                      ["Location", `ZIP ${selected.zip}`],
                      ["Prior 7-day volume", `${selected.volume} requests`],
                    ].map(([key, value]) => (
                      <div key={key}>
                        <div className="key">{key}</div>
                        <div className="value">{value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rule" />
                </section>
                <section className="card">
                  <div className="head">
                    <div>
                      <h2>SHAP Breakdown</h2>
                    </div>
                    <Button
                      aria-expanded={explainedTicket === selected.id}
                      aria-controls="shap-explanation"
                      onClick={() =>
                        setExplainedTicket(
                          explainedTicket === selected.id ? null : selected.id,
                        )
                      }
                    >
                      {explainedTicket === selected.id
                        ? "Hide Explanation"
                        : "Ask AI to Explain✨"}
                    </Button>
                  </div>
                  {explanation && (
                    <>
                      <div className="figurelabel">
                        <span>Illustrative contributions in log-odds</span>
                        <span>Blue increases risk · gray decreases risk</span>
                      </div>
                      {explanation.factors.map(({ label, value }) => (
                        <div className="factor" key={label}>
                          <span>{label}</span>
                          <div
                            className={`track ${value < 0 ? "negative" : ""}`}
                          >
                            <span
                              style={{
                                width: `${(Math.abs(value) / 1.2) * 100}%`,
                              }}
                            />
                          </div>
                          <strong>{signed(value)}</strong>
                        </div>
                      ))}
                      <div className="equation">
                        <div>
                          Base log-odds
                          <strong>{explanation.base.toFixed(2)}</strong>
                        </div>
                        <span>+</span>
                        <div>
                          Contributions
                          <strong>{signed(explanation.total)}</strong>
                        </div>
                        <span>=</span>
                        <div>
                          Output log-odds
                          <strong>{explanation.output.toFixed(2)}</strong>
                        </div>
                        <span>→</span>
                        <div>
                          Probability<strong>≈ {selected.risk}%</strong>
                        </div>
                      </div>
                    </>
                  )}
                  {explanation && explainedTicket === selected.id && (
                    <div
                      id="shap-explanation"
                      className="answer"
                      style={{ marginTop: 20 }}
                    >
                      <h3>Understanding this estimate</h3>
                      <p className="muted small">
                        Sample explanation · AI service not connected
                      </p>
                      <p>
                        This ticket starts from a baseline risk of{" "}
                        {Math.round(100 / (1 + Math.exp(-explanation.base)))}%.
                        The contributions below move that estimate to{" "}
                        {selected.risk}%.
                      </p>
                      <ul>
                        {[...explanation.factors]
                          .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
                          .map(({ label, value }) => (
                            <li key={label}>
                              <strong>{label}</strong>{" "}
                              {value < 0 ? "lowers" : "raises"} the estimate (
                              {signed(value)} log-odds).
                            </li>
                          ))}
                      </ul>
                      <p>
                        The largest influence is{" "}
                        {[...explanation.factors]
                          .sort(
                            (a, b) => Math.abs(b.value) - Math.abs(a.value),
                          )[0]
                          .label.toLowerCase()}
                        . These values describe contributions to the estimate,
                        not the causes of a delay.
                      </p>
                      <p className="muted small">
                        Log-odds contributions are added to the baseline and
                        converted to a probability. They are not
                        percentage-point changes.
                      </p>
                    </div>
                  )}
                  <div className="actions" style={{ marginTop: 22 }}>
                    <Button onClick={() => go("similar")}>
                      Find similar tickets →
                    </Button>
                    <Button onClick={() => go("policy")}>
                      Check official guidance →
                    </Button>
                  </div>
                </section>
              </div>
            </>
          )}

          {page === "similar" && (
            <>
              {ticketTabs}
              <Head title="Comparable Closed Records" />
              <div className="grid three">
                {closedTickets.map((record) => (
                  <article className="card" key={record.id}>
                    <h2 style={{ marginTop: 18 }}>{record.id}</h2>
                    <p className="small">{record.category}</p>
                    <div className="rule" />
                    <div className="meta">
                      {[
                        ["Status", "Closed"],
                        ["Time to close", `${record.days} days`],
                        ["Match basis", "Category + intake context"],
                        ["Handling notes", "Not available"],
                      ].map(([key, value]) => (
                        <div key={key}>
                          <div className="key">{key}</div>
                          <div className="value">{value}</div>
                        </div>
                      ))}
                    </div>
                    <p className="muted small" style={{ marginTop: 22 }}>
                      Closure status alone does not document how an issue was
                      resolved.
                    </p>
                    <button
                      className="textbtn"
                      onClick={() => go("closed-record", record)}
                    >
                      Inspect source record ↗
                    </button>
                  </article>
                ))}
              </div>
              <div className="actions" style={{ marginTop: 20 }}>
                <Button primary onClick={() => go("policy")}>
                  Open policy guidance →
                </Button>
                <Button onClick={() => go("ticket")}>
                  Back to explanation
                </Button>
              </div>
            </>
          )}

          {page === "policy" && (
            <>
              {ticketTabs}
              <div className="grid policygrid">
                <section className="card">
                  <div className="head">
                    <div>
                      <h2>Ask the AI Policy Assistant ✨</h2>
                    </div>
                  </div>
                  <label htmlFor="question">Operational Question</label>
                  <textarea
                    id="question"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    disabled={answer === "loading"}
                  />
                  <div className="actions" style={{ margin: "12px 0 19px" }}>
                    <Button
                      primary
                      disabled={answer === "loading"}
                      onClick={() =>
                        question.trim()
                          ? setAnswer("loading")
                          : setMessage("Enter a question first.")
                      }
                    >
                      Retrieve guidance
                    </Button>
                  </div>
                  <div className="answer">
                    {answer === "supported" && (
                      <>
                        <span className="sourcetag">
                          DEMO ANSWER · based on official public guidance
                        </span>
                        <p style={{ marginTop: 12 }}>
                          Use the service request number to look up the request.
                          If a case is private, the resident may need the
                          account used when submitting it. A resident can also
                          contact 311 for a status update.
                        </p>
                        <p className="muted small">
                          This guidance does not guarantee a completion date or
                          identify a crew. It is a prewritten source-based
                          response, not an LLM response.
                        </p>
                        <a
                          className="textbtn"
                          href={policyURL}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          [1] Track a service request with 311 ↗
                        </a>
                      </>
                    )}
                    {answer === "loading" && (
                      <>
                        <h3>Retrieving approved context…</h3>
                        <div className="loading" />
                        <p className="muted small">
                          Simulated loading state. No API is called.
                        </p>
                      </>
                    )}
                    {answer === "unsupported" && (
                      <>
                        <span className="pill high">
                          Unsupported by available sources
                        </span>
                        <h2 style={{ marginTop: 17 }}>
                          No verified instruction available.
                        </h2>
                        <p>
                          I cannot verify a crew assignment, internal escalation
                          rule, or guaranteed completion time from the approved
                          source in this prototype.
                        </p>
                        <p className="muted small">
                          Consult the responsible department or official
                          guidance.
                        </p>
                        <div className="actions">
                          <Button onClick={() => go("decision")}>
                            Continue to human review
                          </Button>
                          <Button onClick={() => go("policy")}>
                            Return to supported question
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </section>
                <aside className="card">
                  <h2>Evidence Before an Answer.</h2>
                  <p className="muted small">
                    Where generated answers come from
                  </p>
                  {[
                    [
                      "Retrieve approved sources",
                      "Official City pages with source URLs.",
                    ],
                    [
                      "Answer from context only",
                      "Treat retrieved text as data, not instructions.",
                    ],
                    [
                      "Validate citations",
                      "Check source IDs and claim support.",
                    ],
                  ].map(([title, sub], i) => (
                    <div className="stateline" key={title}>
                      <span className="stepbadge">{i + 1}</span>
                      <div>
                        <h3>{title}</h3>
                        <span className="muted small">{sub}</span>
                      </div>
                    </div>
                  ))}
                  <div className="sourcecard">
                    <h3 style={{ marginTop: 12 }}>
                      Track a service request with 311
                    </h3>
                    <p className="muted">
                      City of Philadelphia · reference supplied in prototype
                    </p>
                    <a
                      href={policyURL}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open original guidance ↗
                    </a>
                  </div>
                </aside>
              </div>
            </>
          )}

          {page === "decision" && (
            <>
              <div className="crumb">
                <button className="textbtn" onClick={() => go("ticket")}>
                  {selected.id}
                </button>
                <span>/</span>Human review
              </div>
              <Head title="Review a Ticket" />
              <div className="grid two">
                <section className="card">
                  <h2>Review decision</h2>
                  <form onSubmit={saveDecision}>
                    {actions.map((choice, i) => (
                      <label className="option" key={choice}>
                        <input
                          type="radio"
                          name="action"
                          value={choice}
                          checked={action === choice}
                          onChange={() => setAction(choice)}
                        />
                        <span>
                          <b>{choice}</b>
                          <br />
                          <small>{actionDescriptions[i]}</small>
                        </span>
                      </label>
                    ))}
                    <label htmlFor="rationale">
                      Review rationale <span className="muted">(required)</span>
                    </label>
                    <textarea
                      id="rationale"
                      value={rationale}
                      onChange={(e) => setRationale(e.target.value)}
                      maxLength={500}
                      placeholder="Review the intake category and workload signal; verify the appropriate handling path."
                      aria-describedby="decisionError"
                    />
                    <label className="checkrow">
                      <input
                        type="checkbox"
                        checked={ack}
                        onChange={(e) => setAck(e.target.checked)}
                      />
                      <span>
                        I understand the risk estimate is noncausal. This action
                        will not deprioritize a request or submit anything to
                        the City.
                      </span>
                    </label>
                    <p id="decisionError" className="error" role="alert">
                      {error}
                    </p>
                    <div className="actions">
                      <Button primary type="submit">
                        Save simulated decision
                      </Button>
                      <Button type="button" onClick={() => go("ticket")}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                </section>
                <section className="card">
                  <h2 style={{ marginTop: 18 }}>Ticket summary</h2>
                  <div className="meta">
                    {[
                      ["Request ID", selected.id],
                      ["Service category", selected.category],
                      ["Department", selected.dept.trim()],
                      ["Location", `ZIP ${selected.zip}`],
                      ["Intake channel", selected.channel],
                      ["Submitted", selected.time],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <div className="key">{label}</div>
                        <div className="value">{value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rule" />
                  <div className="risk-summary">
                    <div className="key">Estimated delay risk</div>
                    <div className="riskfigure">
                      {selected.risk === null ? "No score" : selected.risk}
                      {selected.risk !== null && <span>%</span>}
                    </div>
                    <p className="muted small">
                      {selected.risk === null
                        ? "A verified service category is needed before this request can be scored."
                        : `This is an estimated probability that the request may experience delay. Review the intake details before choosing an action.`}
                    </p>
                  </div>
                  <div className="rule" />
                  <h3>Review summary</h3>
                  <p className="muted small">
                    {selected.risk === null
                      ? "The missing category requires human review and data correction."
                      : `${selected.category} request received through ${selected.channel.toLowerCase()} intake in ZIP ${selected.zip}.`}
                  </p>
                </section>
              </div>
            </>
          )}

          {page === "saved" && (
            <section className="card state">
              <div className="bigicon">✓</div>
              <div className="eyebrow">Simulation recorded</div>
              <h1>Review recorded. No City request changed.</h1>
              <p className="muted">
                {logs.at(-1)?.action} for {logs.at(-1)?.ticket_id}
              </p>
              <Notice type="success">
                The human decision remains separate from the model output.
                Nothing was sent to a City system or an external AI service.
              </Notice>
              <div className="rule" />
              <div className="actions">
                <Button primary onClick={() => go("queue")}>
                  Return to review queue
                </Button>
                <Button onClick={() => go("log")}>View action log</Button>
                <Button onClick={exportLog}>Export demo log</Button>
              </div>
            </section>
          )}
          {page === "missing" && (
            <>
              <div className="crumb">
                <button className="textbtn" onClick={() => go("queue")}>
                  Review queue
                </button>
                <span>/</span>
                {selected.id}
              </div>
              <section className="card state">
                <div className="missing-state-heading">
                  <div className="bigicon" aria-hidden="true">
                    !
                  </div>
                  <h1>Not enough information to score.</h1>
                </div>
                <p className="muted">
                  {selected.id} has no verified service category. The prototype
                  does not substitute a reassuring low-risk number.
                </p>
                <Notice type="warning">
                  <strong>Prediction withheld.</strong> Preserve standard
                  processing and request data review.
                </Notice>
                <div className="rule" />
                <h3>Planned behavior</h3>
                <p className="muted small">
                  Check required fields, timestamp validity and supported
                  categories. Show what is missing; log the validation error;
                  allow human review.
                </p>
                <div className="actions">
                  <Button primary onClick={() => go("decision")}>
                    Request human review
                  </Button>
                  <Button onClick={() => go("queue")}>Return to queue</Button>
                </div>
              </section>
            </>
          )}
          {page === "log" && (
            <>
              <Head title="A record of human review." />
              <div className="actions" style={{ marginBottom: 18 }}>
                <Button onClick={exportLog}>Export JSON log</Button>
              </div>
              <section className="card tablecard">
                {logs.length ? (
                  <table>
                    <thead>
                      <tr>
                        {[
                          "Ticket",
                          "Action",
                          "Rationale",
                          "Created",
                          "Mode",
                        ].map((label) => (
                          <th scope="col" key={label}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log, i) => (
                        <tr key={i}>
                          <td>{log.ticket_id}</td>
                          <td>{log.action}</td>
                          <td
                            style={{ maxWidth: 380, overflowWrap: "anywhere" }}
                          >
                            {log.rationale}
                          </td>
                          <td>{new Date(log.at).toLocaleTimeString()}</td>
                          <td>
                            <span className="pill neutral">Simulation</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="empty">
                    <h2>No review decisions yet</h2>
                    <p className="muted small">
                      Open a ticket, review the evidence and save a simulated
                      decision.
                    </p>
                    <Button primary onClick={() => go("ticket", tickets[0])}>
                      Open ticket
                    </Button>
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
