# Project State

## Assignment Contract
FastAPI + MongoDB 6+; routes and R1-R10 are defined by `openapi.yaml`. Employee identity is `emp_code`; instants cross HTTP as epoch milliseconds, calendar dates as strings. API status codes and response shapes follow the contract.

## Architecture
Single-file `app/main.py`: Pydantic request models, IST/UTC helpers, Mongo operations, aggregation builders, endpoint handlers. MongoClient is timezone-aware UTC. Indexes are created on startup.

## Data Model
`employees` keyed uniquely by `emp_code`; `attendance_logs` uniquely keyed by `(emp_code,date)`. BSON UTC dates for instants; string dates/times; stored derived fields; history is append-only.

## Business Rules
R1 IST attendance day, overnight attribution and second truncation. R2 strict >10-minute grace, floor elapsed minutes. R3 overtime only at >=30 minutes. R4 seconds/3600 rounded half-up to 2 decimals. R5 rounded work <4.50 means half-day. R6 three presence statuses. R7 weekdays and joined-date handling. R8 half-up rounding. R9 headcount includes joined employees with no logs. R10 one-based pages, max size 100.

## Endpoint Status

| Endpoint | Status | Important implementation notes | Tests |
|---|---|---|---|
| GET /health | Implemented | Mongo ping; 503 sanitized on failure | Seeded Mongo ping returned 200 |
| POST/GET /employees | Implemented | unique index, duplicate key 409, filtered sorted pagination | Seeded list; parallel create 1x201/7x409 |
| POST punch-in | Implemented | R1/R2, unique natural key handles races | Parallel duplicate: 1x201/7x409 |
| POST punch-out | Implemented | atomic open-record update, 24h bound | Parallel close: 1x200/7x409 |
| GET /attendance | Implemented | server filtering/sort/pagination | Seeded date filter/page verified |
| PATCH attendance | Implemented | compare-and-swap plus `$push` history | Changed-field audit and no-op 422 verified |
| Monthly analytics | Implemented | aggregation over stored values | Seeded aggregation smoke check |
| Department summary | Implemented | employees-rooted lookup includes zero-log headcount | Seeded aggregation smoke check |
| Late leaderboard | Implemented | `$rank`, cutoff applied after rank | Seeded aggregation smoke check |
| Department trend | Implemented | `$densify`, window average, 92-day cap | Seeded aggregation smoke check |
| Admin explain | Implemented | executionStats explain commands | Seeded aggregation smoke check |

## Security
Strict Pydantic body models forbid extras; timestamps strict integers and bounded; explicit Mongo filters and update allowlists; errors omit DB internals. No secrets added. No authentication is specified by assignment.

## Concurrency
Unique employee and attendance indexes arbitrate creates. Punch-out uses conditional atomic update. Regularization compares prior state and appends history in one atomic update; stale updates get 409.

## MongoDB
Indexes: unique employees.emp_code; employees(department,emp_code) for filtered employee listing and ordering; employees(department,joined_on,emp_code); employees(joined_on); unique attendance(emp_code,date); attendance(date desc,emp_code asc); attendance(emp_code,date,status); attendance(date,late_minutes). Analytics use aggregation; trend uses `$densify` and `$setWindowFields`.

## Testing
Executed syntax compilation, imports/OpenAPI, validation/security checks, seeded integration, and a synthetic 100,000 attendance / 1,000 employee workload on local MongoDB 8.2.4. List date filter/page 3 returned 50 of 28,000 in 16.6 ms (150 index keys, 50 docs); filtered list returned 20 of 69 in 10.0 ms. Monthly 10.3 ms; department summary 48.1 ms; leaderboard 151.1 ms; 90-day trend 135.5 ms. Winning attendance plan used `attendance_date_code` with IXSCAN/FETCH/SKIP/LIMIT and no blocking sort. $lookup execution stats had zero collection scans: monthly 28 keys/docs; summary 2,828; leaderboard attendance 27,559 keys / 27,531 docs and employee lookup 1,000; trend attendance 9,090 and joined employee lookup 9,000. Eight-way employee-create and punch-in races each yielded 1x201 + 7x409; punch-out 1x200 + 7x409. Concurrent distinct PATCHes yielded 200/409 and one preserved history entry. Security invalid-input checks returned 422. MongoDB 6.x not tested. The remote URI was not used. Automatic command review rejected passing the credential in a shell command; no remote connection was made. A final Uvicorn run against local MongoDB returned health 200, create 201, punch-in 201, punch-out 200, and monthly analytics 200; temporary records were removed.

## Known Issues
Local MongoDB 8.2.4 synthetic 100k plans and core races were exercised. MongoDB 6.x compatibility and remote-cluster behavior remain unverified; the supplied credential was not written to a file and the remote connection was not attempted after automatic command review blocked it.

