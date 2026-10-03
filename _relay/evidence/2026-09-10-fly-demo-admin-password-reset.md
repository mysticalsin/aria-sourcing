# Fly demo admin password reset — 2026-09-10

**App:** https://aria-mantu-app.fly.dev (`aria-mantu-app` v239)  
**Branch:** `cursor/fly-demo-admin-password-8b0f`

## Secrets set (names only)

| Secret | Status |
|---|---|
| `DEMO_ADMIN_PASSWORD` | Deployed |
| `NEXT_PUBLIC_DEMO_ADMIN_PASSWORD` | Deployed |
| `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true` | Deployed |
| `ENABLE_DEMO_LOGIN=true` | Deployed |

Password value is **not** recorded in git.

## Also done

- GoTrue `admin@hermes.local` password synced to match `DEMO_ADMIN_PASSWORD`
- Admin profile + `hermes.local` workspace seeded
- Redeploy with build-arg `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true`

## Verification

```
POST https://aria-mantu-app.fly.dev/api/auth/demo-login
{"username":"admin","password":"<configured>"} → 200 {"ok":true}
{"username":"admin","password":"wrong"} → 401 {"ok":false,"error":"Invalid demo credentials."}
GET /api/health → 200 healthy
```
