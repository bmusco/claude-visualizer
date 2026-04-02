---
name: Database Schema Registry
description: Auto-maintained catalog of prod_redshift and prod_clone table schemas — columns, types, key joins, and gotchas. Updated automatically when new tables are queried.
type: reference
---

# Database Schema Registry

> **Auto-updated:** When a query reveals new tables or column changes, this file gets updated automatically.
> **Last updated:** 2026-03-29

---

## Database Locations

| Database | Connection | Notes |
|----------|-----------|-------|
| **prod_redshift** | via cmtpgproxy on port 13626 | Default database. Redshift cluster. |
| **prod_clone** | via cmtpgproxy on port 13626 | Aurora PostgreSQL clone. Has operational tables not in Redshift. |

---

## prod_clone Tables

### byod_consents
- **Location:** prod_clone (NOT in prod_redshift)
- **Key columns:** company_id, cmt_fleet_id, external_fleet_id, tsp_id, consent_status, created_at
- **Common filters:** company_id=821 (DWBYOD), consent_status IN ('COMPLETE','VERIFIED'), tsp_id IS NOT NULL
- **Joins to:** vehicles_v2 (on cmt_fleet_id = viewing_fleet_id AND viewing_company_id = company_id)

### vehicles_v2
- **Location:** prod_clone
- **Key columns:** short_vehicle_id, viewing_fleet_id, viewing_company_id, vin, make, model, year
- **Joins to:** datasets (on short_vehicle_id)

### datasets
- **Location:** prod_clone
- **Key columns:** short_vehicle_id, mmh_id, mmh_hide
- **Common filters:** NOT mmh_hide
- **Joins to:** mapmatch_history (on mmh_id)

### mapmatch_history
- **Location:** prod_clone
- **Key columns:** mmh_id, distance_gps_km, trip_start, trip_end, duration_seconds
- **Unit conversions:** distance_gps_km * 0.621371 = miles
- **Timezone:** trip_start AT TIME ZONE 'UTC' for day grouping

---

## prod_redshift Tables (Redshift serverless, `analytics` schema — but query via public schema)

### triplog_trips
- **Key columns:** short_vehicle_id, viewing_company_id, viewing_fleet_id, trip_start_ts, mileage_est_km, hide
- **Common filters:** viewing_company_id, hide = FALSE
- **Notes:** Main trip data table. Use mileage_est_km * 0.621371 for miles.

### vehicles_v2
- **Key columns:** short_vehicle_id, viewing_fleet_id, viewing_company_id, vin, make, model, year
- **Notes:** Also available on prod_redshift (not just prod_clone)

### fleets_fleet
- **Key columns:** id, name, company_id
- **Joins to:** triplog_trips (on id = viewing_fleet_id)

### company_summary_v3
- **Key columns:** company_lowercase_name, program_info_id, record_date, drivers, drivers_with_trips, miles
- **Common filters:** company_lowercase_name LIKE '%keyword%'

### byod_fleet_radius_of_operation_history
- **Key columns:** fleet_id, results (JSON with local/intermediate/longdistance distance)
- **Joins to:** fleets_fleet (on fleet_id = id)

### batched_trips
- **Notes:** Exists but may have different column names than triplog_trips

### vehicle_scores_history
- **Key columns:** short_vehicle_id
- **Notes:** Vehicle scoring data

---

## Gotchas & Tips
- DWBYOD tables (byod_consents, vehicles_v2, datasets, mapmatch_history) live in **prod_clone**, not prod_redshift
- Always convert distance_gps_km to miles for US reporting
- trip_start is UTC — convert for local time grouping
- Always record which database a table lives in — querying the wrong DB wastes time
