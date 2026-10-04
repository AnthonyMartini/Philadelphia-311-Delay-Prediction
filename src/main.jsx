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
  { ...tickets[0], id: "HIST-1017", submitted: "Sep 01", closed: "Sep 25, 2026", days: 24 },
  { ...tickets[1], id: "HIST-1088", submitted: "Aug 20", closed: "Sep 27, 2026", days: 38 },
  { ...tickets[3], id: "HIST-1124", submitted: "Sep 10", closed: "Sep 29, 2026", days: 19 },
];
const policyURL =
  "https://www.phila.gov/services/trash-recycling-city-upkeep/report-a-problem-with-trash-recycling-or-city-upkeep/track-a-service-request-with-311/";
const pages = [
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
  ["closed", "Historical Closed Tickets", "▤"],
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
    tickets.find((t) => t.id === id) ||
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
  const [logs, setLogs] = useState([]);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("risk");
  const [noMatches, setNoMatches] = useState(false);
  const [question, setQuestion] = useState(
    "How can a resident check the status of an existing 311 request?",
  );
  const [answer, setAnswer] = useState("supported");
  const [action, setAction] = useState(actions[0]);
  const [rationale, setRationale] = useState("");
  const [ack, setAck] = useState(false);
  const [error, setError] = useState("");

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
    if (next === "similar") setNoMatches(false);
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
        isClosed || filter === "all" ||
        (filter === "high" && t.risk !== null && t.risk >= 60) ||
        (filter === "missing" && t.risk === null),
    )
    .sort((a, b) =>
      isClosed ? b.closed.localeCompare(a.closed) : sort === "risk"
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
            className={`navbutton ${page === key || (key === "queue" && ["ticket", "similar", "policy", "decision", "saved", "missing"].includes(page)) ? "active" : ""}`}
            aria-current={page === key || (key === "queue" && ["ticket", "similar", "policy", "decision", "saved", "missing"].includes(page)) ? "page" : undefined}
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
            <div className="brandicon">311</div>
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
              <Head title={isClosed ? "Historical Closed Tickets" : "Review Queue"} />
              {!isClosed && <div className="grid three">
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
              </div>}

              <section className="card tablecard">
                <div className="toolbar">
                  <h2 style={{ margin: 0 }}>{isClosed ? "Closed Requests" : "Incoming review queue"}</h2>
                  <div className="filters">
                    <input
                      type="search"
                      aria-label="Search tickets"
                      placeholder="Search ID, category or ZIP"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {!isClosed && <select
                      aria-label="Filter risk"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">All risk levels</option>
                      <option value="high">Elevated risk</option>
                      <option value="missing">Needs data review</option>
                    </select>}
                    {!isClosed && <select
                      aria-label="Sort tickets"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="risk">Risk: high to low</option>
                      <option value="time">Submission time</option>
                    </select>}
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
                          {isClosed ? <strong>{t.id}</strong> : <button
                            className="ticketlink"
                            onClick={() => go("ticket", t)}
                          >
                            {t.id}
                          </button>}
                          <span className="secondary">{t.category}</span>
                        </td>
                        <td>{t.dept}</td>
                        <td>{t.zip}</td>
                        <td>
                          {t.time}
                          <span className="secondary">{t.submitted || "Oct 03"}</span>
                        </td>
                        <td>
                          {isClosed ? t.closed : <Risk ticket={t} />}
                        </td>
                        <td className="right">
                          {isClosed ? `${t.days} days` : <button
                            className="textbtn"
                            onClick={() => go("ticket", t)}
                          >
                            Review →
                          </button>}
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
                  <span>Showing {rows.length} of {queueTickets.length} requests</span>
                  <span>{isClosed ? "Sample historical records" : "All scores are estimates"}</span>
                </div>
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
                  </div>
                  {selected.id === "DEMO-1042" ? (
                    <>
                      <div className="figurelabel">
                        <span>Estimated contributions in log-odds</span>
                        <span>Moves toward delay →</span>
                      </div>
                      {[
                        ["Prior local request volume", 92, "+1.10"],
                        ["Service category", 59, "+0.70"],
                        ["Submission month", 30, "+0.35"],
                        ["Intake channel", 9, "−0.10"],
                      ].map(([label, width, value], i) => (
                        <div className="factor" key={label}>
                          <span>{label}</span>
                          <div className={`track ${i === 3 ? "negative" : ""}`}>
                            <span style={{ width: `${width}%` }} />
                          </div>
                          <strong>{value}</strong>
                        </div>
                      ))}
                      <div className="equation">
                        <div>
                          Base log-odds<strong>−0.80</strong>
                        </div>
                        <span>+</span>
                        <div>
                          Contributions<strong>2.05</strong>
                        </div>
                        <span>=</span>
                        <div>
                          Output log-odds<strong>1.25</strong>
                        </div>
                        <span>→</span>
                        <div>
                          Probability<strong>≈ 78%</strong>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <Notice type="warning">
                        This secondary ticket has an estimated risk score only.
                        A ticket-specific SHAP breakdown is not supplied. Open
                        DEMO-1042 to inspect the worked explanation layout.
                      </Notice>
                      <Button onClick={() => go("ticket", tickets[0])}>
                        Open worked explanation
                      </Button>
                    </>
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
              <Head
                title="Comparable closed records"
                subtitle="Planned: metadata summaries → embeddings → category-filtered retrieval."
              >
                <Button onClick={() => setNoMatches(true)}>
                  Test no matches
                </Button>
              </Head>
              {noMatches ? (
                <div className="card empty">
                  <h2>No supported matches found</h2>
                  <p className="muted small">
                    Try broader intake metadata. Never invent a past resolution.
                  </p>
                  <Button onClick={() => setNoMatches(false)}>
                    Return to demo matches
                  </Button>
                </div>
              ) : (
                <div className="grid three">
                  {[24, 38, 19].map((days, i) => (
                    <article className="card" key={i}>
                      <h2 style={{ marginTop: 18 }}>
                        {["HIST-DEMO-017", "HIST-DEMO-088", "HIST-DEMO-124"][i]}
                      </h2>
                      <p className="small">{selected.category}</p>
                      <div className="rule" />
                      <div className="meta">
                        {[
                          ["Status", "Closed"],
                          ["Estimated closure age", `${days} days`],
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
                        onClick={() =>
                          setMessage(
                            "Mock record only. No audited source record is available.",
                          )
                        }
                      >
                        Inspect source record ↗
                      </button>
                    </article>
                  ))}
                </div>
              )}
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
                      <h2>Ask the policy assistant</h2>
                      <p>Optional · official sources only</p>
                    </div>
                    <span className="pill neutral">Prewritten demo</span>
                  </div>
                  <label htmlFor="question">Operational question</label>
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
                    <Button
                      onClick={() => {
                        setQuestion(
                          "Which crew can guarantee that this ticket will be fixed tomorrow?",
                        );
                        setAnswer("unsupported");
                      }}
                    >
                      Try unsupported question
                    </Button>
                    <button
                      className="textbtn"
                      onClick={() => setAnswer("offline")}
                    >
                      Test service unavailable
                    </button>
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
                    {answer === "offline" && (
                      <>
                        <span className="pill neutral">
                          Retrieval unavailable · simulated
                        </span>
                        <h2 style={{ marginTop: 15 }}>
                          Prediction review still works.
                        </h2>
                        <p className="muted small">
                          The optional knowledge service is unavailable. Do not
                          generate an ungrounded answer.
                        </p>
                        <div className="actions">
                          <Button onClick={() => go("policy")}>
                            Retry demo
                          </Button>
                          <Button onClick={() => go("ticket")}>
                            Back to explanation
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </section>
                <aside className="card">
                  <h2>Evidence before an answer.</h2>
                  <p className="muted small">Planned retrieval contract</p>
                  {[
                    [
                      "Retrieve approved passages",
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
                    <span className="pill low">Official source</span>
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
                  <Notice type="warning">
                    No evidence? State the limit and retain a manual-review
                    path.
                  </Notice>
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
              <Head
                title="The dispatcher makes the decision."
                subtitle="Record a simulated action. This prototype never changes a City request."
              />
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
                  <span className="pill neutral">Selected request</span>
                  <h2 style={{ marginTop: 18 }}>
                    {selected.id} · {selected.category}
                  </h2>
                  <p className="muted small">
                    ZIP {selected.zip} · {selected.dept}
                  </p>
                  <div className="rule" />
                  <h3>What the demo log retains</h3>
                  <p className="muted small">
                    Ticket reference, model marker, estimated probability,
                    selected action, reason and timestamp.
                  </p>
                  <Notice>
                    This app stores decisions in memory for this page session
                    only. Refresh or Reset clears them. Export creates a local
                    JSON copy.
                  </Notice>
                  <div className="rule" />
                  <h3>No automatic learning from a button click</h3>
                  <p className="muted small">
                    Only validated outcome records should enter a reviewed,
                    versioned retraining process.
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
                <div className="bigicon">!</div>
                <div className="eyebrow">Input validation</div>
                <h1>Not enough information to score.</h1>
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
              <Head
                title="A record of human review."
                subtitle="Session-only simulated decisions. No live ticket actions."
              />
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
          <div className="footer">
            <span>
              Explainable AI for 311 Complaint Escalation · AI Applications
            </span>
            <span>Simulated data · prototype v1.0</span>
          </div>
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
