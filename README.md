# Project Overview

FastAPI and MongoDB API for employee attendance capture, correction, listing, and reporting. The service uses the customer-owned `emp_code` as the public identity and stores attendance against the IST attendance date.

## Problem Being Solved

The API accepts employee and punch events, computes attendance values consistently, supports audited manual corrections, and answers monthly and daily department questions from MongoDB.

## Features

- Employee creation and filtered, ordered pagination.
- Employee emails are unique, case-insensitively; duplicate submissions return HTTP 409.
- Employee removal from the active directory with removal audit timestamp; employee and attendance records are retained.
- Punch in and punch out with IST/overnight handling and derived fields.
- Indexed attendance search and optimistic, append-only regularization history.
- Employee and department analytics, ranked late leaderboard, daily trend.
- MongoDB execution-stat explain endpoint and health readiness check.

## Architecture

Client -> FastAPI -> Pydantic validation -> business rules -> MongoDB -> response.

`app/main.py` contains request models, time/calculation helpers, database operations, routes, aggregation pipelines, and startup index creation. PyMongo uses timezone-aware UTC BSON dates; epoch milliseconds are converted at the API boundary. Analytics read stored derived fields.

## Technology Stack

Python 3.11+, FastAPI, Pydantic 2, PyMongo, MongoDB 6+, python-dotenv, Uvicorn.

## Project Structure

- `app/main.py`: complete application.
- `openapi.yaml`: authoritative API contract and R1-R10.
- `DATA_MODEL.md`: MongoDB document format.
- `sample_data/`, `sample_seed.py`: tiny illustrative fixture set and loader.
- `REVIEW.md`, `DECISIONS.md`: review findings and design choices.
- `ENGINEERING_NOTES.md`: concise continuation notes.

## Data Model

`employees` stores unique `emp_code`, profile, IST shift strings, `joined_on`, and server-set BSON `created_at`. `attendance_logs` stores one record per `(emp_code, date)`, status, BSON punch instants, stored derived values, and append-only correction history. API responses omit MongoDB `_id`.

## Attendance Lifecycle

Punch In -> unique daily record and late calculation -> Punch Out -> work hours/overtime/half-day calculation -> PATCH correction -> recomputed values and one audit entry.

## Business Rules

R1 uses IST attendance dates, assigns early overnight punches to the prior shift day, and truncates instants to seconds. R2 applies a strict ten-minute grace and floors late minutes. R3 counts overtime only from 30 minutes. R4 rounds elapsed work hours to two decimals half-up. R5 marks rounded work below 4.50 hours as half day. R6 defines presence as PRESENT/WFH/ON_DUTY. R7 counts Mon-Fri working days from joining and excludes weekend logs from present days. R8 uses half-up rounding (2 decimals, rates 4). R9 includes employees joined by period end, including zero-log people. R10 uses one-based pages and page sizes up to 100.

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | MongoDB readiness |
| POST, GET | `/employees` | Create and list employees |
| POST | `/attendance/punch-in` | Create daily attendance |
| POST | `/attendance/punch-out` | Close most recent eligible record |
| GET | `/attendance` | Filtered, paginated attendance |
| PATCH | `/attendance/{emp_code}/{date}` | Audited regularization |
| GET | `/analytics/employees/{emp_code}/monthly` | Employee monthly metrics |
| GET | `/analytics/departments/summary` | Department monthly metrics |
| GET | `/analytics/leaderboard/late` | Competition-ranked lateness |
| GET | `/analytics/departments/{department}/trend` | Gap-filled daily metrics |
| GET | `/admin/explain/{endpoint}` | MongoDB executionStats explain |

## Validation & Error Handling

Pydantic models forbid unknown body fields, constrain enumerations, lengths, and formats, and enforce strict integer epoch milliseconds. Query pagination is bounded. Errors use FastAPI `detail` responses; database connectivity errors are not returned with internal details.

## Security

MongoDB filters are built only from explicit parameters, update fields are allowlisted, and no client-provided document is merged into a MongoDB operator. MongoDB `_id` is not accepted or exposed. No credentials are stored in the repository; `MONGO_URI` and `MONGO_DB` come from the environment (optional local `.env`). Database unique indexes enforce natural keys.

## Concurrency Strategy

Employee and attendance unique indexes arbitrate duplicate inserts, with duplicate-key translated to 409. Punch-out atomically matches the open record before setting punch-out and derived values; a simultaneous loser receives 409. PATCH uses a compare-and-swap predicate on the old record values and `$push` to append one audit item atomically; a conflict receives 409.

## MongoDB Index Strategy

- `employees(emp_code)` unique: identity lookup and duplicate prevention.
- `employees(department, emp_code)`: exact department filter with employee-code ordering.
- `employees(department, joined_on, emp_code)`: department and joined-date filters plus stable listing.
- `employees(joined_on)`: unfiltered period headcount scans.
- `attendance_logs(emp_code, date)` unique: one record per employee/day and employee history access.
- `attendance_logs(date DESC, emp_code ASC)`: required global attendance order/date range.
- `attendance_logs(emp_code, date, status)`: employee/month and status-filtered reads.
- `attendance_logs(date, late_minutes)`: month/date-limited late aggregation.

## Analytics Architecture

Employee monthly totals, department summary with an employee-rooted `$lookup`, leaderboard ranking (`$rank`), and department trend gap filling (`$densify`) are MongoDB aggregations. The API does not materialize attendance collections in Python. Stored late/work/overtime/half-day values are used as the data model requires.

## Performance

List operations filter, sort, skip, limit, and count in MongoDB. Analytics constrain by employee/date or department and use aggregation. A trend is capped at 92 days. Appropriate compound indexes support the principal filter and sort patterns for datasets around 100k records.

