# Starter Review

| # | Where | What is wrong | How you'd notice it | How you fixed it |
|---|---|---|---|---|
| 1 | `compute_late_minutes` | Naive wall-clock arithmetic ignores IST/date and overnight shifts; negative or wrong lateness is possible. | Punch at 00:30 after an overnight shift start. | Calculate against the attendance date and IST shift start in UTC. |
| 2 | `compute_late_minutes` | Truncation and grace-boundary behavior did not follow R1/R2. | Test 09:40:00.900 and 09:40:01. | Truncate instants to seconds and apply strict >600 seconds. |
| 3 | `compute_work_hours` | Python `round` uses ties-to-even and binary floats. | A duration whose hundredth-hour tie rounds differently. | Decimal half-up from integer elapsed seconds. |
| 4 | `compute_overtime` | Uses a naive date/end construction and mishandles overnight end dates and tz awareness. | 22:00–06:00 shift punched out next morning. | Build IST shift-end instant on the correct calendar day. |
| 5 | `health` | Always returns ready without pinging MongoDB. | Stop MongoDB and GET /health. | Ping Mongo and return sanitized 503 on failure. |
| 6 | Employee input/create | No strict schema constraints, extra-field control, shift equality check, or date validation. | Send invalid code/date or `created_at`. | Strict Pydantic model, allowlisted fields and validation. |
| 7 | Employee create | Check-then-insert races; no DB-level unique guarantee. | Parallel duplicate POSTs. | Unique index; translate duplicate-key to 409. |
| 8 | Employee create | `created_at` is local naive time rather than aware UTC BSON. | Compare API millis against expected instant. | Store aware UTC and serialize epoch milliseconds. |
| 9 | Employee listing | `skip=page*page_size` skips page one; total ignores department; no bounds. | Request page 1 or filtered department. | Correct offset, filtered count, bounded parameters. |
| 10 | Punch-in | Missing employee check can dereference `None`; invalid statuses accepted. | Unknown employee / ABSENT status. | 404 and enum validation. |
| 11 | Punch-in | Uses host-local seconds and date instead of epoch-ms/IST rules; no timestamp validation. | Run in another timezone or send seconds/string. | Strict epoch milliseconds, UTC storage, IST attendance day. |
| 12 | Punch-in | Duplicate check then insert races. | Concurrent same employee/date requests. | Unique `(emp_code,date)` index and duplicate-key 409. |
| 13 | Attendance listing | Loads all matching records and sorts/slices in Python; wrong tie ordering. | Large collection or same-date employees. | Mongo filter, required sort, skip/limit and count. |
| 14 | Attendance listing | No query validation or status allowlist. | Reversed/malformed date range or bad status. | Validate dates/range/status and pagination. |
| 15 | Punch-in / attendance response serialization | Punch-in invented an `id` field and returned a native datetime, while list results invented `id` and left BSON dates for implicit ISO serialization; the contract requires no record identifier and epoch-millisecond instants. | Inspect a successful punch/list response against `AttendanceRecord`. | Convert all instants explicitly to epoch milliseconds and omit MongoDB identifiers and extra `id` fields. |
| 16 | Punch-out lookup | Filtering to `punch_in <= punched_at` before validation returned 404 when an employee had an open punch-in but supplied a punch-out at or before it; the contract requires 422 for that invalid time. | Create one open record, then POST a punch-out earlier than its punch-in. | When no eligible earlier record is found, check for a later presence punch-in and return 422 if one exists; retain 404 when no applicable punch-in exists. |
| 17 | Month parsing | The format regex admitted year `0000`, which Python cannot represent, and the old December calculation advanced into the next year. | Request monthly analytics with `month=0000-01`; exercise `month=9999-12` at the calendar boundary. | Calculate December's last day directly, and return 422 for invalid calendar years while accepting representable `9999-12`. |
| 18 | `/admin/explain/{endpoint}` analytics builders | Monthly, department summary, and leaderboard explain pipelines were duplicated from the route implementations; the monthly explain also omitted its separate working-days aggregation. | Compare the route's aggregations with its explain output in source. | Extracted shared builders used by both the real analytics route and explain handler, and return an additional named explain for monthly working days; attendance-list explain preserves empty-string filters exactly like `/attendance`. |

Reviewed and not defects: keeping employee identity as `emp_code` matches the data model; missing legacy `history` and `half_day` are explicitly permitted and handled with defaults.

