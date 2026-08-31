# Free-tier deployment options for DocAI

Date: 2026-08-31

## Question

What is the safest production deployment for the current compose-based DocAI
stack when the Oracle account cannot be upgraded to Pay As You Go and recurring
infrastructure cost should remain zero?

## Findings

### Oracle Always Free is the only zero-cost VM that fits the current stack

Oracle documents the free-only Ampere A1 allowance as 1,500 OCPU-hours and
9,000 GB-hours per month, equivalent to **2 OCPUs and 12 GB RAM total**. It can
be allocated to one A1.Flex VM, which is the useful layout for this stack.
Always Free also includes 200 GB total boot/block storage in the home region.

Source: [Oracle Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

This is enough for the existing low-concurrency Docker Compose deployment:
Postgres, Redis, the Node backend, the Python API, one conversion worker, and
Caddy. It is not enough for high conversion concurrency, so the production
worker count remains one and the queue backpressure limit remains 100.

There are two availability risks that the deployment must not hide:

1. A1 creation can fail with `out of host capacity`. Oracle recommends trying
   another availability domain in the home region or waiting and retrying.
2. Oracle may reclaim an Always Free instance deemed idle across seven days.
   The documented test covers CPU, network, and (for A1) memory utilization.
   Artificial traffic or load must not be generated to evade reclamation.

The runbook therefore treats successful A1 provisioning as a hard cutover gate
and treats the VM as replaceable. Nightly encrypted off-provider database
backups are mandatory.

### GCP Free Tier cannot host this compose stack safely

Google's Compute Engine Free Tier supplies one `e2-micro` in selected US
regions, with 30 GB of standard persistent disk and 1 GB/month outbound
transfer. Google documents the `e2-micro` as a shared-core shape with 1 GB RAM.
That cannot safely hold the
current Postgres + Redis + Node + Python conversion stack and gives the PDF
worker no useful memory headroom.

Sources:

- [Google Cloud Free Program](https://docs.cloud.google.com/free/docs/free-cloud-features)
- [Compute Engine E2 machine types](https://docs.cloud.google.com/compute/docs/general-purpose-machines)

Moving the current stack to the free GCP VM is rejected. Splitting it across
Cloud Run, managed databases, queues, and object storage would be a substantial
architecture change and still would not guarantee zero cost for the always-on
worker and stateful services.

If Oracle A1 cannot be provisioned or is reclaimed, the low-change recovery
option is a paid GCP `e2-medium` VM (two exposed vCPUs, one fractional vCPU,
and 4 GB RAM) with persistent disk. As of this research date, Google's Iowa
on-demand list price is $0.03350571/hour (about $24.46 for 730 hours) before
disk, public IPv4, and network charges. Its current console estimate must still
be reviewed before creation; it is a paid
fallback and is never created automatically. If that cost is not acceptable,
production waits for Oracle A1 capacity or for a separately approved serverless
redesign.

Source: [Google Cloud general-purpose VM pricing](https://cloud.google.com/products/compute/pricing/general-purpose)

### Cloudflare Workers Free remains suitable, with a CPU caveat

The Free plan currently documents 100,000 requests/day, 128 MB memory, 10 ms
CPU time per request, and a 100 MB request-body limit for Free accounts.
Network wait time does not count as Worker CPU. The product's 50 MB per-file cap
therefore fits only because every selected file is sent through the existing
proxy as an independent request. The soft launch must watch Worker CPU-limit
errors because authentication, SSR, and large-payload parsing can exceed 10 ms.

Source: [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

Workers Paid is not pre-authorized. If the soft launch shows repeatable CPU
limit errors, the deployment pauses until the operator approves either a code
optimization or the paid Workers plan.

### Backups and monitoring can remain free-first

GCS provides 5 GB-months of regional storage in `us-east1`, `us-west1`, or
`us-central1`. Encrypted `age` backups remain in GCS for provider independence,
with a 30-day lifecycle. The operator must watch stored bytes: usage above 5 GB
can incur charges on the active GCP billing account.

Oracle Always Free includes Monitoring ingestion/retrieval and 1,000 email
notifications per month, so OCI custom metrics and email alarms do not require
Grafana Cloud, UptimeRobot, or a Telegram bot for this pilot.

Sources:

- [Google Cloud Free Program](https://docs.cloud.google.com/free/docs/free-cloud-features)
- [Oracle Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

## Decision

Use this order:

1. **Primary:** one OCI Always Free `VM.Standard.A1.Flex` VM at exactly 2 OCPU /
   12 GB RAM in the tenancy home region, plus Cloudflare Workers Free.
2. **Recovery posture:** encrypted nightly GCS backup, reproducible main-only
   deployment, and automatic application rollback. A reclaimed VM is rebuilt;
   it is not treated as durable infrastructure.
3. **Provisioning gate:** if no A1 capacity is available, do not deploy the
   stack to an AMD micro or GCP e2-micro. Retry another availability domain or
   later.
4. **Paid fallback, only with explicit approval:** a GCP e2-medium-class VM.
   No script may create paid capacity automatically.

This is a free-first soft launch, not high-availability production. A single
Always Free VM can disappear and has no availability SLA committed by this
project. That risk is accepted only for the 3–10 user pilot with the documented
RPO of 24 hours and RTO of eight waking hours.
