"""Validated API inputs and frontend-facing response shapes."""
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


Count = Annotated[int, Field(ge=0, le=2_147_483_647)]
Name = Annotated[str, Field(min_length=1, max_length=200)]


class ModelFeatures(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True,
                              allow_inf_nan=False)

    service_name: Name
    agency_responsible: Name
    zipcode: Annotated[str, Field(pattern=r"^(\d{5}(-\d{4})?|Missing)$")] | None
    sla_business_days: Count | None
    day_of_week: Annotated[int, Field(ge=0, le=6)]
    prior_7d_service_volume: Count
    prior_7d_zip_volume: Count
    backlog_share: Annotated[float, Field(ge=0, le=1)]


class TicketInput(ModelFeatures):
    request_id: Annotated[str, Field(min_length=1, max_length=128)] | None = None


class PredictionRequest(TicketInput):
    include_explanation: bool = True


class BatchPredictionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    tickets: Annotated[list[TicketInput], Field(min_length=1, max_length=1000)]
    include_explanation: bool = False


class Contribution(BaseModel):
    feature: str
    label: str
    value: float


class Explanation(BaseModel):
    units: Literal["log_odds"] = "log_odds"
    base_log_odds: float
    output_log_odds: float
    contributions: list[Contribution]


class Prediction(BaseModel):
    request_id: str | None
    delay_probability: Annotated[float, Field(ge=0, le=1)]
    risk_band: Literal["Standard", "Elevated", "High"]
    threshold: float
    model_version: str
    scored_at: datetime
    features: ModelFeatures
    explanation: Explanation | None
    warnings: list[str]


class BatchPredictionResponse(BaseModel):
    predictions: list[Prediction]


class DemoTicket(BaseModel):
    source: Literal["held_out", "training_reference"] = "training_reference"
    ticket: TicketInput
    requested_date: date
    expected_date: date | None
    closed_date: date | None
    status: str
    service_notice: str | None


class DemoTicketPage(BaseModel):
    historical: Literal[True] = True
    total: int
    tickets: list[DemoTicket]


class SimilarTicket(DemoTicket):
    days_to_close: int
    outcome: Literal["Missed window", "On time"]


class SimilarTicketResponse(BaseModel):
    request_id: str
    as_of: date
    tickets: list[SimilarTicket]
