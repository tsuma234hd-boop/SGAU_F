#!/bin/sh

echo "Esperando a la base de datos de payment..."

until python -c "import socket; s=socket.socket(); s.connect(('payment-db',5432))"; do
  sleep 2
done

echo "Base de datos de payment lista"

exec "$@"