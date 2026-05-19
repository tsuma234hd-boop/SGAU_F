# Payment Service SGAU + Wompi (Colombia)

## 1) Flujo completo

1. Cliente autenticado (JWT del auth-service) llama POST /payments/create.
2. payment_service crea registro local en estado pending.
3. Si el metodo es checkout, crea link en Wompi y devuelve checkout_url.
4. Si el metodo es card, pse o nequi con direct_payment.payment_source_id, crea transaccion directa en Wompi.
5. Wompi notifica a POST /payments/webhook.
6. payment_service valida firma del webhook con WOMPI_EVENTS_SECRET.
7. payment_service actualiza estado local: pending, approved, rejected, expired.
8. Si se aprueba, actualiza automaticamente la cuenta financiera (total_paid, balance, status).
9. Cliente o gateway consulta GET /payments/status/{reference} para estado final.

## 2) Endpoints principales

### POST /payments/create

Request ejemplo (checkout):

{
  "student_id": 25,
  "amount_in_cents": 35000000,
  "customer_email": "estudiante@ucc.edu.co",
  "concept": "Matricula 2026-1",
  "description": "Pago matricula derecho",
  "payment_method": "checkout",
  "enrollment_id": 1001,
  "course_id": 405,
  "academic_order_id": "ORD-2026-0001"
}

Response ejemplo:

{
  "payment": {
    "id": 10,
    "student_id": 25,
    "reference": "SGAU-25-20260512180020-9A31BC",
    "status": "pending",
    "checkout_url": "https://checkout.wompi.co/l/xxxxxx",
    "amount_in_cents": 35000000,
    "currency": "COP",
    "payment_method": "checkout"
  },
  "checkout_url": "https://checkout.wompi.co/l/xxxxxx",
  "wompi_link_id": "lnk_xxx",
  "wompi_transaction_id": null
}

### GET /payments/{id}
Devuelve el pago local por id.

### GET /payments/status/{reference}
Consulta/actualiza estado con Wompi y responde estado local.

### POST /payments/webhook
Recibe notificaciones de Wompi y actualiza estados automaticamente.

### POST /payments/refund

Request ejemplo:

{
  "reference": "SGAU-25-20260512180020-9A31BC",
  "amount_in_cents": 35000000,
  "reason": "Anulacion administrativa"
}

## 3) Credenciales necesarias de Wompi

1. WOMPI_PUBLIC_KEY
2. WOMPI_PRIVATE_KEY
3. WOMPI_EVENTS_SECRET
4. WOMPI_INTEGRITY_SECRET

Las obtienes desde tu cuenta comercio en Wompi, en modo pruebas (sandbox) o produccion.

## 4) Variables de entorno

Ver archivo payment_service/.env.example.

## 5) Pruebas sandbox

1. Levanta infraestructura:
   docker compose up --build
2. Autentica en auth-service y toma Bearer token.
3. Crea pago con POST /payments/create.
4. Abre checkout_url y paga usando medios de prueba habilitados por Wompi.
5. Consulta estado por GET /payments/status/{reference}.

## 6) Probar webhook local

1. Expon tu endpoint local con ngrok:
   ngrok http 8007
2. Configura en Wompi el webhook URL:
   https://<subdominio>.ngrok-free.app/payments/webhook
3. Usa WOMPI_EVENTS_SECRET correcto.
4. Verifica que el endpoint marque payment_reference y processed=true.

## 7) Proteccion recomendada de webhook

1. Validar checksum de firma (implementado).
2. Validar tolerancia temporal del timestamp (implementado).
3. Registrar y auditar payloads recibidos (payment_webhook_events).
4. Limitar acceso de red al endpoint (API Gateway/WAF).
5. No exponer llaves privadas en frontend ni logs.

## 8) Paso a produccion

1. Cambia WOMPI_ENV=production.
2. Usa llaves production de Wompi.
3. Configura URL publica HTTPS estable para webhook.
4. Ajusta allow_origins de CORS en gateway/payment.
5. Activa monitoreo, alertas y rotacion de llaves.
