#!/bin/sh

echo "Esperando a la base de datos..."

until python -c "import socket; s=socket.socket(); s.connect(('student-db',5432))"; do
  sleep 2
done

echo "Base de datos lista"

exec "$@"