"""Load immutable artifacts once and adapt the shared scorer to API responses."""
import hashlib
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from ml import config as C
from ml.scoring import DelayModel, read_tickets, risk_band, similar_tickets

from .schemas import (Contribution, DemoTicket, Explanation, ModelFeatures, Prediction,
                      SimilarTicket, SimilarTicketResponse, TicketInput)


class InputError(ValueError):
    def __init__(self, field, message, index=None):
        super().__init__(message)
        self.field = field
        self.index = index


class PredictionService:
    def __init__(self, art_dir: Path, model_threads: int = 1):
        self.model = DelayModel(art_dir, nthread=model_threads)
        fingerprint = hashlib.sha256()
        for name in ("xgb_model.json", "metadata.json"):
            fingerprint.update((art_dir / name).read_bytes())
        self.model_version = f"xgb-{fingerprint.hexdigest()[:16]}"
        self.demo_path = art_dir / "demo_tickets.csv"
        self.reference_path = art_dir / "reference_tickets.csv"
        self._demo = None
        self._reference = None

    def normalize(self, ticket: TicketInput, index=None):
        values = ticket.model_dump(include=set(C.FEATURES))
        warnings = []
        for field in C.CAT_FEATURES:
            levels = self.model.meta["categories"][field]
            value = values[field]
            if field == "zipcode":
                if value is None:
                    value = "Missing"
                elif value != "Missing":
                    value = value[:5]
            canonical = {level.casefold(): level for level in levels}
            if value.casefold() in canonical:
                values[field] = canonical[value.casefold()]
            elif field == "service_name" and "Other" in levels:
                values[field] = "Other"
                warnings.append("Unrecognized service_name was scored using the trained Other category.")
            else:
                raise InputError(field, f"Unsupported {field} for this model.", index)
        if values["zipcode"] == "Missing" and values["prior_7d_zip_volume"] != 0:
            raise InputError("prior_7d_zip_volume", "ZIP volume must be zero when ZIP is missing, matching training.", index)
        return ModelFeatures(**values), warnings

    def predict(self, tickets: list[TicketInput], include_explanation: bool, *, batch=False):
        normalized = [self.normalize(ticket, i if batch else None) for i, ticket in enumerate(tickets)]
        frame = pd.DataFrame([features.model_dump() for features, _ in normalized])
        probabilities = self.model.predict_proba(frame)
        contributions = self.model.explain(frame) if include_explanation else None
        scored_at = datetime.now(timezone.utc)
        results = []
        for i, (ticket, (features, warnings)) in enumerate(zip(tickets, normalized)):
            explanation = None
            if contributions is not None:
                row = contributions.iloc[i]
                explanation = Explanation(
                    base_log_odds=float(row["base"]), output_log_odds=float(row.sum()),
                    contributions=[Contribution(feature=f, label=C.FEATURE_LABELS[f], value=float(row[f]))
                                   for f in C.FEATURES],
                )
            probability = float(probabilities[i])
            results.append(Prediction(
                request_id=ticket.request_id, delay_probability=probability,
                risk_band=risk_band(probability, self.model.threshold), threshold=self.model.threshold,
                model_version=self.model_version, scored_at=scored_at, features=features,
                explanation=explanation, warnings=warnings,
            ))
        return results

    def demo_tickets(self):
        if self._demo is None:
            frame = read_tickets(self.demo_path)
            self._demo = [self._record(row) for _, row in frame.iterrows()]
        return self._demo

    @staticmethod
    def _record(row, source="held_out"):
        integer_fields = {"sla_business_days", "day_of_week", "prior_7d_service_volume", "prior_7d_zip_volume"}
        values = {f: None if pd.isna(row[f]) else int(row[f]) if f in integer_fields else row[f]
                  for f in C.FEATURES}
        return DemoTicket(
            source=source, ticket=TicketInput(request_id=row["request_id"], **values),
            requested_date=row["requested_datetime"].date(),
            expected_date=None if pd.isna(row["expected_datetime"]) else row["expected_datetime"].date(),
            closed_date=None if pd.isna(row["closed_datetime"]) else row["closed_datetime"].date(),
            status=row["status"], service_notice=None if pd.isna(row["service_notice"]) else row["service_notice"],
        )

    def reference_tickets(self):
        if self._reference is None:
            reference = read_tickets(self.reference_path)
            reference["request_id"] = "PHL-" + reference["objectid"]
            self._reference = reference.set_index("request_id", drop=False)
        return self._reference

    def get_ticket(self, request_id):
        if self.demo_path.is_file():
            demo = next((r for r in self.demo_tickets() if r.ticket.request_id == request_id), None)
            if demo is not None:
                return demo
        if self.reference_path.is_file():
            reference = self.reference_tickets()
            if request_id in reference.index:
                return self._record(reference.loc[request_id], "training_reference")
        return None

    def similar(self, ticket: DemoTicket, k=3):
        reference = self.reference_tickets()
        as_of = pd.Timestamp(ticket.requested_date)
        # Only outcomes already known before intake day can serve as historical precedent.
        eligible = reference[(reference["closed_datetime"].notna())
                             & (reference["closed_datetime"] < as_of)
                             & (reference["requested_datetime"] < as_of)
                             & (reference["request_id"] != ticket.ticket.request_id)]
        matches = similar_tickets(pd.Series(ticket.ticket.model_dump()), eligible, k=k)
        records = [SimilarTicket(
            **self._record(row, "training_reference").model_dump(),
            days_to_close=int(row["resolution_days"]),
            outcome="Missed window" if row["delayed"] else "On time",
        ) for _, row in matches.iterrows()]
        return SimilarTicketResponse(request_id=ticket.ticket.request_id,
                                     as_of=ticket.requested_date, tickets=records)
