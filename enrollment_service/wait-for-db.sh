#!/bin/sh

echo "Esperando a PostgreSQL..."

until python -c "import os, socket; from urllib.parse import urlparse; u = urlparse(os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@enrollment-db:5432/enrollmentdb')); socket.create_connection((u.hostname or 'enrollment-db', int(u.port or 5432)), timeout=3).close()"; do
  sleep 2
done

echo "PostgreSQL listo"

exec "$@"
