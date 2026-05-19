FROM python:3.11

WORKDIR /app

COPY . .

RUN apt-get update && apt-get install -y netcat-openbsd
RUN sed -i 's/\r$//' wait-for-db.sh && chmod +x wait-for-db.sh
RUN pip install --no-cache-dir -r requirements.txt

CMD ["sh", "-c", "sh ./wait-for-db.sh && uvicorn app.main:app --host 0.0.0.0 --port 8000"]