## Changed Files
Hardening pass: `app/main.py` fixed validation-error serialization, explicit-null request handling, and explain input parity. `README.md` and this file updated with local Uvicorn smoke, 100k plans, timings, version, and race results. Submission archive created outside the project directory. No remote URI, .env, or local database artifacts added.

## Frontend Integration

Implemented a separate Next.js 16.4 App Router application in `frontend/` using TypeScript, Tailwind CSS, lucide-react, and Recharts. `frontend/lib/api.ts` centralizes typed calls and sanitized error mapping; `frontend/next.config.ts` rewrites same-origin `/backend/*` requests to the configured FastAPI base URL. `NEXT_PUBLIC_API_URL` is the only frontend configuration. Routes: dashboard, employees, attendance, analytics (employee monthly, department summary, late leaderboard, department trend), and health. Employee and attendance lists use backend pagination. Trend ratios are converted to percentages for display; null values and ranks preserve API semantics. API workflows and analytics were exercised against temporary populated databases, then removed. All five production pages and five read-only proxy/API routes returned HTTP 200; responsive browser checks are recorded under Frontend Polish. `npm audit --omit=dev` reported no production vulnerabilities; full audit reports five high findings in development tooling. No direct database access or credentials are used.

### Frontend Polish

Completed a consistent visual pass across all five routes: responsive fixed sidebar and mobile drawer, contextual page headers, shared cards/forms/buttons/notices/stat cards, readable responsive tables, and common loading/error/empty treatments. Added accessible focus states, dialog keyboard handling, compact analytics tabs and report controls, responsive department summary cards, and an explicitly labeled daily trend chart. Dashboard metrics remain limited to exact API data; trend nulls and backend ranking are preserved. Headless Chrome/Playwright verified all five routes at 375, 390, 768, 1024, 1280, and 1440 px with no horizontal overflow; mobile drawer and employee dialog open and close with Escape, favicon returns 200, and no browser console errors were observed. A contract audit found trend ratios were initially formatted as percentages without unit conversion; chart and daily table now multiply the API fraction by 100 while preserving nulls.

## Decisions
Natural-key uniqueness is enforced by MongoDB. Regularizations use compare-and-swap plus atomic append. Analytics use stored derived values and database aggregation. Trend generation is bounded to 92 dates.

## Next Steps
If remote validation is needed, set `MONGO_URI` in the local shell outside the submission, then rerun the smoke flow. MongoDB 6.x compatibility also remains to be tested.

## Final Production Verification (2026-10-14)

Ran isolated API workflows against local MongoDB 8.2.4 using temporary databases, then removed them. Health, employee create/list/filter/order/pagination, strict body validation, attendance list/range filtering, PATCH with audit history, all four analytics routes, weekend trend gap filling, and all five explain routes passed. Employee create, punch-in, and punch-out races each produced one success and seven 409 responses. A PATCH race accepted both non-overlapping changes and preserved both audit entries. Rule-boundary checks covered millisecond truncation, the 10-minute late grace, overtime threshold, the 4.50-hour half-day boundary, overnight attribution, join-date working days, zero-log headcount, and null trend rate before joining. An earlier-than-punch-in punch-out returned the required 422 after a targeted fix. Invalid year/month input returned 422 while `9999-12` and a max-date trend range were verified. A filtered employee-list explain on 20,000 employees used `department_employee_code` and examined 20 keys/documents for 20 results. A 100,000-attendance / 1,000-employee synthetic run returned attendance list in 28.0 ms, employee monthly in 9.1 ms, department summary in 526.5 ms, leaderboard in 120.7 ms, and a 90-day trend in 180.2 ms. All five explain outputs contained IXSCAN and no COLLSCAN. Exact analytics fixtures verified half-days, record-weighted hours, tie cutoff and department ranking, gap filling, null rates and moving averages. Timings are local and synthetic. MongoDB 6.x and the remote cluster remain unverified. Frontend lint/build and responsive browser verification are recorded above; all five production pages and five read-only proxy/API routes returned HTTP 200. The department trend chart/table now convert fractional rates to percent for display. Production dependency audit reported no vulnerabilities; full `npm audit` reports five high findings through the `eslint-config-next`/`braces` development dependency chain; the offered forced fix downgrades ESLint config to 14.2.35. Added a repository-root `.gitignore` for local env/secrets, Python artifacts, and frontend build/dependency directories.

## End-to-End QA Run (2026-10-14)

