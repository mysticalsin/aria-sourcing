# One-shot bootstrap image: has psql (apply migrations + promote admin profile) and
# curl (seed the GoTrue login user via the admin API). Runs once per `up`, then exits.
FROM postgres:17-bookworm@sha256:5530681ea5d3e2ed4ce396f9b5cb443efbac6baf2a8a19c0c0635e40ae7eadce
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY run.sh /usr/local/bin/run.sh
COPY migrate.sh /usr/local/bin/migrate.sh
COPY supabase-admin-reconciliation.sql /opt/aria/supabase-admin-reconciliation.sql
RUN chmod +x /usr/local/bin/run.sh /usr/local/bin/migrate.sh
USER postgres
ENTRYPOINT ["/usr/local/bin/run.sh"]
