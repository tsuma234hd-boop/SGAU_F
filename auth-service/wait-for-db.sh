#!/bin/sh

echo "Esperando a PostgreSQL..."

while ! python -c "import os, socket; from urllib.parse import urlparse; u = urlparse(os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@auth-db:5432/authdb')); socket.create_connection((u.hostname or 'auth-db', int(u.port or 5432)), timeout=3).close()"; do
  sleep 1
done

echo "PostgreSQL listo"