# Launch Checklist

> Operator runbook for taking Bantryx from "code shipped" to "users on the site." Pairs with `C:\Users\vinde\.claude\plans\tier25.md` — that file is the **why**; this file is the **what to do, in what order, by whom**.

This document covers three phases:

1. **Pre-launch hardening** — what to do BEFORE the first marketing push (one-time operator actions)
2. **Day 1 of marketing** — what to flip when traffic starts arriving (one-time operator actions)
3. **Post-launch — trigger-driven** — parked levers with metric thresholds

Everything code-side for Tier 25 Phases 1 + 2 is already in `main`. The remaining work is operator-side (Azure portal + a single Bicep reapply).

---

## Phase 1 — Pre-launch (do this NOW, before any marketing)

### Step 1 — Bicep reapply (applies A5 + B1 + B2 to live config)

The IaC truth-source in `infra/` already carries A5 (maxReplicas 10), B1 (minReplicas 1), and B2 (geoRedundantBackup Enabled). Day-to-day CD only does `az containerapp update --image` — it never touches scale config or DB backup config. To apply, run a full Bicep reapply once:

```powershell
# Discover the current live values that Bicep needs as input
$CERT_ID = az containerapp env certificate list `
  --name scorecast-env-p3aaelev7xp52 `
  --resource-group scorecast-prod `
  --query "[?properties.subjectName=='bantryx.com'].id" -o tsv

$IMAGE_TAG = az containerapp show `
  --name scorecast-app `
  --resource-group scorecast-prod `
  --query "properties.template.containers[0].image" -o tsv `
  | ForEach-Object { ($_ -split ':')[-1] }

$VAPID_PUBLIC = az keyvault secret show `
  --vault-name scorecast-kv-p3aaelev7xp `
  --name vapid-public-key `
  --query "value" -o tsv

# Set $PG_PW interactively to avoid leaking the password into history:
$PG_PW = Read-Host -AsSecureString "Postgres admin password"
$PG_PW_PLAIN = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($PG_PW)
)

# Apply
az deployment group create `
  --resource-group scorecast-prod `
  --template-file infra/main.bicep `
  --parameters `
    customDomain=bantryx.com `
    customDomainCertId=$CERT_ID `
    pgAdminPassword=$PG_PW_PLAIN `
    vapidPublicKey=$VAPID_PUBLIC `
    imageTag=$IMAGE_TAG
```

**Expected behavior**:

- A5 (maxReplicas 3 → 10) — instant, no traffic disruption
- B1 (minReplicas 0 → 1) — one always-on replica spins up, cold starts disappear, billing starts at ~$8-12/mo
- B2 (geoRedundantBackup Disabled → Enabled) — backup config flip; first geo-replica snapshot happens with the next nightly backup window. Billing starts at ~$3/mo.

**Total added cost from this reapply: ~$13/mo recurring**. (A5 itself is $0 unless traffic uses the additional replicas.)

**Rollback**: If anything looks wrong, edit the matching field in the Bicep module and re-apply. The previous values were:

- `infra/modules/app.bicep` — `minReplicas: 0`, `maxReplicas: 3`
- `infra/modules/db.bicep` — `geoRedundantBackup: 'Disabled'`

### Step 2 — Configure App Insights alerts (Tier 25 A7)

Three alert rules. All free (App Insights is metered per ingestion, not per alert). Use the Azure portal:

#### Alert 1 — HTTP 5xx rate > 1% over 5 min

1. Portal → Application Insights → `scorecast-ai` resource → **Alerts** (left nav) → **+ Create** → **Alert rule**
2. **Scope**: should be pre-filled with the App Insights resource. Confirm.
3. **Condition** → **+ Add condition** → search for signal **Failed requests** (under "Application Insights")
4. **Threshold**: Static. **Aggregation type**: Count. **Operator**: Greater than. **Threshold value**: 5
   - For percentage-based alerting use a Log query instead: `requests | where timestamp > ago(5m) | summarize total = count(), failed = countif(success == false) | extend pct = 100.0 * failed / total | where pct > 1`
