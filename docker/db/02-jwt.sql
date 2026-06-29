-- Pin the JWT secret + expiry into the database settings so PostgREST/RLS can verify
-- the anon/authenticated/service_role JWTs minted by GoTrue. MUST match GOTRUE_JWT_SECRET
-- and the secret the ANON_KEY/SERVICE_ROLE_KEY were signed with.
\set jwt_secret `echo "$JWT_SECRET"`
\set jwt_exp `echo "$JWT_EXP"`

ALTER DATABASE postgres SET "app.settings.jwt_secret" TO :'jwt_secret';
ALTER DATABASE postgres SET "app.settings.jwt_exp" TO :'jwt_exp';
