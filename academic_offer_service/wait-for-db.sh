#!/bin/sh

echo "Esperando a PostgreSQL..."

until python -c "import socket; s=socket.socket(); s.connect(('academic-db',5432))"; do
  sleep 2
done

echo "PostgreSQL listo"

exec "$@"
