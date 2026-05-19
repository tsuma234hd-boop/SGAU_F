FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt


COPY app ./app
COPY tests ./tests
COPY wait-for-db.sh .

RUN chmod +x wait-for-db.sh

EXPOSE 8000

CMD ["sh", "-c", "./wait-for-db.sh uvicorn app.main:app --host 0.0.0.0 --port 8000"]