# Production Deployment

This deployment runs the application behind nginx, supports encrypted per-user
LLM provider settings with OpenRouter as the primary choice, uses the Jina Cloud
proxy for embeddings, and uses a managed PostgreSQL database. Only ports 80 and
443 are published. Uploads, templates, and Redis append-only data use persistent
Docker volumes.

## Prerequisites

- Linux host with Docker Engine and Docker Compose
- Public DNS `A`/`AAAA` record for `DOMAIN` pointing to the host
- Inbound TCP 80 and 443 open
- Managed PostgreSQL with pgvector installed or available to install
- Jina API key; each user supplies their own OpenRouter or other LLM credentials

## Configure

```bash
cp deploy/.env.prod.example deploy/.env.prod
bash deploy/generate-secrets.sh deploy/.env.prod
```

Fill all remaining blank values in `deploy/.env.prod`. `CORS_ORIGIN` must be
the exact HTTPS origin, for example `https://docs.example.gov`. No certificate
keys or database dumps belong in Git.

There is no deployment-wide chat model or OpenRouter key. After signing in,
each user opens Settings, chooses OpenRouter (the default), selects a model, and
saves their own API key. The backend encrypts that key with
`LLM_CONFIG_ENCRYPTION_KEY`; requests without a saved user provider are rejected
instead of silently using an operator account.

Validate before touching running services:

```bash
docker compose -f deploy/docker-compose.prod.yml \
  --env-file deploy/.env.prod config --quiet
```

## TLS Bootstrap

Stop anything already bound to port 80, then request the first certificate:

```bash
bash deploy/tls-bootstrap.sh
```

The script requires `DOMAIN` and `LETSENCRYPT_EMAIL`, performs an ACME HTTP-01
standalone challenge, and writes Let's Encrypt state under
`deploy/nginx/letsencrypt/`. It does not generate fallback or fake
certificates. Nginx intentionally cannot start until a usable certificate is
present.

Start the stack:

```bash
docker compose -f deploy/docker-compose.prod.yml \
  --env-file deploy/.env.prod up -d --build
docker compose -f deploy/docker-compose.prod.yml \
  --env-file deploy/.env.prod ps
```

The backend startup first runs a pgvector preflight, then Prisma migrations.
Startup fails with an actionable error if the database cannot enable or verify
pgvector. Migration history is never auto-resolved or marked as applied.

## TLS Renewal

With nginx running, renewal uses the webroot challenge and reloads nginx after
success:

```bash
bash deploy/tls-renew.sh
```

Run this daily from systemd or cron; Certbot renews only when necessary:

```cron
17 3 * * * cd /srv/LLM && /usr/bin/bash deploy/tls-renew.sh >> /var/log/llm-tls-renew.log 2>&1
```

## Data and Operations

Back up all of the following:

- Managed PostgreSQL using provider snapshots plus tested logical dumps
- `template_storage`, `uploads_data`, and `rag_state` Docker volumes
- `deploy/nginx/letsencrypt` certificate account state

After replacing the old chunker, re-upload the source PDFs or put them in
type-specific directories under a host-side `corpus/` directory. Run one
forced replacement per document type, then record the RAG baseline while
services are healthy:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod \
  run --rm -v "$PWD/corpus:/corpus:ro" backend \
  node dist/scripts/reindex_corpus.js --force --dir /corpus/cong-van --doctype cong-van
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod \
  exec -T backend node dist/scripts/evaluate_rag.js
```

Repeat the first command with the matching source directory and validated
document type for each corpus partition. A no-argument reindex is rejected to
prevent accidental replacement with an unspecified source set.

Before cutover, run the disposable migration rehearsal from the repository
root with `pwsh ./ops/rehearse-cutover.ps1`.
