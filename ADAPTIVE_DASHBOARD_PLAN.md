# BHA Adaptive Client Dashboard

## Locked rule
The dashboard is driven by the data available for the selected client. A missing metric is never silently represented as zero.

## Safety
- Existing production tables and uploaded rows are not mutated by this phase.
- Client isolation remains mandatory.
- Raw source data remains the source of truth.
- Mapping is additive and client-specific.
- All Clients aggregation must show reporting coverage.

## Runtime flow
1. Select client.
2. Load that client's available datasets.
3. Detect source columns.
4. Apply saved client mapping when available.
5. Build a capability profile.
6. Calculate only supported KPIs.
7. Build a dashboard plan from supported capabilities.
8. Render supported sections and use an explicit unavailable state for unsupported metrics.

## Canonical concepts
claim_id, patient, service_date, claim_date, submitted_date, charge_amount, payment_amount, balance, allowed_amount, payer, denial_code, denial_description, denial_amount, aging_days, aging_bucket, status, verification_status, authorization_status, deposit_amount.

## Executive Overview behavior
- Charges card appears only when charge data exists.
- Collections appears only when payment data exists.
- Outstanding AR appears only when balance data exists.
- Denial Rate appears only when denial evidence exists.
- Days in AR appears only when numeric aging data exists.
- Collection Rate requires both charges and payments.
- AR > 90 requires balance plus aging.
- Unsupported metrics must not display 0 as a substitute for missing data.

## All Clients
Each aggregate metric must carry `reportingClients / totalClients`. Never imply full-client coverage when only some clients provide the metric.

## Next integration step
Load `adaptive-dashboard-engine.js` before dashboard rendering. For each selected client, combine its AR/denial/payment/verification datasets (or profile them independently where row grains differ), call `BHAAdaptiveDashboard.buildProfile`, then render from `dashboardPlan(profile)`.

Do not merge to production until client isolation, current live KPIs, AR, Denials, Payments, Verification, Data Imports and role views pass regression testing.