5. **Aggregation granularity**: 5 minutes. **Evaluation frequency**: 1 minute
6. **Actions** → **+ Create action group** → email yourself (or a Slack webhook if you've wired one). Name: `scorecast-ops`
7. **Details**: Severity = 2 (Warning). Alert rule name: `scorecast-5xx-rate`. Description: `HTTP 5xx rate > 1% over 5 min — likely a real production incident`
8. **Create alert rule**

#### Alert 2 — `/readyz` failures > 0 in 5 min

1. Same flow. **Signal**: search for **availabilityResults** or **customMetrics** depending on whether the readiness probe is logged as a metric
2. **Recommended log query** (Logs query alert): `requests | where url endswith "/readyz" | where timestamp > ago(5m) | where success == false | summarize count() | where count_ > 0`
3. **Threshold**: Greater than 0. **Aggregation**: 5 minutes. **Evaluation**: 1 minute
4. **Severity**: 1 (Error) — readiness failure means the replica lost DB connectivity
5. **Alert rule name**: `scorecast-readyz-failures`. Description: `/readyz returning non-200 — DB connectivity issue, replica will be removed from rotation by ACA`

#### Alert 3 — Replica count = maxReplicas for 10+ min (capacity-capped)

1. Portal → Container Apps → `scorecast-app` → **Alerts** → **+ Create** → **Alert rule**
2. **Signal**: **Replica Count** (under Container Apps metric namespace)
3. **Condition**: Static threshold. Aggregation: Maximum. Operator: Greater than or equal to. Threshold value: 10 (matches A5's new `maxReplicas`)
4. **Aggregation granularity**: 10 minutes. **Evaluation frequency**: 5 minutes
5. **Severity**: 2 (Warning) — at capacity but not yet failing
6. **Alert rule name**: `scorecast-replica-cap-hit`. Description: `Container App at maxReplicas for 10+ min — sustained traffic exceeds A5's burst headroom. Investigate; may need to raise maxReplicas further OR pull C2 (Postgres B2s).`

#### Verification

After all three alerts are created, manually trip Alert 1 by hitting a route that 5xx's:

```powershell
# Should return 500 (forces a code path that errors)
curl -X POST https://bantryx.com/api/login `
  -H "Content-Type: application/json" `
  -d '{"username":"!!!invalid!!!","password":"!!!"}'
```

(The 401 path returns a clean 4xx, not a 5xx — for a real 5xx you'd need an actual bug. If the alert doesn't fire on synthetic load, that's fine for now — you'll discover it on the first real incident.)

### Step 3 — Verify Phase 1 healthy

```powershell
# 1. /healthz still 200
curl https://bantryx.com/healthz

# 2. Cache headers on hashed asset
curl -I "https://bantryx.com/assets/$(curl -s https://bantryx.com | grep -oP 'assets/index-[a-zA-Z0-9_-]+\.js' | head -1)" `
  | Select-String "Cache-Control"
# Expect: Cache-Control: public, max-age=31536000, immutable

# 3. No-cache on the SPA shell
curl -I https://bantryx.com/ | Select-String "Cache-Control"
# Expect: Cache-Control: no-cache

# 4. Always-on replica (B1 effect) — first hit after long idle should be fast
# Wait ~10 min, then:
$timer = Measure-Command { Invoke-WebRequest https://bantryx.com/healthz }
$timer.TotalMilliseconds
# Expect: < 200ms. Without B1 this would be 3000-5000ms on cold start.

# 5. ACA replica count at idle should be 1 (B1 effect)
az containerapp replica list `
  --name scorecast-app `
  --resource-group scorecast-prod `
  --query "length(@)"
# Expect: 1

# 6. Postgres geo-redundant backup enabled (B2 effect)
az postgres flexible-server show `
  --name scorecast-db-p3aaelev7xp52 `
  --resource-group scorecast-prod `
  --query "backup.geoRedundantBackup" -o tsv
# Expect: Enabled
```

---

## Phase 2 — Day 1 of marketing (one-time when ready to push traffic)

**Nothing more to do code-side.** Phase 1's Bicep reapply already shipped B1 + B2, so cold starts are dead and geo-redundant backup is live from before the marketing push.

The remaining operator actions for Day 1:

### Step 4 — Pre-push smoke

```powershell
# All four should return 200
curl https://bantryx.com/healthz
curl https://bantryx.com/readyz
curl https://bantryx.com/api/leaderboard | Out-Null; echo "leaderboard ok"
curl https://bantryx.com/manifest.webmanifest | Out-Null; echo "PWA manifest ok"
```

### Step 5 — Watch App Insights "Live Metrics Stream" during the push

Portal → Application Insights → `scorecast-ai` → **Live Metrics** (left nav). Open in a browser tab during the marketing window. Watch:

- **Request Rate** — should climb smoothly, no cliffs
- **Failure Rate** — should stay near 0%. Any spike → check the alerts
- **Server Response Time** — P95 should stay under ~500ms for `/api/games`, `/api/leaderboard`, `/api/me`. Anything over 1s sustained means look at the Sequelize pool (A1) — wait time should be 0
- **Active Replicas** — should match real demand (1-3 at light traffic, scaling to 10 under heavy)

### Step 6 — Operator vigilance for the first 48h

Set a reminder to spot-check the App Insights overview daily. Look for:

- **Total request count** matches your marketing-funnel expectations
- **Top exceptions** chart is empty or non-recurring
- **Postgres CPU** in the DB resource overview stays under 50%
- **Container App replica count** chart shows scale events but never pins at 10 for >10 min (would trigger Alert 3)

If any of those go sideways, jump to the trigger table below.

---

## Phase 3 — Trigger-driven (parked, pull when metric fires)

All of these are independent. Each was sized in `tier25.md` with its own cost / risk / verification.

| Metric                                              | Threshold           | Lever                    | Cost added    | Action                                                                                |
| --------------------------------------------------- | ------------------- | ------------------------ | ------------- | ------------------------------------------------------------------------------------- |
| Cold-start logs / hour                              | >1                  | **B1** (already shipped) | —             | Verify Step 3 #4 passes                                                               |
| HTTP 5xx rate                                       | >1% over 5min       | (Alert 1)                | —             | Investigate immediately — could be code bug, DB outage, or capacity                   |
| `/readyz` 503 rate                                  | >0.1%               | (Alert 2)                | —             | DB connectivity — check pool wait time + Postgres CPU                                 |
| Replica count = maxReplicas for 10+ min             | Sustained           | (Alert 3)                | —             | Investigate — A5 already lifts cap to 10; if still saturating, pull C2                |
| Sequelize pool wait time                            | >100ms              | **A1** (already shipped) | —             | Re-tune `max: 20` → `max: 40` if needed; pool is config/database.js + models/index.js |
| Log Analytics daily ingestion                       | >800 MB before noon | **A6**                   | $0            | Set `LOG_LEVEL=warn` env var on scorecast-app via Bicep + reapply                     |
| Postgres CPU                                        | >70% sustained 1min | **C2**                   | +$15/mo       | B1ms → B2s online resize in `infra/modules/db.bicep`                                  |
| 2000+ DAU sustained                                 | —                   | **C3**                   | +$112/mo      | Burstable → GP D2ds_v5 in `infra/modules/db.bicep`                                    |
| Multi-replica rate-limit abuse observable           | —                   | **C1**                   | +$16/mo       | See [tier10.md](C:\Users\vinde.claude\plans\tier10.md)                                |
| 500+ concurrent users during live windows           | —                   | **C5 (=Tier 7)**         | $0 (needs C1) | See [tier7.md](C:\Users\vinde.claude\plans\tier7.md)                                  |
| `tier24.parity_mismatch` warn lines in App Insights | Any                 | —                        | $0            | Investigate immediately — dual-writer drift                                           |

Detailed per-lever cost shapes, triggers, and verification in `C:\Users\vinde\.claude\plans\tier25.md`.

---

## Deferred (parked unless signal appears)

### A3 — Cloudflare DNS "Proxied" mode (orange cloud)

**Why deferred**: Vite bundles are small + A2's browser cache covers repeat visitors. Azure platform provides basic DDoS. Marginal benefit at launch scale.

**Wake trigger**: Observable bot/scraping traffic in App Insights, OR measurable first-load latency from distant geographies, OR a DDoS event past Azure's platform protection.

**Recipe to flip** (when triggered):

1. **Verify the cert renewal pipeline first**. Azure managed cert uses HTTP-01 ACME validation. Cloudflare SSL must be set to "Full (strict)" mode before the next renewal (every 6 months). A misconfiguration mid-renewal = downtime.
2. Cloudflare dashboard → bantryx.com → DNS → flip the apex record from grey-cloud to orange-cloud (proxied)
3. SSL/TLS → "Full (strict)" mode (NOT "Flexible" — that would re-encrypt-strip and break HSTS)
4. Wait ~5 min for propagation. Hit `https://bantryx.com/healthz`.
5. **HSTS preload caveat**: Tier 22 set `HSTS max-age=63072000; preload`. Submitting bantryx.com to https://hstspreload.org is **independent of A3** as long as we stay on Azure TLS. If we ever flip to A3, the preload submission becomes a hard "verify Cloudflare cert path twice" gate. Don't submit to the preload list until the Cloudflare cert pipeline has survived at least one renewal cycle.

### B5 — Cloudflare WAF rate-limit rules

**Status**: Deferred with A3.

**Why deferred**: Requires A3 (orange-cloud) first. C1 (Redis-backed `rate-limit-redis`) achieves the same goal — globally correct per-IP rate limiting across replicas — without depending on Cloudflare proxying.

**Recipe (if A3 ever flips)**: Cloudflare dashboard → bantryx.com → Security → WAF → Rate limiting rules:

| Path                        | Threshold                   | Action       |
| --------------------------- | --------------------------- | ------------ |
| `/api/login`                | 10 requests / 15 min per IP | Block 15 min |
| `/api/register`             | 3 requests / hour per IP    | Block 1 hour |
| `/api/auth/forgot-password` | 3 requests / hour per IP    | Block 1 hour |
| `/api/me/password`          | 10 requests / hour per IP   | Block 1 hour |
| `/api/auth/reset-password`  | 5 requests / hour per IP    | Block 1 hour |

Free tier supports up to 5 rules; these fit.

---

## Quick reference — what each Tier 25 lever costs

| Lever                             | One-time effort        | Recurring cost               | Status                                     |
| --------------------------------- | ---------------------- | ---------------------------- | ------------------------------------------ |
| A1 Sequelize pool max=20          | 1 line × 2 files       | $0                           | **Live** (commit `e532008`)                |
| A2 Cache-Control on static assets | ~15 lines in server.js | $0                           | **Live** (commit `e532008`)                |
| A4 trust proxy: 1                 | —                      | $0                           | **Live** (Tier 22)                         |
| A5 maxReplicas 3 → 10             | 1 line Bicep           | $0 at idle / +$15-40 at peak | **In IaC; effective after Step 1 reapply** |
| A6 LOG_LEVEL=warn                 | env var                | $0 (saves overage)           | Parked                                     |
| A7 App Insights alerts            | 3 portal rules         | $0                           | **Step 2 above**                           |
| B1 minReplicas 0 → 1              | 1 line Bicep           | **+$8-12/mo**                | **In IaC; effective after Step 1 reapply** |
| B2 geo-redundant backup           | 1 line Bicep           | **+$3/mo**                   | **In IaC; effective after Step 1 reapply** |
| B3 /readyz + SIGTERM              | —                      | $0                           | **Live** (Tier 20 Chunk 7)                 |
| C1 Managed Redis                  | Tier 10.4 work         | +$16/mo                      | Parked, trigger-driven                     |
| C2 Postgres B2s                   | 1 line Bicep           | +$15/mo                      | Parked, trigger-driven                     |
| C3 GP Postgres                    | 1 line Bicep           | +$112/mo                     | Parked, trigger-driven                     |
| C4 N+1 leaderboard fix            | —                      | —                            | **Live** (Tier 24, `23789bb`)              |
| C5 SSE realtime                   | Tier 7 work            | $0 (uses C1)                 | Parked, trigger-driven                     |

**Total recurring cost after Step 1 Bicep reapply**: ~$45-65/mo (current ~$30-50 baseline + ~$13 from B1 + B2). A5 stays $0 until traffic uses the additional replicas.

---

## Rollback recipes

### Roll back B1 + B2 (revert the Bicep reapply)

If the always-on replica or geo backup causes issues:

```powershell
# Edit infra/modules/app.bicep minReplicas: 1 → 0
# Edit infra/modules/db.bicep geoRedundantBackup: 'Enabled' → 'Disabled'
git revert d47e415
git push origin main
# Then re-run the Bicep reapply from Step 1 with the reverted Bicep
```

### Roll back A1 (Sequelize pool) — extremely unlikely, but if needed

```powershell
git revert e532008
git push origin main
# Next CD will deploy the reverted code
```

A1's pool change is purely additive (more connections, faster timeout). It can't break anything that the default config wouldn't have broken too.

### Roll back A2 (cache headers) — also extremely unlikely

The no-cache rule on the SPA shell means users get fresh HTML on every navigation but conditional GETs return 304 quickly. The 1-year immutable cache on hashed assets is safe because Vite changes the hash on every build, so new versions get new URLs.

If somehow it breaks something: `git revert e532008` then push.

---

## Don't forget

- **CD only does `az containerapp update --image`**. Bicep changes (scale config, DB backup, env vars) DO NOT auto-deploy. Step 1 is the only way to apply A5 / B1 / B2.
- **Always-on replica (B1) does NOT make ACA stop scaling**. It guarantees the first replica is warm; ACA still spins up replicas 2-10 based on the existing `concurrentRequests: 50` rule.
- **Geo-redundant backup (B2) is NOT high availability**. It only protects against region-wide outage. Recovery is still a manual point-in-time restore to a new server (minutes to hours). True HA requires GP+ tier (~$140/mo).
- **HSTS preload submission stays independent**. After 30 days of stable `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (Tier 22), submit to https://hstspreload.org. Don't wait for A3 — preload works fine with Azure TLS today.
