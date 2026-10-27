# G&R Staff Portal

Internal staff app for G&R à votre service. React + Vite PWA on Supabase, hosted on Vercel.

## Setup (once)
1. Supabase → SQL Editor → paste `supabase/migrations/001_init.sql` → Run.
2. Supabase → Authentication → Email templates → "Magic Link": include `{{ .Token }}` so staff get a 6-digit code.
3. Vercel → import this repo → add env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` (see `.env.example`).
