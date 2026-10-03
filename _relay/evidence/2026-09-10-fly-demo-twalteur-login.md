# Fly demo login identity — Twauteur@amaris.com — 2026-09-10

**App:** https://aria-mantu-app.fly.dev  
**Branch:** `cursor/fly-demo-twalteur-login-b91d`

## Secrets (names only)

| Secret | Status |
|---|---|
| `DEMO_ADMIN_USERNAME` | Deployed |
| `DEMO_ADMIN_EMAIL` | Deployed |
| `NEXT_PUBLIC_DEMO_ADMIN_USERNAME` | Deployed (also build-arg) |
| `DEMO_ADMIN_PASSWORD` | Already deployed (unchanged value) |

## Verification

```
POST /api/auth/demo-login {"username":"Twalteur@amaris.com","password":"<configured>"} → 200 {"ok":true}
POST /api/auth/demo-login {"username":"admin","password":"<configured>"} → 401
POST /api/auth/demo-login {"username":"Twalteur@amaris.com","password":"wrong"} → 401
GET /api/health → 200
```
