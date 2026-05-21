#!/bin/sh

echo "Esperando a la base de datos..."

until python -c "import os, socket; from urllib.parse import urlparse; u = urlparse(os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@student-db:5432/studentdb')); socket.create_connection((u.hostname or 'student-db', int(u.port or 5432)), timeout=3).close()"; do
  sleep 2
done

echo "Base de datos lista"

exec "$@"