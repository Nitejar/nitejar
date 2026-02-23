# tRPC (Admin UI)

We use tRPC for admin UI data flows. Prefer adding procedures here instead of
creating new ad-hoc API routes for admin pages.

## Locations

- Routers: `apps/web/server/routers/*`
- tRPC init: `apps/web/server/trpc.ts`
- App router: `apps/web/server/routers/_app.ts`
- API route: `apps/web/app/api/trpc/[trpc]/route.ts`
- Client setup: `apps/web/lib/trpc.ts`
- Provider: `apps/web/app/admin/Providers.tsx`

## Add a new procedure

1. Add procedure to a router in `apps/web/server/routers`.
2. Export it in `apps/web/server/routers/_app.ts`.
3. Use it from client components via `trpc.<router>.<procedure>.useQuery/useMutation`.

## Notes

- Admin UI uses React Query via tRPC.
- Keep input validation in the router (zod).
