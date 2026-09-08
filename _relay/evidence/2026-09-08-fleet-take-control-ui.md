# Fleet Take control in Aria UI (2026-09-08)

## What works

1. Create **LinkedIn Browser Computer** seat (Settings → LinkedIn).
2. Fleet → Computers → **Start** → computer `ready` with Aria operator viewport URL when OpenBot supervisor is unset.
3. **Take control** → badge **Human control**; bot jobs refuse; Open view shows sandbox link.
4. **/fleet/computers/:id/viewport** → operator surface with Take / Release.
5. **Release** → **Bot control**.

## Artifacts

- Video: `/opt/cursor/artifacts/aria-fleet-take-control-demo.mp4`
- Screenshots: `fleet-human-control.webp`, `operator-viewport-human.webp`

## Fly

- Redeployed with `NEXT_PUBLIC_SUPABASE_ANON_KEY` build-arg so `/login` returns 200 (was 503 “auth not configured”).
- Live Chromium still needs `COMPUTER_SUPERVISOR_*`; until then viewport is Aria-hosted operator surface.
