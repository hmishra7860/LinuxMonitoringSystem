FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY db ./db
COPY agent ./agent
RUN useradd --system --no-create-home lw && chown -R lw /srv
USER lw
EXPOSE 8000
# One worker keeps the in-process WebSocket hub and scheduler consistent. Scale out with a Redis pub/sub hub if needed.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers"]
