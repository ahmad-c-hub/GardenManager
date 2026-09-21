# Garden Manager

A private web app for a shared garden. It tracks:

- **Savings:** money deposited into the garden fund.
- **Expenses:** money spent from the fund on seeds, soil, tools, water, fertilizer and other things.
- **Balance:** total saved minus total spent, which is what's left to spend.
- **Beds & plants:** what's growing where, its status, and when it should be ready.
- **Harvests:** each crop that comes in, weighed in kilograms.
- **Moments:** garden photos with a note, in a shared feed.

Stack: Node.js + Express, React (Vite), and Neon Postgres through the raw `pg` driver (no ORM).

```
GardenManager/
├── migrations/        SQL migrations (001_init, 002_notifications, 003_moments)
├── server/            Express API
│   ├── db.js          the shared pg Pool (TLS)
│   ├── lib/           validation, CRUD router factory, errors, config, web push, Cloudinary
│   ├── middleware/    auth (JWT cookie) + error handling
│   ├── jobs/          daily + monthly reminder cron jobs
│   ├── routes/        auth, dashboard, beds/plants/savings/expenses/harvests, moments, push/notifications
│   └── scripts/       migrate, seed, add-user
└── client/            React + Vite frontend
    └── src/
        ├── theme/     design tokens and styles (CSS custom properties)
        ├── components/
        ├── lib/       API client, auth context, formatting, hooks
        ├── sw.js      service worker: app-shell cache + push handling
        └── pages/     Login, Dashboard, Savings, Expenses, Garden, Harvests, Moments, Notifications
```

## Setup

You need **Node.js 22.9 or newer** and a Neon Postgres database.

### 1. Install

```bash
npm run install:all
```

This installs the root, `server/` and `client/` packages.

### 2. Configure `.env`

Copy the example and fill in real values:

```bash
cp .env.example .env
```

