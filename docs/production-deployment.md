# Production deployment runbook

This runbook is required before enabling real Razorpay collection. Local development must continue using `rzp_test_` credentials and `PAYMENT_MOCK_ENABLED=true` only when explicitly needed.

## Required production environment

Set these in a secret manager or deployment environment, never in source control:

- `NODE_ENV=production`
- `PORT=4000`
- `MONGODB_URI`: TLS-enabled production MongoDB URI with a least-privilege application user.
- `REDIS_URL`: production Redis endpoint reachable by API and worker.
- `REDIS_ENABLED=true`
- `WORKER_ENABLED=false` on Render API when no paid background worker is deployed; Redis remains required.
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`: independent random secrets, at least 32 bytes.
- `RAZORPAY_KEY_ID`: `rzp_live_...` only.
- `RAZORPAY_KEY_SECRET`: matching live secret.
- `RAZORPAY_WEBHOOK_SECRET`: secret configured for the live webhook endpoint.
- `FRONTEND_URL`: an HTTPS frontend URL.
- `CORS_ALLOWED_ORIGINS`: comma-separated HTTPS origins only.
- `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASSWORD`: production SMTP provider.
- `STORAGE_BUCKET`: private production bucket if invoice/PDF storage is enabled.
- `PAYMENT_MOCK_ENABLED`: omit or set `false`; production rejects `true`.
- `SHIPPING_ENABLED`: set `false` during the ₹1 checkout test phase; restore `true` to enable normal shipping rules.

The API and worker must receive the same MongoDB, Redis, JWT, Razorpay, email, and storage settings. Production startup rejects missing dependencies, non-HTTPS origins, test Razorpay keys, and mock payments. When `WORKER_ENABLED=false`, readiness reports Redis `ready` and worker `disabled`; when a worker is deployed, set it to `true` and require the heartbeat.

## HTTPS and edge security

Terminate TLS at a managed load balancer or reverse proxy. Redirect HTTP to HTTPS, forward the original protocol safely, restrict inbound API access to the edge, and set HSTS only after HTTPS is confirmed. Refresh cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, and scoped to the auth path.

## Startup and health

Start the API only after MongoDB and Redis health checks pass. Start the worker with the same environment and require its Redis heartbeat. Admit traffic only when `/api/v1/health/ready` reports MongoDB, Redis, and worker ready. Monitor 5xx rate, authentication failures, payment verification failures, webhook retries, readiness failures, queue depth/age, worker heartbeat, Mongo connections, Redis latency, CPU, memory, and disk.

## Razorpay dashboard setup

1. Keep Live Mode disabled until this checklist and staging validation are complete.
2. Create the live API key only in the production secret manager.
3. Configure a live webhook URL at the HTTPS edge, using the exact `RAZORPAY_WEBHOOK_SECRET` stored for production.
4. Subscribe to payment captured, payment failed, and refund events required by reconciliation.
5. Deliver webhook requests only to the production API endpoint and verify signatures server-side.
6. Keep Test Mode keys and webhooks separate from production secrets and endpoints.

## Backup and restore

Enable encrypted MongoDB backups and point-in-time recovery where supported. Use a retention policy appropriate to order/payment records, store backups separately from the primary project, and run a documented restore test before launch. Record the restore timestamp, data loss point, and recovery duration. Never test restore by deleting the production database.

## Redis and BullMQ

Start the worker with `node worker.js` after Redis and MongoDB are healthy. Failed jobs retain retry/backoff settings and remain observable in Redis/BullMQ dashboards. Alert on failed jobs, queue age, queue depth, and heartbeat expiry. Shut down the API and worker with SIGTERM so HTTP, Redis, workers, and MongoDB close cleanly.

## Vendor accounting

Customer payment collection and vendor order accounting are implemented separately. Vendor payable fields are placeholders; automatic Razorpay Route transfers or vendor settlements are not implemented. Production must use a manual settlement/reconciliation process until payout requirements, commission rules, KYC, disputes, and transfer webhooks are implemented and approved.

## Pre-launch gate

- Production environment validation passes with live key metadata only.
- Test Mode and mock flags are absent from production.
- HTTPS, CORS, cookies, backups, monitoring, Redis, and worker readiness are verified in staging.
- Razorpay live webhooks are signed and replay/idempotency behavior is observed.
- Full, partial, failed, delayed, and duplicate refund scenarios are reconciled.
- A rollback plan and backup restore evidence exist.
- No real-money test occurs until staging evidence is reviewed and approved.

## Concise staging checklist

### 1. Services

- Private staging VM or managed container platform.
- HTTPS reverse proxy/load balancer with a staging API and frontend domain.
- MongoDB with TLS, backups, and restore capability.
- Redis reachable by both API and BullMQ worker.
- SMTP sandbox/provider, private object-storage bucket, monitoring, and log storage.
- Razorpay Test Mode account and signed staging webhook.

### 2. Environment

Set through the staging secret manager, never committed files:

```text
NODE_ENV=production
PORT=4000
MONGODB_URI=<staging TLS MongoDB URI>
REDIS_URL=redis://redis:6379
REDIS_ENABLED=true
JWT_ACCESS_SECRET=<staging secret>
JWT_REFRESH_SECRET=<staging secret>
FRONTEND_URL=https://frontend.staging.example.com
CORS_ALLOWED_ORIGINS=https://frontend.staging.example.com
EMAIL_HOST=<staging SMTP host>
EMAIL_PORT=587
EMAIL_USER=<staging SMTP user>
EMAIL_PASSWORD=<staging SMTP secret>
STORAGE_BUCKET=<staging private bucket>
RAZORPAY_KEY_ID=rzp_test_<staging test key>
RAZORPAY_KEY_SECRET=<staging test secret>
RAZORPAY_WEBHOOK_SECRET=<staging webhook secret>
PAYMENT_MOCK_ENABLED=false
```

### 3. Deploy and start

From `rupakar-backend`, with the secret environment loaded:

```bash
docker compose up -d --build mongodb redis api worker
docker compose ps
```

API command used by Compose:

```bash
node server.js
```

Worker command used by Compose:

```bash
node worker.js
```

Start the frontend separately from `rupakar-v0`:

```bash
pnpm install --frozen-lockfile
NEXT_PUBLIC_API_URL=https://api.staging.example.com/api/v1 pnpm build
NEXT_PUBLIC_API_URL=https://api.staging.example.com/api/v1 pnpm start
```

### 4. HTTPS

- Terminate TLS at the reverse proxy/load balancer.
- Redirect HTTP to HTTPS.
- Use only HTTPS in `FRONTEND_URL` and `CORS_ALLOWED_ORIGINS`.
- Forward the original protocol safely and verify secure cookie behavior.
- Keep MongoDB and Redis private; expose only the HTTPS edge and approved API port.

### 5. Backup and restore

1. Enable encrypted MongoDB backups and point-in-time recovery.
2. Record a pre-release backup ID and timestamp.
3. Restore into a separate recovery database/cluster, never over production.
4. Verify indexes, health, representative orders, payments, refunds, and users.
5. Record recovery point and recovery time, then remove the temporary recovery environment.

### 6. Health and readiness

```bash
curl --fail https://api.staging.example.com/api/v1/health/live
curl --fail https://api.staging.example.com/api/v1/health/ready
```

Readiness must report MongoDB and Redis as `ready`. Worker status must be `ready` after its Redis heartbeat when a worker is deployed, or `disabled` when `WORKER_ENABLED=false`.

### 7. Razorpay Test Mode webhook test

- Configure the HTTPS staging webhook with the Test Mode webhook secret.
- Send signed test events for captured and failed payments.
- Verify invalid signatures are rejected.
- Deliver a valid event twice and verify one state transition.
- Deliver a delayed/out-of-order event and verify a terminal payment/order state does not regress.
- Confirm payment, parent order, vendor order, reservation, and cart state in MongoDB.

### 8. Refund reconciliation test

- Use a captured Test Mode payment and an approved return.
- Request full and partial refunds through the supported return flow.
- Verify payment/order/vendor states remain pending until trusted provider confirmation.
- Deliver signed refund events and verify `REFUNDED` versus `PARTIALLY_REFUNDED`.
- Repeat the request/event and verify duplicate-safe behavior.
- Verify inventory restock occurs only after the existing return inspection rule.

### 9. Monitoring and rollback

- Monitor API 5xx/error rate, readiness, authentication failures, payment/webhook/refund errors, Mongo connections, Redis latency, BullMQ depth/age/failures, worker heartbeat, CPU, memory, and disk.
- Capture request IDs and redact cookies, JWTs, passwords, OTPs, signatures, and payment payloads.
- Stop the rollout on readiness failure, queue growth, payment mismatch, database saturation, or unexpected errors.
- Roll back to the previous image/configuration, preserve logs and backup IDs, and restore the last known-good database only through the approved recovery process.

This checklist prepares staging verification only. It does not verify staging or production readiness and does not authorize Live Mode or real payments.

## Staging deployment commands

Prepare a private staging secret file outside Git with the required variables above. Do not use the local development `.env`, test data, or live credentials.

Start MongoDB, Redis, and API from the backend directory when using Render's `WORKER_ENABLED=false` policy:

```bash
docker compose up -d --build mongodb redis api
docker compose ps
curl --fail https://api.staging.example.com/api/v1/health/live
curl --fail https://api.staging.example.com/api/v1/health/ready
```

The API should report MongoDB and Redis as `ready`, with worker `disabled` when no worker is deployed. For a Compose deployment that includes the worker, use `docker compose up -d --build mongodb redis api worker` and require worker `ready`. MongoDB and Redis are internal Compose services and are not published on host ports by this production configuration.

Start the frontend separately with a staging-only environment file:

```bash
cd rupakar-v0
pnpm install --frozen-lockfile
NEXT_PUBLIC_API_URL=https://api.staging.example.com/api/v1 pnpm build
NEXT_PUBLIC_API_URL=https://api.staging.example.com/api/v1 pnpm start
```

Put the frontend behind the same HTTPS ingress or an approved HTTPS origin listed in `CORS_ALLOWED_ORIGINS`. Do not use `http://localhost` for staging.

