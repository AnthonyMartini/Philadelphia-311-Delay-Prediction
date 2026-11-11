FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=80

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py schemas.py service.py database.py ./
COPY ml/__init__.py ml/config.py ml/scoring.py ./ml/
COPY ml/artifacts/xgb_model.json ml/artifacts/metadata.json ml/artifacts/demo_tickets.csv ml/artifacts/reference_tickets.csv ./ml/artifacts/

EXPOSE 80

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-80}"]
