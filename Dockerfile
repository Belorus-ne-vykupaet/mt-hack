FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 OMP_NUM_THREADS=4
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
COPY requirements.lock pyproject.toml ./
COPY src ./src
COPY backend ./backend
RUN pip install --no-cache-dir -r requirements.lock && pip install --no-deps .
CMD ["uvicorn", "mt_hack.service:app", "--host", "0.0.0.0", "--port", "8001"]
