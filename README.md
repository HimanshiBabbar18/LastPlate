# LastPlate

LastPlate is a surplus-food marketplace for local food businesses and customers. The repo contains a React/Vite client and an Express/Mongoose API.

## Local development

Requirements: Node.js 20+ and MongoDB 7+ (local or managed). `npm run dev` starts the Vite client and API process; the API will exit if it cannot connect to MongoDB. Docker Compose is an alternative when Docker is installed.

1. Copy `.env.example` to `.env` and set a private `JWT_SECRET` and your MongoDB connection string.
2. Run `npm install` from the repository root.
3. Start MongoDB, then run `npm run dev`.
4. Visit `http://localhost:5173`; the API health endpoint is `http://localhost:5000/api/health`.

The public marketplace is backed by the listings collection. No demo stock is seeded, so an empty database correctly shows an empty state. Register a provider account, sign in, and use Provider → List food to publish a real listing. Customer reservations require a separate customer account.

Registration requires an 8+ character password with uppercase and lowercase letters, a number, and a symbol. Password reset tokens are single-use and expire after 15 minutes. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `MAIL_FROM` to send reset emails. For local development only, set `PASSWORD_RESET_ALLOW_DEV_LINKS=true` to show the reset link in the app when SMTP is not configured; keep this disabled in production.

## API overview

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | Public | Service and MongoDB status |
| POST | `/api/auth/register` | Public | Create customer/provider account |
| POST | `/api/auth/login` | Public | Sign in |
| GET/PATCH | `/api/auth/me` | Signed in | Read/update own profile |
| GET | `/api/foods` | Public | Search and filter active food listings |
| GET | `/api/foods/:id` | Public | Listing details |
| POST | `/api/foods` | Provider | Publish a listing |
| PATCH | `/api/foods/:id` | Owning provider | Edit own listing |
| GET | `/api/provider/foods` | Provider | Own listings |
| GET | `/api/provider/analytics` | Provider | Listing and reservation aggregates |
| POST | `/api/reservations` | Customer | Atomically reserve available portions |
| GET | `/api/reservations/mine` | Customer | Own reservations |
| GET | `/api/reservations/provider` | Provider | Reservations for own listings |
| PATCH | `/api/reservations/:id/cancel` | Reservation owner/provider | Cancel and restore stock |
| PATCH | `/api/reservations/:id/collect` | Owning provider | Verify collection |
| GET | `/api/admin/overview` | Admin | Platform counts |
| GET | `/api/admin/users`, `/api/admin/providers`, `/api/admin/listings`, `/api/admin/reservations` | Admin | Moderation and platform oversight |
| PATCH | `/api/admin/users/:id/status` | Admin | Suspend/reactivate an account |
| PATCH | `/api/admin/providers/:id/approval` | Admin | Approve/revoke a provider |
| PATCH | `/api/admin/listings/:id/status` | Admin | Pause/reactivate a listing |
| GET | `/api/admin/audit` | Admin | Recent administrative audit history |

OpenAPI JSON is available at `/api/docs`. To provision the first administrator, set `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (12+ characters), and `MONGODB_URI` in the process environment and run `npm run create-admin -w server`. The script refuses to overwrite an existing account.

## API integration checks

Set `MONGODB_TEST_URI` to a dedicated database whose name ends in `_test`, then run `npm run test -w server`. The suite starts the API on a free local port and covers health, registration, authentication, public listing response shape, and customer/provider role separation. It inserts a uniquely named test customer and does not clear or drop the database.

Authentication uses a bearer JWT. Role and ownership checks live in the API, not only in client routes. Admin users cannot self-register; create initial administrator accounts through a trusted database/operations process.

## Revenue estimate

Provider “recovered revenue” is the sum of `total` for reservations marked collected. This is an estimated order value; payment is collected by the provider at pickup and the platform does not process or verify payments.

## Deployment

The repository includes a Render Blueprint (`render.yaml`) for a free API web service and a free static client site. The client is configured to call the API, and client-side routes rewrite to `index.html`. Free Render web services sleep after 15 minutes without requests, so the first request after a quiet period can take longer. Free hosting is intended for learning and previews, not production workloads.

1. Push this repository to GitHub, then sign in to Render and choose **New → Blueprint**. Connect `HimanshiBabbar18/LastPlate` on the `main` branch and apply the Blueprint.
2. Create a MongoDB Atlas database (the free M0 tier is sufficient for a demo). Add a database user, copy its connection string, and replace the placeholders with that user's credentials and the database name `lastplate`.
3. When Render asks for `MONGODB_URI`, paste the Atlas connection string. Render generates the `JWT_SECRET` and supplies the other values. Keep the database URI and generated secret private.
4. In Atlas **Network Access**, allow the outbound IP addresses shown in the Render API service settings. Avoid allowing all IP addresses. Wait for both Render services to finish deploying, then open `https://lastplate-himanshi-web.onrender.com` and check the API at `https://lastplate-himanshi-api.onrender.com/api/health`.
5. If Render changes either service's generated hostname because that name is already in use, update the API's `CLIENT_ORIGIN` to the actual static-site URL and the static site's `VITE_API_URL` to the actual API URL ending in `/api`, then redeploy both services.

Password reset needs an email provider. Until SMTP is configured, account creation and the core marketplace can run, but reset emails cannot be sent. To enable them, add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `MAIL_FROM` under the API service's environment settings in Render, then redeploy. Keep `PASSWORD_RESET_ALLOW_DEV_LINKS=false` in production. The included Docker Compose file is for local development only.

## Current boundaries

Reservations are pickup holds and do not collect online payment. Password reset email, Socket.IO live updates, Redis caching, and chart-based analytics require their own operational configuration and are not represented as complete features. The pasted product brief ends mid-sentence after its admin signup restriction; the implementation focuses on the complete requirements present before that cutoff.
