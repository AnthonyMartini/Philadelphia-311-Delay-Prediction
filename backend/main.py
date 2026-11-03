"""Run from the repository root: python -m uvicorn backend.main:app."""
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

try:
    from .ml import config as C
except ImportError:
    from ml import config as C

try:
    from .schemas import (BatchPredictionRequest, BatchPredictionResponse, DemoTicket, DemoTicketPage,
                          Prediction, PredictionRequest, SimilarTicketResponse, TicketInput)
    from .service import InputError, PredictionService
except ImportError:
    from schemas import (BatchPredictionRequest, BatchPredictionResponse, DemoTicket, DemoTicketPage,
                         Prediction, PredictionRequest, SimilarTicketResponse, TicketInput)
    from service import InputError, PredictionService


@dataclass(frozen=True)
class Settings:
    art_dir: Path = C.ART_DIR
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")
    model_threads: int = 1

    def __post_init__(self):
        if not 1 <= self.model_threads <= 64:
            raise ValueError("PHL311_MODEL_THREADS must be between 1 and 64")

    @classmethod
    def from_env(cls):
        return cls(
            art_dir=Path(os.environ.get("PHL311_ARTIFACT_DIR", str(C.ART_DIR))).resolve(),
            cors_origins=tuple(origin.strip() for origin in os.environ.get(
                "PHL311_CORS_ORIGINS", ",".join(cls.cors_origins)).split(",") if origin.strip()),
            model_threads=int(os.environ.get("PHL311_MODEL_THREADS", "1")),
        )


def get_service(request: Request) -> PredictionService:
    service = request.app.state.service
    if service is None:
        raise HTTPException(status_code=503, detail="Prediction model is not ready")
    return service


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app):
        # Invalid or missing artifacts fail startup rather than exposing an unusable predictor.
        app.state.service = PredictionService(settings.art_dir, settings.model_threads)
        try:
            yield
        finally:
            app.state.service = None

    app = FastAPI(
        title="Philadelphia 311 Delay Prediction API", version="1.0.0", lifespan=lifespan,
        description="Scores prepared intake-time features using the saved XGBoost model. "
                    "Historical workload values must be supplied; no City data feed is connected.",
    )
    app.state.service = None
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins),
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Omit raw input/context so even NaN/Infinity validation failures serialize as valid JSON.
        return JSONResponse(status_code=422, content={"detail": [
            {key: error[key] for key in ("loc", "msg", "type")} for error in exc.errors()
        ]})

    @app.exception_handler(InputError)
    async def input_error(request, exc):
        location = ["body"] if exc.index is None else ["body", "tickets", exc.index]
        return JSONResponse(status_code=422, content={"detail": [
            {"loc": [*location, exc.field], "msg": str(exc), "type": "unsupported_category"}
        ]})

    @app.post("/api/v1/predictions", response_model=Prediction, tags=["Predictions"])
    def predict(payload: PredictionRequest, service: PredictionService = Depends(get_service)):
        ticket = TicketInput(**payload.model_dump(exclude={"include_explanation"}))
        return service.predict([ticket], payload.include_explanation)[0]

    @app.post("/api/v1/predictions/batch", response_model=BatchPredictionResponse, tags=["Predictions"])
    def predict_batch(payload: BatchPredictionRequest, service: PredictionService = Depends(get_service)):
        return BatchPredictionResponse(predictions=service.predict(
            payload.tickets, payload.include_explanation, batch=True))

    @app.get("/api/v1/tickets", response_model=DemoTicketPage, tags=["Historical demo"])
    def tickets(limit: int = Query(100, ge=1, le=400), offset: int = Query(0, ge=0),
                service: PredictionService = Depends(get_service)):
        if not service.demo_path.is_file():
            raise HTTPException(status_code=503, detail="Historical demo tickets are not installed")
        records = service.demo_tickets()
        return DemoTicketPage(total=len(records), tickets=records[offset:offset + limit])

    @app.get("/api/v1/tickets/{request_id}/prediction", response_model=Prediction, tags=["Historical demo"])
    def predict_demo(request_id: str, include_explanation: bool = True,
                     service: PredictionService = Depends(get_service)):
        record = find_ticket(service, request_id)
        return service.predict([record.ticket], include_explanation)[0]

    @app.get("/api/v1/tickets/{request_id}", response_model=DemoTicket, tags=["Historical demo"])
    def ticket_record(request_id: str, service: PredictionService = Depends(get_service)):
        return find_ticket(service, request_id)

    @app.get("/api/v1/tickets/{request_id}/similar", response_model=SimilarTicketResponse, tags=["Historical demo"])
    def similar_records(request_id: str, k: int = Query(3, ge=1, le=10),
                        service: PredictionService = Depends(get_service)):
        ticket = find_ticket(service, request_id)
        if not service.reference_path.is_file():
            raise HTTPException(status_code=503, detail="Historical reference tickets are not installed")
        return service.similar(ticket, k)

    return app


def find_ticket(service: PredictionService, request_id: str):
    if not service.demo_path.is_file() and not service.reference_path.is_file():
        raise HTTPException(status_code=503, detail="Historical ticket data is not installed")
    ticket = service.get_ticket(request_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="Historical ticket not found")
    return ticket


app = create_app()
