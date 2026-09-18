# Rupakar staging verification

This checklist is for a private staging environment only. Use a separate database, Redis instance, Razorpay test account, SMTP test mailbox, and object-storage bucket. Never paste credentials into this file or commit `.env` files.

## Required configuration

Set these values in the staging secret manager or deployment environment:

- `NODE_ENV=production`
- `PORT=4000`
- `MONGODB_URI`: TLS-enabled staging MongoDB database with a dedicated application user.
- `REDIS_URL`: staging Redis endpoint reachable by both API and worker.
- `REDIS_ENABLED=true`
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`: independently generated random secrets, at least 32 bytes each.
- `FRONTEND_URL`: the HTTPS staging frontend URL.
- `CORS_ALLOWED_ORIGINS`: comma-separated HTTPS frontend origins only. Do not include localhost, `127.0.0.1`, `*`, or development URLs.
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`: Razorpay test-mode credentials and webhook secret.
- `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASSWORD`: a staging SMTP provider or sandbox mailbox. Use a provider with delivery logs and suppression controls.
- `STORAGE_BUCKET`: a staging-only object-storage bucket if invoice/PDF storage is enabled. Configure private objects and signed download URLs.

The API and worker must receive the same MongoDB, Redis, JWT, email, Razorpay, and storage configuration. The worker must start only after MongoDB and Redis are reachable. `/api/v1/health/ready` must report `mongo=ready`, `redis=ready`, and `worker=ready` before traffic is admitted.

## Platform requirements

- Terminate HTTPS before the frontend and API, and set secure forwarding headers in the ingress.
- Keep refresh cookies `HttpOnly`, `Secure`, `SameSite=Lax`, scoped to `/api/v1/auth`, and limited to their intended lifetime.
- Use structured request IDs and a centralized log sink. Redact authorization headers, cookies, passwords, OTPs, JWTs, payment signatures, and full payment payloads.
- Alert on readiness failures, 5xx rate, authentication failures, payment webhook failures, queue depth/age, worker heartbeat expiry, Mongo connection saturation, Redis latency, CPU, memory, and disk.
- Enable encrypted MongoDB backups, point-in-time recovery where available, and perform a restore test before release. Retain staging backups separately from production backups.

## Authentication checks

Use a disposable staging account and two separate browser profiles:

1. Register and verify the registration OTP.
2. Log in and confirm the access token is not in localStorage, sessionStorage, or a readable cookie.
3. Refresh the page and confirm the protected account route restores the session.
4. Let the access token expire; issue concurrent protected requests and confirm one refresh succeeds and all requests retry once.
5. Replay the old refresh cookie and confirm the token family is revoked.
6. Log out and confirm the refresh cookie is cleared and refresh is rejected.
7. Complete password reset and password change; confirm all prior refresh sessions are rejected.
8. Repeat login in a second browser profile and confirm revocation in one session does not incorrectly revoke the other session unless a reused rotated token triggers family reuse detection.

## Razorpay test-mode checks

Use only Razorpay test credentials and test orders:

- Create an order server-side using the backend-calculated amount.
- Complete a successful checkout and verify the payment signature server-side.
- Exercise failed and dismissed checkout paths.
- Send an invalid-signature webhook and confirm rejection.
- Deliver the same valid webhook twice and confirm the second delivery is idempotent.
- Reconcile payment status and exercise a test refund.
- Confirm payment amount and order ownership are checked server-side.

## Email checks

- Registration OTP delivery and expiry.
- Password-reset OTP delivery, expiry, and invalid OTP rejection.
- Rate-limit repeated OTP requests.
- Confirm provider logs contain no passwords, JWTs, refresh tokens, or complete OTPs.

## Load-test procedure

Run the repository's `load/k6.js` only against staging, with a disposable test account and catalog. Start with 100 VUs and inspect API, Mongo, Redis, and worker dashboards before increasing to 250, 500, and 1,000 VUs. Stop on elevated error rate, queue growth, database saturation, or latency regression. The script does not prove capacity by itself; retain the k6 summary and infrastructure metrics for each stage.

Example:

```bash
K6_BASE_URL=https://api.staging.example.com/api/v1 \
K6_EMAIL=load-test@example.com \
K6_PASSWORD='staging-only-password' \
K6_PRODUCT_ID=staging-product-id \
K6_VARIANT_ID=staging-variant-id \
k6 run --out json=artifacts/k6-100.json load/k6.js
```

Do not run this configuration against production.
