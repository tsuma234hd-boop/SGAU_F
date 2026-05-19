FROM python:3.11

WORKDIR /app

COPY . .

RUN apt-get update && apt-get install -y netcat-openbsd
RUN pip install --no-cache-dir -r requirements.txt

CMD ["sh", "-c", "./wait-for-db.sh && uvicorn app.main:app --host 0.0.0.0 --port 8000"]