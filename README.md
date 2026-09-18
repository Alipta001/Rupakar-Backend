# Rupakar Backend

Production-ready marketplace backend for authentic products from West Bengal, India.

## Stack

- Node.js 20+
- Express.js
- TypeScript
- MongoDB + Mongoose
- Redis
- BullMQ
- JWT
- bcrypt
- Swagger/OpenAPI
- Jest + Supertest
- Docker + Docker Compose

## Local development

1. Copy `.env.example` to `.env` and adjust credentials.
2. Install dependencies:
   npm install
3. Start the app:
   npm run dev
4. Swagger UI:
   http://localhost:8000/api-docs
5. Health:
   http://localhost:8000/api/v1/health

## Docker

```bash
docker compose up --build
```

## Production notes

- Never commit real credentials.
- Use environment variables for all secrets.
- Keep auth and financial data server-side.
- Use MongoDB transactions and atomic inventory updates where required.
