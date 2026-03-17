# Copilot Instructions for `rifari-wp`

## 🚀 Purpose (Big Picture)
This repository is a **NestJS microservice** that integrates with **Meta (WhatsApp Business API)** to:
- **Receive** incoming WhatsApp messages + delivery/read status via a **Webhook** (`/api/webhook`).
- **Send** WhatsApp Template messages via Meta Graph API (`/api/meta/send-template`).
- **Store** message events and channel metadata in **MongoDB** using **Mongoose**.

## 🧩 Key Architecture / Modules
- **AppModule** (`src/app.module.ts`): boots Nest, loads `.env` via `@nestjs/config`, and connects to Mongo.
- **WebhookModule** (`src/webhook/*`): handles Meta webhook verification + incoming messages/status updates.
  - **Endpoint**: `GET /api/webhook` (verification) and `POST /api/webhook` (payloads).
  - Persists to Mongo using `Message` + `Channel` schemas.
- **MetaModule** (`src/meta/*`): sends template messages to WhatsApp using `@nestjs/axios`.
  - **Endpoint**: `POST /api/meta/send-template` (expects `{ to, templateName, variables[] }`).
- **WhatsappModule** (`src/whatsapp/*`): defines Mongoose schemas for `Channel` and `Message` and exports the Mongoose providers.

## 🔑 Important Data Models
- `Channel` (`src/whatsapp/schemas/channel.schema.ts`) stores a customer’s WhatsApp configuration:
  - `userId`, `phoneNumberId`, `wabaId`, `displayPhoneNumber`, `internalApiKey`, `isActive`
  - Note: there is a stray `j` in the schema options (`toJSON.transform` section) that will cause a TS/compile error; remove it.
- `Message` (`src/whatsapp/schemas/message.schema.ts`) stores incoming/outgoing events:
  - `wamid`, `from`, `to`, `direction`, `type`, `content`, `status`, with `channelId` relation.

## 🧠 How Data Flows
1. **Outgoing**: client calls `POST /api/meta/send-template` → `MetaService.sendTemplateMessage()` builds a Meta Graph API payload and sends it.
2. **Incoming**: Meta calls `POST /api/webhook` → `WebhookService.processIncomingData()`:
   - Finds `Channel` by `changes.metadata.phone_number_id`.
   - Stores inbound text/media as `Message` with `direction='inbound'` and `status='received'`.
   - Updates message status when Meta sends `changes.statuses`.

## 🛠️ Developer Workflow (Commands)
- Install deps: `npm install`
- Start dev server: `npm run start:dev`
- Start prod server (build + run): `npm run build && npm run start:prod`
- Run unit tests: `npm run test`
- Run e2e tests: `npm run test:e2e`
- Lint & format: `npm run lint` / `npm run format`

## ⚙️ Required Environment Variables
This project uses `@nestjs/config` (loads from `.env`). Key vars:
- `MONGO_URI` (Mongo connection string)
- `WEBHOOK_VERIFY_TOKEN` (Meta webhook verify token)
- `META_MASTER_TOKEN` (Meta Graph API bearer token)
- `META_TEST_PHONE_ID` (Meta phone number ID used for send API)
- `META_API_VERSION` (e.g., `v17.0`)
- Optional: `PORT` (defaults to 3000)

## 🧭 API Notes & Conventions
- Routes are prefixed under `/api/*`.
- Controllers are lean; business logic lives in `*Service` classes.
- Mongoose schemas use `SchemaFactory.createForClass(...)` and are registered in `WhatsappModule`.
- All external HTTP calls use `@nestjs/axios` + `firstValueFrom(...)`.
- Logging uses Nest `Logger` for key operations.

## ✅ What to Do When Extending
- Add a new module when introducing a new feature area (e.g., `notifications`, `users`).
- Keep services small and single-responsibility.
- Reuse `WhatsappModule` for any Mongo collections related to WhatsApp events.
- Prefer explicit DTOs when adding new controller payloads (not currently used, but OK to add).

---

> If anything here feels incomplete or you want more detail on a part of the stack (e.g., the Meta payload format, webhook processing flow, or how channels are created), please say so and I’ll update this file accordingly.