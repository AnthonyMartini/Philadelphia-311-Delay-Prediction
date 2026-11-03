"""Dispatcher dashboard: review queue -> delay estimate -> SHAP explanation -> similar tickets -> human review.

Run:  python -m streamlit run app.py
Decision support only. The model never closes, reroutes, or deprioritizes a request.
"""
import datetime as dt
import json

import altair as alt
import numpy as np
import pandas as pd
import streamlit as st

from . import config as C
from .scoring import DelayModel, read_tickets, risk_band, sigmoid, similar_tickets

st.set_page_config(page_title="311 Delay Insight", layout="wide")
LOG = C.ART_DIR / "review_log.jsonl"


@st.cache_resource
def load():
    model = DelayModel()
    demo = read_tickets(C.ART_DIR / "demo_tickets.csv")
    ref = read_tickets(C.ART_DIR / "reference_tickets.csv")
    demo["delay_prob"] = model.predict_proba(demo)
    return model, demo, ref


DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def fmt(feature, v):
    if feature == "day_of_week":
        return DAYS[int(v)]
    if feature == "backlog_share":
        return f"{float(v):.0%}"
    if isinstance(v, float):
        return "missing" if pd.isna(v) else f"{v:,.0f}"
    return str(v)


model, demo, ref = load()
thr = model.threshold
demo["risk"] = [risk_band(p, thr) for p in demo["delay_prob"]]

st.title("Philadelphia 311 — Delay Insight")
st.caption(f"Held-out tickets from {model.meta['test_period'][0]} to {model.meta['test_period'][1]}. "
           "Scores are live model output. Decision support only: do not deprioritize requests, "
           "and do not read ZIP-code effects as causes.")

# ---- 1. Review queue -------------------------------------------------------------
st.subheader("1 · Review queue")
c1, c2, c3 = st.columns([2, 1, 1])
q = c1.text_input("Search ID, category, or ZIP")
band = c2.selectbox("Risk level", ["All", "High", "Elevated", "Standard"])
dept = c3.selectbox("Department", ["All"] + sorted(demo["agency_responsible"].unique()))
view = demo
if q:
    ql = q.lower()
    view = view[view["request_id"].str.lower().str.contains(ql)
                | view["service_name"].str.lower().str.contains(ql)
                | view["zipcode"].astype(str).str.contains(ql)]
if band != "All":
    view = view[view["risk"] == band]
if dept != "All":
    view = view[view["agency_responsible"] == dept]
view = view.sort_values("delay_prob", ascending=False)
table = view[["request_id", "service_name", "agency_responsible", "zipcode", "requested_datetime",
              "service_notice", "delay_prob", "risk"]].rename(columns={
    "request_id": "Request", "service_name": "Category", "agency_responsible": "Department",
    "zipcode": "ZIP", "requested_datetime": "Submitted", "service_notice": "Promised window",
    "delay_prob": "Delay risk", "risk": "Band"})
table["Delay risk"] = (table["Delay risk"] * 100).round(0)   # show as 0-100 so the % label is right
st.dataframe(table.head(200), hide_index=True, use_container_width=True,
             column_config={"Delay risk": st.column_config.ProgressColumn(format="%.0f%%", min_value=0, max_value=100),
                            "Submitted": st.column_config.DateColumn()})
if view.empty:
    st.info("No tickets match these filters.")
    st.stop()

rid = st.selectbox("Open a ticket", view["request_id"].tolist())
t = view[view["request_id"] == rid].iloc[0]

# ---- 2. Estimate + explanation ---------------------------------------------------
st.subheader(f"2 · Estimate and explanation — {rid}")
left, right = st.columns([1, 2])
p = float(t["delay_prob"])
left.metric("Probability of missing the promised window", f"{p:.0%}", t["risk"], delta_color="off")
left.write(f"**Category:** {t['service_name']}  \n**Department:** {t['agency_responsible']}  \n"
           f"**ZIP:** {t['zipcode']}  \n**Submitted:** {t['requested_datetime']:%b %d, %Y}  \n"
           f"**Promised:** {t['service_notice']} (due {t['expected_datetime']:%b %d, %Y})")
left.caption(f"Flagged when the probability is {thr:.0%} or higher (more likely than not). "
             "High = at least 15 points above that.")

contrib = model.explain(view[view["request_id"] == rid]).iloc[0]
base = float(contrib["base"])
parts = contrib.drop("base")
expl = pd.DataFrame({
    "Factor": [C.FEATURE_LABELS[f] for f in parts.index],
    "Value": [fmt(f, t[f]) for f in parts.index],
    "Contribution (log-odds)": parts.values.round(3),
}).sort_values("Contribution (log-odds)", key=abs, ascending=False)
right.markdown("**Why this estimate (SHAP, exact TreeSHAP for this model)**")
expl["Direction"] = np.where(expl["Contribution (log-odds)"] >= 0, "Toward delay", "Toward on time")
chart = alt.Chart(expl).mark_bar().encode(
    x=alt.X("Contribution (log-odds):Q", title="Contribution (log-odds)"),
    y=alt.Y("Factor:N", sort=None, title=None, axis=alt.Axis(labelLimit=320)),
    color=alt.Color("Direction:N", scale=alt.Scale(domain=["Toward delay", "Toward on time"],
                                                   range=["#d1495b", "#2f5bea"]),
                    legend=alt.Legend(orient="bottom", title=None)),
    tooltip=["Factor", "Value", "Contribution (log-odds)"],
).properties(height=40 * len(expl) + 40)
right.altair_chart(chart, use_container_width=True)
right.dataframe(expl, hide_index=True, use_container_width=True)
right.caption(f"Base log-odds {base:+.2f} + contributions {parts.sum():+.2f} = {base + parts.sum():+.2f} "
              f"→ probability {sigmoid(base + parts.sum()):.0%}. Positive values push toward delay. "
              "These are associations in historical data, not causes.")

# ---- 3. Similar closed tickets ---------------------------------------------------
st.subheader("3 · Similar closed tickets (historical precedent)")
sim = similar_tickets(t, ref, k=3)
if sim.empty:
    st.write("No closed tickets of this category in the reference set.")
else:
    st.dataframe(pd.DataFrame({
        "Submitted": sim["requested_datetime"].dt.date, "ZIP": sim["zipcode"],
        "Promised window": sim["service_notice"], "Days to close": sim["resolution_days"],
        "Outcome": sim["delayed"].map({1: "Missed window", 0: "On time"})}),
        hide_index=True, use_container_width=True)

# ---- 4. Human review --------------------------------------------------------------
st.subheader("4 · Record review (simulated)")
with st.form("review"):
    action = st.radio("Decision", ["Standard processing", "Early review", "Contact department"], horizontal=True)
    why = st.text_area("Rationale (required)")
    ok = st.form_submit_button("Save decision")
if ok:
    if not why.strip():
        st.error("Please add a rationale before saving.")
    else:
        rec = {"ts": dt.datetime.now().isoformat(timespec="seconds"), "request_id": rid,
               "delay_prob": round(p, 4), "band": t["risk"], "decision": action, "rationale": why.strip()}
        with LOG.open("a") as f:
            f.write(json.dumps(rec) + "\n")
        st.success("Saved to the local review log. No city system was changed.")

with st.expander("Model card"):
    st.json({k: model.meta[k] for k in ("train_period", "val_period", "test_period", "trained_rows", "versions")})
    try:
        st.json(json.loads((C.ART_DIR / "metrics.json").read_text())["test_results"])
    except FileNotFoundError:
        pass
