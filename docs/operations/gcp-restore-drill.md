# Cloud SQL restore drill

## Objective

Prove the RTO of 4 hours and RPO of 24 hours before launch and after a material schema or recovery change. A drill restores a successful backup to a new instance named `docai-restore-*`; it never overwrites production.

## Procedure

1. Select the latest successful backup or the release's pre-migration backup. Record the backup ID and production instance metadata without database contents.
2. Preview, then execute:

   ```powershell
   ./ops/gcp/restore-drill.ps1 -ProjectId project-96fe5a5e-a0df-4a2f-902 -Region asia-southeast1 -SourceInstance docai-postgres -DrillInstance docai-restore-YYYYMMDD
   ./ops/gcp/restore-drill.ps1 -ProjectId project-96fe5a5e-a0df-4a2f-902 -Region asia-southeast1 -SourceInstance docai-postgres -DrillInstance docai-restore-YYYYMMDD -Execute
   ```

3. Connect to the new instance through Cloud SQL Auth Proxy with a drill-only credential. Run `npx prisma migrate status`; never edit or resolve Prisma migration history to make the drill pass.
4. Run the ownership-integrity assertion. Verify counts and hashes rather than exporting row contents into evidence.
5. Log in against a temporary backend wired to the restored instance and confirm representative owned documents and templates are present and isolated by owner.
6. Record start/end time, backup ID, new instance name, Prisma status, ownership result, representative checks, and achieved RTO/RPO.
7. Display the exact disposable instance, then delete only `docai-restore-*` after evidence is accepted:

   ```powershell
   gcloud sql instances describe docai-restore-YYYYMMDD --project=project-96fe5a5e-a0df-4a2f-902
   gcloud sql instances delete docai-restore-YYYYMMDD --project=project-96fe5a5e-a0df-4a2f-902
   ```

Failure to verify migration state, ownership, or representative records means the drill failed. Keep production unchanged and investigate the backup path.
