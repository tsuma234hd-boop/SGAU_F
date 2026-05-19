FROM python:3.10

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN sed -i 's/\r$//' wait-for-db.sh && chmod +x wait-for-db.sh

CMD ["sh", "-c", "sh ./wait-for-db.sh && uvicorn main:app --host 0.0.0.0 --port 8000"]