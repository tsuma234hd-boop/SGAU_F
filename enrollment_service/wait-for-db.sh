#!/bin/sh

echo "Esperando a PostgreSQL..."

until python -c "import socket; s=socket.socket(); s.connect(('enrollment-db',5432))"; do
  sleep 2
done

echo "PostgreSQL listo"

exec "$@"
