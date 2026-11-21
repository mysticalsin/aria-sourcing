FROM golang:1.22-bookworm
WORKDIR /src
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 go build -o /out/aria-services ./cmd/aria-services
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=0 /out/aria-services /usr/local/bin/aria-services
USER nobody
EXPOSE 8080
ENTRYPOINT ["aria-services"]
