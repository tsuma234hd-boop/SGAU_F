#!/bin/sh

echo "Esperando a PostgreSQL..."

while ! nc -z auth-db 5432; do
  sleep 1
done

echo "PostgreSQL listo"