## Explain Endpoint

`GET /admin/explain/{endpoint}` returns an executionStats explain for the selected endpoint's query/pipeline and accepts relevant filters. MongoDB is required to inspect actual plans; no plan is fabricated.

## Testing

Checks run: syntax compilation and imports, route/OpenAPI and validation checks, the automated API suite, and synthetic 100,000-attendance / 1,000-employee workloads on local MongoDB 8.2.4. The latest run measured attendance list, employee monthly, department summary, leaderboard, and 90-day trend at 23.9, 8.2, 378.2, 100.3, and 793.5 ms. All five explain endpoints showed IXSCAN and no COLLSCAN; the monthly endpoint's related working-days aggregation also used IXSCAN. The attendance page examined 50 keys/documents to return 50 records, with no blocking sort stage. These are local synthetic measurements, not remote-cluster guarantees. Eight parallel duplicate employee creates, punch-ins, and punch-outs each produced one success and seven conflicts. Rule-boundary checks covered timestamp truncation, grace, overtime, half-day, overnight shifts, join dates, >24-hour punch-out rejection, and invalid months. Exact analytics fixtures covered half-days, record-weighted hours, competition-ranking ties, pagination cutoff, trend gaps, null rates, and moving averages. PATCH history/concurrency, malformed/over-posted requests, invalid date ranges, and missing resources were also exercised. Temporary test databases were removed. MongoDB 6.x and remote-cluster behavior remain unverified. With MongoDB available, seed with `python sample_seed.py` and run `uvicorn app.main:app --port 8000`.

For automated unit and API integration checks, install development requirements with `pip install -r requirements-dev.txt`, start local MongoDB, and run `python tests/run_qa.py`. The runner deliberately uses `mongodb://localhost:27017` (it ignores `MONGO_URI`), creates a uniquely named temporary database, and drops it on completion. It checks pure attendance-rule boundaries, exact API calculations and analytics values, validation, corrections and append-only history, pagination, concurrency, overnight shifts, and all five explain routes. To repeat the synthetic scale check, run `python tests/run_performance.py`; it seeds 1,000 employees and 100,000 attendance records in a separate temporary local database, records endpoint timings, checks explain plans, and drops the database afterward.

## Setup

Install Python 3.11+, install MongoDB 6+, create a virtual environment, then run `pip install -r requirements.txt`. Copy `.env.example` to a local, untracked `.env` and set `MONGO_URI` (and optional `MONGO_DB`) there, or configure those environment variables in the shell. `MONGO_URI` defaults to local MongoDB for developer convenience. Keep database credentials in the backend root `.env`; `frontend/.env` is for the public `NEXT_PUBLIC_API_URL` only.

## Running

`uvicorn app.main:app --port 8000`

## Local Demo Data

For a development demo, set `MONGO_URI` and optional `MONGO_DB` in the backend environment, then run `python seed_demo.py`. It seeds exactly 20 employees (`EMP1001`–`EMP1020`) and 252 attendance records across 14 calendar days including today. `EMP1001` and `EMP1020` start with no attendance records so they can be used to demonstrate punch-in/out. The data includes all five attendance statuses, late arrivals, half-days, and overtime. The script replaces only this reserved demo-code range each time it runs; it does not touch other employees. To remove just the demo records, run `python seed_demo.py --reset`. Do not point demo seeding at a production database.

## Example Requests

```http
POST /attendance/punch-in
Content-Type: application/json

{"emp_code":"EMP0001","punched_at":1783312500000,"status":"PRESENT"}
```

```http
GET /analytics/employees/EMP0001/monthly?month=2026-07
```

## Design Decisions

Unique indexes provide correctness under races; optimistic compare-and-swap preserves correction history. Analytics remain database-side. Competition ranks retain all ties at or above the requested cutoff.

## Limitations / Future Improvements

The application is a single-file assignment service with offset pagination. The 100k check used synthetic local data on MongoDB 8.2.4; it does not establish performance for the remote deployment or MongoDB 6.x. For much larger data, benchmark the target workload and consider keyset pagination and precomputed reporting summaries while preserving the response contract.

## Frontend

The separate `frontend/` application is a Next.js 16 + TypeScript dashboard using Tailwind CSS, lucide-react, and Recharts. It provides Dashboard, Employees, Attendance, Analytics, and API Health routes. Shared shell and UI components keep cards, forms, badges, tables, states, and navigation consistent across the pages. Employee and attendance lists use server-side pagination; analytics nulls, ranks, and values preserve API semantics. Department trend ratios are converted to percentages for chart and table display. A same-origin Next.js rewrite forwards requests to FastAPI, avoiding browser CORS configuration; MongoDB remains backend-only.

To run the frontend:

```sh
cd frontend
npm install
npm run dev
```

Set `NEXT_PUBLIC_API_URL=http://127.0.0.1:8000` in `frontend/.env.local` if the API is hosted elsewhere. `frontend/.env.example` documents the local default. Start the backend separately with `uvicorn app.main:app --port 8000` and configure its MongoDB connection only in the backend environment.

For Vercel, set the project Root Directory to `frontend` and configure `NEXT_PUBLIC_API_URL` as the public HTTPS origin of the separately deployed FastAPI service. This value configures the Next.js `/backend/*` rewrite at build time; it must not be localhost in production. Set `MONGO_URI` and optional `MONGO_DB` only in the backend host's server-side environment. No public backend URL is currently configured in this repository.

Frontend checks: `npm install`, `npm run lint`, and `npm run build`. The five routes listed above are statically generated by the production build; the health page and shell read `/health` through the same-origin proxy. The dashboard intentionally omits attendance-rate and present-today totals because the current API does not provide an exact aggregate for those metrics.