Added `tests/test_business_rules_unit.py`, `tests/test_api_integration.py`, `tests/run_qa.py`, `tests/run_performance.py`, and `requirements-dev.txt`. `python tests/run_qa.py` passed 11 tests (5 pure unit tests and 6 API integration scenarios) on local MongoDB 8.2.4: employee validation, attendance actions and filters, exact monthly/department/trend analytics, audit history, overnight attribution, request bounds, five explain plans, and create/punch/correction races. Each run creates and drops a random local database. The latest 100k performance run measured attendance list 23.1 ms, monthly 8.8 ms, department summary 311.4 ms, leaderboard 83.2 ms, and 89-day trend 628.1 ms. Attendance list returned 50 rows after examining 50 keys and documents, with no blocking sort; all five plans contained IXSCAN and no COLLSCAN. A separate live Uvicorn HTTP smoke passed health, employee creation, punch-in/out, listing, and exact monthly/department analytics. The frontend served Dashboard, Employees, Attendance, Analytics, and Health pages with HTTP 200; `/backend/health` also returned 200. Browser-driven form/navigation testing was not completed because the computer-use safety check could not verify the open browser URL. Frontend `npm run lint` and `npm run build` passed. No root `.env` or frontend `.env.local` exists; source scanning found no credential-like strings. Python 3.10.11 was used for the passing integration run, below the documented Python 3.11+ target; a Python 3.12 test environment could not install pytest/httpx because the configured package index returned no versions. FastAPI emitted the existing `on_event` deprecation warning. MongoDB 6.x and remote-cluster behavior remain untested.

## Requirement Audit Follow-up (2026-10-14)

Traced every route and R1-R10 rule against `openapi.yaml` and `DATA_MODEL.md`. Found explain-pipeline duplication that could drift from route behavior; extracted `employee_monthly_pipeline`, `department_summary_pipeline`, and `late_leaderboard_pipeline` and use each in both the API handler and matching explain operation. The attendance-list explain now also preserves a supplied empty `emp_code` exactly as the route does. No analytics formula or database filter was otherwise changed. Fresh `python tests/run_qa.py` passed 11 tests on Python 3.10.11 / local MongoDB 8.2.4. Latest synthetic 1,000 employee / 100,000 attendance run: attendance list 21.0 ms, employee monthly 9.3 ms, department summary 286.0 ms, leaderboard 71.4 ms, 90-day trend 616.8 ms. All five explain plans used IXSCAN with no COLLSCAN; attendance listing examined 50 keys and 50 documents for 50 rows, with no blocking sort. `npm install` completed without package-lock changes; lint/build passed. Production npm audit: zero findings; full audit: five high findings in the `eslint-config-next` development dependency chain (`@next/eslint-plugin-next`, `braces`, `fast-glob`, `micromatch`), with npm's suggested forced fix downgrading to 14.2.35, so no downgrade was applied. Python 3.12 is installed, but dependency installation could not reach public PyPI; passing Python tests therefore remain Python 3.10.11 and do not meet the project's stated Python 3.11+ setup target. MongoDB 6.x, a remote backend, Vercel deployment, and browser click-through were not tested. README now documents the Vercel root directory and `NEXT_PUBLIC_API_URL` setting; no backend URL is invented.

Final explain audit follow-up: monthly explain also includes `related_explains.working_days` for the employee-side aggregation the live monthly endpoint performs. The integration assertion confirms that related plan has IXSCAN and no COLLSCAN. Reran the complete suite (11 passed) and 100k performance check after this change. Latest timings: list 23.9 ms, monthly 8.2 ms, department summary 378.2 ms, leaderboard 100.3 ms, trend 793.5 ms. Temporary databases were dropped. The monthly primary plan examined 10 keys/documents for 1 result; attendance listing examined 50/50 for 50 rows with no blocking sort; all five main plans and the additional monthly workday plan used IXSCAN and no COLLSCAN.

## Local Demo and UI Pass (2026-10-14)

Added `seed_demo.py` for the reserved `EMP1001`-`EMP1020` range and a safe `--reset` operation limited to that range. It creates 20 employees and 252 valid attendance rows over 14 IST calendar dates, including every supported status, late arrivals, half-days, overtime, and two employees with no attendance. Repeated seed and reset/reseed checks confirmed no duplicate accumulation; the final local `attendance_db` contains the baseline 20 demo employees and 252 demo rows. Added seed-data unit checks and `tests/conftest.py` so direct `python -m pytest` uses and drops a temporary local database rather than the configured `.env` database. `python -m pytest -q` and `python tests/run_qa.py` both passed 13 tests; `python tests/run_performance.py` passed on local MongoDB 8.2.4. The Employees page now searches all fetched API employee pages by code/name/email/department, applies exact server-side department filters, exposes 10/20/50 page sizes, and has a refresh action. Analytics exposes the supported leaderboard rank limit. Frontend lint and production build passed. The existing local development servers returned HTTP 200 for all five routes and `/backend/health`; same-origin HTTP checks verified employee listing/creation, department and attendance filters, monthly/department/leaderboard/trend reports, and punch-in/out followed by list refresh. Temporary API-created employee and punch record were removed after the smoke. Browser click-through and console inspection were unavailable, so page controls were not interacted with in a browser. `MONGO_URI` is stored in the root `.env`; `frontend/.env` contains only `NEXT_PUBLIC_API_URL`; `.env.example` documents backend placeholders. The configured external URI was not used for seeding; local MongoDB was used for the demo.






