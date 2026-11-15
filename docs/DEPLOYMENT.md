# Deployment

## Backend (FastAPI)

The container is in `backend/Dockerfile`:

```bash
cd backend
docker build -t stylemirror-api .
docker run --env-file .env -p 8000:8000 stylemirror-api
```

It works on Render, Fly.io, Railway, Cloud Run or any container host.

- Set `ENVIRONMENT=production`. This disables `/docs` and sends HSTS.
- Set `FRONTEND_ORIGINS=https://your-frontend.example` (comma-separated, exact origins).
- Behind a load balancer you control, set `TRUST_PROXY_HEADERS=true` so rate limits use the real client IP.
- **Run one instance with one worker.** Jobs, unsaved results and rate limits are in memory. To scale out, move the job store and limiter to Redis: `JobManager` and `SlidingWindowLimiter` are the only two classes to swap. Saved history already lives in Supabase.
- Terminate TLS at the host or proxy. Webcam access and secure cookies require HTTPS.
- Recommended: `REQUIRE_AUTH=true` for public deployments, with sensible `RATE_LIMIT_*` values, plus billing alerts at your AI provider.

## Frontend (Next.js)

On Vercel or any Node host:

```bash
cd frontend
npm ci        # also copies the MediaPipe WASM runtime into public/
npm run build
npm start
```

Set `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` at **build time**. `next.config.mjs` builds a Content-Security-Policy from them.

## Supabase

1. Create a project. Copy the URL, the anon key and the service-role key (backend only).
2. Apply `supabase/migrations/*.sql` with `supabase db push` or the SQL editor. This creates the `tryon_history` table with RLS and the private `tryon-results` bucket with per-user folder policies.
3. Under Auth → URL Configuration, add your frontend URL plus `/studio` to the redirect allow-list (for magic links and email confirmation).
4. Optional: enable leaked-password protection and CAPTCHA (Auth → Attack Protection) to reduce abuse.

Retention: with `HISTORY_RETENTION_DAYS>0` the backend stamps `expires_at` on each saved result and purges expired rows and objects every hour.
