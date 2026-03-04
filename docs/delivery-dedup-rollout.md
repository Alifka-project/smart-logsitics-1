### Delivery deduplication rollout plan

- **Phase 1 – Code deployment**
  - Deploy the `businessKey` field on `Delivery` and the shared `deliveryDedupService` with application-level deduplication by `(poNumber, originalDeliveryNumber)`.
  - Ensure new uploads and SAP ingestions go through the helper so that re-importing the same logical delivery updates the existing row instead of creating a new one.

- **Phase 2 – Analyze existing data**
  - In a safe environment, query existing deliveries grouped by `poNumber` and `metadata.originalDeliveryNumber` (or related SAP fields) to identify current duplicates.
  - Decide for each duplicate group whether to keep the earliest, the latest, or mark older rows as archived using metadata flags.

- **Phase 3 – Clean up legacy duplicates**
  - Apply the chosen merge policy to legacy data, updating or archiving duplicates so that each `(poNumber, originalDeliveryNumber)` pair maps to a single live delivery row where possible.
  - Verify that customer-facing tracking and admin dashboards still behave as expected after cleanup.

- **Phase 4 – Enforce database uniqueness (optional but recommended)**
  - Backfill the `businessKey` column for all existing deliveries using normalized `(poNumber, originalDeliveryNumber)` where available.
  - After backfill and cleanup, add and apply a unique index on `businessKey` at the database level to enforce idempotency.

- **Phase 5 – Monitoring**
  - Monitor logs and `DeliveryEvent` entries for `duplicate_upload` / `sap_reimport` to confirm that duplicate uploads are being detected and de-duplicated instead of creating new rows.
  - Adjust the mixed update rules if you see fields being overwritten that should remain immutable for terminal deliveries.

