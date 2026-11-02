"""Shared settings for the Philadelphia 311 delay-risk pipeline."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"          # put 311_requests_all.csv here (not committed)
ART_DIR = ROOT / "artifacts"      # model, metadata, metrics, figures
RAW_CSV = DATA_DIR / "311_requests_all.csv"

# Modeling window and time-based split (by requested date).
# Training data stops before validation; validation stops before test.
WINDOW_START = "2023-01-01"
TRAIN_END = "2024-12-31"
VAL_END = "2025-06-30"
TEST_END = "2026-06-30"   # leaves ~3 months before the data snapshot so most labels are known

RANDOM_STATE = 42
MIN_SERVICE_ROWS = 500    # rarer service types are grouped as "Other"
TOP_ZIPS = 60             # remaining ZIPs grouped as "Other"

CAT_FEATURES = ["service_name", "agency_responsible", "zipcode"]
NUM_FEATURES = [
    "sla_business_days",       # promised window stated at intake ("5 Business Days")
    "day_of_week",
    "prior_7d_service_volume",  # same-service requests in the 7 days before intake
    "prior_7d_zip_volume",      # same-ZIP requests in the 7 days before intake
    "backlog_share",            # same-service tickets from the prior 30 days still open at start of intake day,
                                # divided by same-service requests in the prior 30 days (scale-free)
]
FEATURES = CAT_FEATURES + NUM_FEATURES
# Dropped after testing: "month" (only two training years, so it learned year-specific events
# and hurt the future test period) and an all-time cumulative backlog (drifted upward every year).
TARGET = "delayed"

FEATURE_LABELS = {
    "service_name": "Service category",
    "agency_responsible": "Responsible department",
    "zipcode": "ZIP code",
    "sla_business_days": "Promised window (business days)",
    "day_of_week": "Day of week submitted",
    "prior_7d_service_volume": "Same-service requests, prior 7 days",
    "prior_7d_zip_volume": "Same-ZIP requests, prior 7 days",
    "service_backlog": "Open same-service backlog (last 30 days)",
    "backlog_share": "Share of last-30-day same-service requests still open",
}
