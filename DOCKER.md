# Running Aria Sourcing in Docker

Running in a container fixes the OneDrive `.next` corruption: Next builds inside the
container's filesystem (an anonymous volume), so the synced host checkout is never
touched. Source is still bind-mounted, so edits hot-reload.

## One-time

1. Start Docker Desktop.
2. Start the local Supabase stack on the host (the app talks to it):
   ```
   supabase start
   ```
3. Make sure `.env.local` exists with:
   ```
   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
   SUPABASE_SERVICE_ROLE_KEY=<service role key>
   ```

## Start the app

```
docker compose up        # or: npm run docker:dev
```

App: http://localhost:3000 — admin / admin to sign in.

First run builds the image (`npm ci`) and may take a few minutes; later runs are fast.
Rebuild the image after dependency changes: `docker compose up --build`.

## How the networking works

- The **browser** runs on your host and reaches Supabase at `NEXT_PUBLIC_SUPABASE_URL`
  (`http://localhost:54321`).
- The **server** runs inside the container and reaches the host's Supabase via the
  `SUPABASE_URL` override (`http://host.docker.internal:54321`) set in
  `docker-compose.yml`. Outside Docker that var is unset and everything falls back to
  the public URL, so normal `npm run dev` is unchanged.

## Notes

- `.env.local` is loaded at runtime via `env_file` and is excluded from the image
  (`.dockerignore`) — secrets are never baked in.
- To run without Docker but still off OneDrive, you can also use the build-dir hatch:
  `NEXT_DIST_DIR=/tmp/aria-next npm run dev`.
