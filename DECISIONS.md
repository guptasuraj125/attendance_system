1. **Indexes.** A unique employee-code index enforces identity and employee-code ordering; `(department,emp_code)` serves filtered employee listing with the required sort. `(department,joined_on,emp_code)` supports eligible department reporting. The unique attendance `(emp_code,date)` index prevents duplicate days and supports employee history. Attendance date/code supports global ordering; employee/date/status supports filtered employee periods; date/late supports monthly late scans. I did not add an email index because email lookup is not part of the contract.

2. **Punch-in race.** Both requests may read the employee, but each inserts the same natural key. MongoDB's unique attendance index permits one insert. The other receives duplicate-key and the API returns 409; only the winner gets 201.

3. **Ties.** `$rank` ranks by total late minutes. The limit filter is applied to the rank, so all employees tied at a rank equal to the cutoff are returned; rows are then ordered by code.

4. **Headcount.** Department summary starts from eligible employees, then looks up that month's logs. Employees with no matching logs remain due to preserved unwind and are included in the distinct employee count.

5. **100x data.** I would benchmark real workload plans, then consider keyset pagination and incrementally maintained monthly summaries to reduce deep skips and repeated analytics scans.