## Backup and restore procedure

1. Enable encrypted MongoDB snapshots and point-in-time recovery in the managed MongoDB service.
2. Before a release, record the backup identifier and timestamp in the deployment record.
3. Restore the latest backup into a separate recovery database or temporary cluster; never overwrite production for a test.
4. Run read-only health checks and verify representative order/payment/refund records and indexes.
5. Record recovery point, recovery time, and any missing data. Repeat on the agreed schedule.

## Monitoring and alerts

Collect request IDs and structured application logs with redaction for authorization headers, cookies, JWTs, passwords, OTPs, Razorpay signatures, and payment payloads. Alert on API 5xx/error rate, authentication failures, readiness failures, webhook signature failures/retries, payment reconciliation mismatches, refund failures, Mongo connection pool saturation, Redis latency, BullMQ queue depth/age/failed jobs, worker heartbeat expiry, CPU, memory, and disk.

## Razorpay staging checklist

- Use only `rzp_test_` credentials and a Test Mode webhook secret.
- Verify the backend creates provider orders from server totals.
- Exercise successful, failed, cancelled, duplicate, delayed, and out-of-order test events.
- Verify signature, order ID, payment ID, amount, currency, and provider status checks.
- Verify reservations, parent orders, vendor orders, cart, and refunds in MongoDB.
- Capture request IDs and provider event IDs without recording secrets or full payloads.

## Razorpay Live webhook checklist

- Create the live webhook only after staging sign-off.
- Use an HTTPS endpoint and a production-only webhook secret.
- Subscribe to captured, failed, and refund events required by reconciliation.
- Send a signed provider test event and verify the event is stored once.
- Verify duplicate delivery is acknowledged without duplicate state transitions.
- Verify delayed delivery is retryable and terminal state cannot regress.

## Refund reconciliation checklist

- Authorize refunds only for an owned, captured payment and approved return.
- Reject duplicate refund requests using the refund key and provider refund ID.
- Keep payment/order/vendor states `REFUND_PENDING` until a trusted provider event confirms completion.
- Reconcile full refunds as `REFUNDED` and partial refunds as `PARTIALLY_REFUNDED`.
- Restock only after the existing return inspection rule is satisfied.
- Alert on provider refund failures, missing events, amount mismatches, and stale pending refunds.

## Manual vendor settlement

Customer collection and vendor accounting are separate. For each settlement period, export captured order totals, commission rules, refunds/chargebacks, and vendor payable balances; reconcile them against Razorpay settlement reports; obtain vendor approval; and record the manual payout reference and audit evidence. Razorpay Route/transfers, automated payout scheduling, and payout webhooks are not implemented and must not be represented as active.
