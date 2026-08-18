# Trial-credit and October exit runbook

## Gates

- By September 15, choose and test: paid Google Cloud, a scale-to-zero migration, or export and shutdown.
- By September 25, complete a rehearsal of the selected path.
- If the billing forecast exceeds $225 or the run rate exhausts credit before September 25, pause nonessential load tests, reduce safe warm capacity, and advance the decision immediately.

If no path is approved, the default path is encrypted export and shutdown before October 1.

## Default export and shutdown

1. Create and verify a final Cloud SQL backup.
2. Grant the Cloud SQL service agent write-only operational access to the private export bucket, then run `ops/gcp/export-and-shutdown.ps1` without `-ConfirmShutdown`. This produces a Cloud SQL export encrypted at rest, an all versions bucket object inventory, and an LLM-key recovery metadata check. It does not read secret payloads.
3. Download the database export and required bucket objects to encrypted offline storage. Verify checksums and the encrypted offline LLM encryption key recovery copy. Do not place keys or data contents in release evidence.
4. Perform a restore rehearsal from the exported material and confirm Prisma status, ownership integrity, and representative records.
5. Review the exact Cloud Run services, jobs, and SQL instance printed by the script. Buckets, secrets, Terraform state, exports, and evidence are deliberately retained.
6. Re-run with `-ConfirmShutdown` only after the offline recovery set is accepted. The switch deletes the named DocAI Cloud Run compute and exported SQL instance; it does not delete recovery storage or secrets.
7. Confirm no public Cloud Run service remains, billing forecast has flattened, and retained storage lifecycle/charges are understood.

To resume later, create a new database instance, restore into that new instance, provide new explicit secret versions, apply Terraform, run migrations, deploy immutable images, and complete authenticated smoke before restoring traffic.