| Variable        | Required | Notes |
|-----------------|----------|-------|
| `DATABASE_URL`  | yes      | Your Neon connection string, e.g. `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require` |
| `JWT_SECRET`    | yes      | At least 32 random characters. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `PORT`          | no       | Server port, default `3000` (the Vite dev proxy reads it from `.env`) |
| `NODE_ENV`      | no       | `production` serves the built app, marks the cookie Secure and trusts one proxy hop |
| `ALLOWED_ORIGIN`| no       | Comma-separated extra origins allowed to call the API cross-origin (e.g. an Android WebView). Not needed for the web app |
| `VITE_CURRENCY` | no       | Currency code for display, default `USD` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | no | Web push keys (see [Notifications](#notifications)). Without them, notifications are off |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | for Moments | Photo storage (see [Moments](#moments)). Server-side only |
| `REMINDER_TIMEZONE` | no  | IANA timezone for reminder times, default `UTC` (e.g. `Europe/London`) |

`.env` is git-ignored. Never commit it.

### 3. Create the tables

```bash
npm run migrate
```

This applies every file in `migrations/` that hasn't run yet and records it in a `schema_migrations` table, so it's safe to run again.

### 4. Create an account

There is **no sign-up page**. Accounts are only created from the terminal:

```bash
npm run add-user -- --email you@example.com --name "Your Name" --password "a-strong-password"
```

If you leave out `--password`, it prompts for one without echoing it, which also keeps it out of your shell history:

```bash
npm run add-user -- --email you@example.com --name "Your Name"
```

To change someone's password later:

```bash
npm run add-user -- --email you@example.com --reset
```

Passwords are hashed with bcrypt and must be at least 8 characters. To remove someone's access, delete their row from `users`. They are signed out on their next request.

### 5. (Optional) Load sample data

```bash
npm run seed
```

This adds a year of example beds, plants, deposits, expenses and harvests, dated relative to today. It **never creates or touches users**, and it only runs when the garden tables are empty. To wipe the garden data and re-seed:

```bash
npm run seed -- --force
```

### 6. Run it

```bash
npm run dev
```

- App: http://localhost:5173
- API: http://localhost:3000 (Vite proxies `/api` to it)

## Production

```bash
npm run build                  # installs server + client deps, builds client/dist
npm run migrate                # applies any pending migrations to DATABASE_URL
NODE_ENV=production npm start  # serves the API and the built app on PORT
```

### Render

Create a **Web Service** from the repo with:

- Build command: `npm run build`
- Start command: `npm start`
- Pre-deploy command (paid plans): `npm run migrate`. On the free plan, run it once from your machine against the same `DATABASE_URL`.
- Environment: `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=production`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and optionally `REMINDER_TIMEZONE`, `VITE_CURRENCY` and `ALLOWED_ORIGIN`. Render sets `PORT` itself.
- Reminders run on a timer inside the web service, so they only fire while it's awake. Render's free plan sleeps after 15 minutes idle, so use a paid instance, or a free uptime pinger hitting the site every ~10 minutes, if you want reliable reminders.

Express serves `client/dist` and sends `index.html` for any non-`/api` path, so the frontend and API share one origin and need no CORS.

In production the session cookie is marked `Secure`, so serve the app over HTTPS.

## Install as an app

Garden Manager is a PWA. Over HTTPS (Render provides it), browsers offer to install it:

- **Android / Chrome / Edge:** the install prompt, or menu → *Install app* / *Add to Home screen*.
- **iPhone / iPad:** Share → *Add to Home Screen*. iOS only allows push notifications for the installed app (iOS 16.4+).

The service worker (`client/src/sw.js`, built by vite-plugin-pwa) caches the app shell so it opens offline. API data is never cached.

## Notifications

Web push using VAPID. There's no Firebase and no third-party service.

**1. Generate keys once:**

```bash
npx --prefix server web-push generate-vapid-keys
```

Put the two keys in `.env` (and in Render's environment) as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, and set `VAPID_SUBJECT` to `mailto:you@example.com`. Use the same keys everywhere and never change them: new keys invalidate every existing subscription, and everyone would have to re-enable notifications.

**2. Run `npm run migrate`** to create `push_subscriptions`, `reminder_settings` and `harvest_reminders_sent`.

**3. In the app**, open *Notifications* → *Enable notifications*, then *Send a test*.

What gets sent:

| Notification | When | Setting |
|---|---|---|
| Harvest coming up | Daily at 08:00, once per plant whose expected harvest date is within the lead time | *Harvest reminders* + lead days |
| Time to water | Daily at 08:00, every N days | *Watering reminders* |
| Garden fund | 09:00 on the 1st of each month | *Monthly savings* |
| New deposit / expense / harvest / moment | Right away, to everyone **except** the person who added it | *Garden activity* |

Tapping a notification opens the relevant page. Signing out turns notifications off on that device. Subscriptions the push service reports as gone (HTTP 404/410) are deleted automatically.

## Moments

A shared photo feed. Photos go to **Cloudinary**: never into Postgres, never onto the server's disk.

1. Create a free Cloudinary account. On the dashboard's API Keys page, copy the cloud name, API key and API secret into `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`.
2. Run `npm run migrate` to create the `moments` table.

How an upload works:

- The browser sends the photo to `POST /api/moments` as multipart.
- multer holds it in memory: JPEG/PNG/WebP only, 8 MB max, and the file's first bytes are checked too.
- The server streams it to Cloudinary under `garden-manager/moments/`, capped at 1600 px on the long edge.
- It stores the delivery URL, with `f_auto,q_auto` so browsers get WebP/AVIF at an automatic quality, plus the asset's public id so deleting a moment also deletes the photo.

Only the poster can delete a moment. Posting one notifies everyone else who has *Garden activity* notifications on.

Photo uploads are `multipart/form-data`, which a cross-site form *could* send. So besides the SameSite cookie, the server also requires an `X-Requested-With: fetch` header on them. Browsers only let other sites add a custom header after a CORS preflight, and that preflight fails.

## How auth works

- `POST /api/auth/login` checks the bcrypt hash and sets an **httpOnly, SameSite=Lax** cookie holding a JWT that lasts 7 days.
- Every other `/api/*` route runs behind `requireAuth`, which verifies the token and checks that the user still exists.
- `POST /api/auth/logout` clears the cookie.
- Requests that change data must be sent as JSON, which adds CSRF protection on top of the SameSite cookie.
- Login attempts are rate-limited (10 per 15 minutes per IP and email).
- The frontend shows only the login page until `/api/auth/me` succeeds.

## API

All routes are JSON, and all except login/logout require a session.

| Method | Path | |
|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` |
| POST | `/api/auth/logout` | |
| GET | `/api/auth/me` | current user |
| GET | `/api/dashboard` | totals, balance, spending by category, 12-month savings vs spending, kg by month, upcoming harvests, recent activity |
| GET/POST | `/api/beds` | list / create |
| GET/PUT/DELETE | `/api/beds/:id` | |
| GET/POST | `/api/plants` | filters: `?bed_id=&status=` |
| GET/PUT/DELETE | `/api/plants/:id` | |
| GET/POST | `/api/savings` | filters: `?from=&to=` |
| GET/PUT/DELETE | `/api/savings/:id` | |
| GET/POST | `/api/expenses` | filters: `?category=&from=&to=` |
| GET/PUT/DELETE | `/api/expenses/:id` | |
| GET/POST | `/api/harvests` | filters: `?from=&to=&plant_id=&bed_id=` |
| GET/PUT/DELETE | `/api/harvests/:id` | |
| GET | `/api/moments` | `?limit=20&offset=0` → `{ moments, hasMore }`, newest first |
| POST | `/api/moments` | multipart: `image` (file), `note` (optional); needs `X-Requested-With: fetch` |
| DELETE | `/api/moments/:id` | your own moments only |
| GET | `/api/push/public-key` | `{ enabled, publicKey }` |
| POST | `/api/push/subscribe` | `{ subscription }` (a `PushSubscription.toJSON()`) |
| POST | `/api/push/unsubscribe` | `{ endpoint }` |
| POST | `/api/push/test` | sends a test notification to your devices |
| GET/PUT | `/api/notifications/settings` | `watering_interval_days`, `harvest_lead_days`, `notify_harvest`, `notify_savings_monthly`, `notify_activity` |

`PUT` accepts partial updates. Dates are `YYYY-MM-DD`. Expense categories: `seeds`, `soil`, `tools`, `water`, `fertilizer`, `other`. Plant statuses: `planted`, `growing`, `harvested`, `removed`.

Deleting a bed or plant keeps its harvests and expenses; their links are set to null.
