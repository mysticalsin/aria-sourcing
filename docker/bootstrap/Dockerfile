# One-shot bootstrap image: has psql (apply migrations + promote admin profile) and
# curl (seed the GoTrue login user via the admin API). Runs once per `up`, then exits.
FROM postgres:17-bookworm
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY run.sh /usr/local/bin/run.sh
RUN chmod +x /usr/local/bin/run.sh
ENTRYPOINT ["/usr/local/bin/run.sh"]
