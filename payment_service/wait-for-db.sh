#!/bin/sh

echo "Esperando a la base de datos de payment..."

until python -c "import os, socket; from urllib.parse import urlparse; u = urlparse(os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@payment-db:5432/paymentdb')); socket.create_connection((u.hostname or 'payment-db', int(u.port or 5432)), timeout=3).close()"; do
  sleep 2
done

echo "Base de datos de payment lista"

exec "$@"