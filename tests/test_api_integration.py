"""End-to-end API checks; run with ``python tests/run_qa.py`` against local MongoDB."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone
from threading import Barrier

import pytest
from fastapi.testclient import TestClient

from app.main import app

IST = timezone(timedelta(hours=5, minutes=30))
MONTH = "2026-10"


@pytest.fixture(scope="module")
def api():
    with TestClient(app) as test_client:
        yield test_client


def epoch(day: str, hhmm: str) -> int:
    hour, minute = map(int, hhmm.split(":"))
    return int(datetime.combine(date.fromisoformat(day), time(hour, minute), IST).timestamp() * 1000)


def employee(code, name, department="Engineering", joined="2026-10-01", start="09:00", end="18:00"):
    return {"emp_code": code, "name": name, "email": f"{code.lower()}@example.com", "department": department,
            "shift_start": start, "shift_end": end, "joined_on": joined}


def create(api, **kwargs):
    body = employee(**kwargs)
    response = api.post("/employees", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def test_01_health_and_employee_contract(api):
    assert api.get("/health").json() == {"status": "ok"}
    create(api, code="EMP1001", name="Rahul Sharma")
    create(api, code="EMP1002", name="Priya Mehta")
    create(api, code="EMP1003", name="Amit Patel", department="HR", start="10:00", end="19:00")
    create(api, code="EMP1004", name="Neha Shah", department="HR", start="10:00", end="19:00")
    create(api, code="EMP1005", name="Test Future Employee", joined="2026-11-01")
    create(api, code="EMP1006", name="No Attendance Employee", department="HR", start="10:00", end="19:00")
    assert api.post("/employees", json=employee("EMP1001", "Duplicate")).status_code == 409
    for payload in [
        {**employee("EMP1006", "Invalid"), "shift_start": "25:00"},
        {**employee("EMP1006", "Invalid"), "shift_end": "09:00"},
        {**employee("EMP1006", "Invalid"), "email": "invalid"},
        {**employee("EMP1006", "Invalid"), "extra": "rejected"},
        {**employee("EMP1006", "Invalid"), "joined_on": "2026-02-30"},
    ]:
        assert api.post("/employees", json=payload).status_code == 422
    assert api.get("/employees", params={"department": "HR", "page_size": 1}).json() == {
        "items": [api.get("/employees", params={"department": "HR"}).json()["items"][0]],
        "total": 3, "page": 1, "page_size": 1}
    page1 = api.get("/employees", params={"page_size": 2}).json()
    page2 = api.get("/employees", params={"page": 2, "page_size": 2}).json()
    assert [x["emp_code"] for x in page1["items"] + page2["items"]] == [f"EMP100{i}" for i in range(1, 5)]
    for params in ({"page": 0}, {"page_size": 101}, {"page_size": -1}):
        assert api.get("/employees", params=params).status_code == 422


def test_02_attendance_rules_corrections_and_filters(api):
    # Employee setup is established in the first test; tests are run in declaration order.
    for code in ("EMP1001", "EMP1002", "EMP1003", "EMP1004", "EMP1005"):
        assert api.get("/employees", params={"department": "Engineering" if code != "EMP1003" else "HR"}).status_code == 200

    # Late punch: 09:40:01 is strictly beyond the 10-minute grace period after 09:00.
    r = api.post("/attendance/punch-in", json={"emp_code": "EMP1001", "punched_at": epoch("2026-10-05", "09:40") + 1000})
    assert r.status_code == 201 and r.json()["late_minutes"] == 40
    assert api.post("/attendance/punch-in", json={"emp_code": "EMP1001", "punched_at": epoch("2026-10-05", "10:00")}).status_code == 409
    # Full day, 60 minutes overtime; also tests output truncation to whole seconds.
    out = api.post("/attendance/punch-out", json={"emp_code": "EMP1001", "punched_at": epoch("2026-10-05", "19:00") + 900})
    assert out.status_code == 200
    row = out.json()
    assert row["work_hours"] == 9.33 and row["overtime_minutes"] == 60 and not row["half_day"]
    assert row["punch_out"] % 1000 == 0
    assert api.post("/attendance/punch-out", json={"emp_code": "EMP1001", "punched_at": epoch("2026-10-05", "19:10")}).status_code == 409

    # Normal on-time WFH and half-day duration.
    assert api.post("/attendance/punch-in", json={"emp_code": "EMP1002", "punched_at": epoch("2026-10-06", "09:10"), "status": "WFH"}).json()["late_minutes"] == 0
    short = api.post("/attendance/punch-out", json={"emp_code": "EMP1002", "punched_at": epoch("2026-10-06", "13:40")}).json()
    assert short["work_hours"] == 4.5 and short["half_day"] is False
    assert api.post("/attendance/punch-in", json={"emp_code": "EMP1002", "punched_at": epoch("2026-10-09", "09:20")}).status_code == 201
    assert api.post("/attendance/punch-out", json={"emp_code": "EMP1002", "punched_at": epoch("2026-10-09", "18:00")}).status_code == 200
    assert api.post("/attendance/punch-in", json={"emp_code": "EMP1003", "punched_at": epoch("2026-10-07", "10:20"), "status": "ON_DUTY"}).status_code == 201
    assert api.post("/attendance/punch-out", json={"emp_code": "EMP1003", "punched_at": epoch("2026-10-07", "13:00")}).json()["half_day"] is True
    assert api.post("/attendance/punch-in", json={"emp_code": "EMP1004", "punched_at": epoch("2026-10-08", "10:30")}).json()["late_minutes"] == 30
    assert api.post("/attendance/punch-out", json={"emp_code": "EMP1004", "punched_at": epoch("2026-10-08", "19:00")}).status_code == 200

    for path, body in [
        ("/attendance/punch-in", {"emp_code": "EMP9999", "punched_at": epoch("2026-10-08", "09:00")}),
        ("/attendance/punch-out", {"emp_code": "EMP9999", "punched_at": epoch("2026-10-08", "10:00")}),
    ]:
        assert api.post(path, json=body).status_code == 404
    assert api.post("/attendance/punch-in", json={"emp_code": "EMP1004", "punched_at": 123, "extra": 1}).status_code == 422
    assert api.post("/attendance/punch-out", json={"emp_code": "EMP1004", "punched_at": epoch("2026-10-08", "09:00")}).status_code == 422
    assert api.post("/attendance/punch-out", json={"emp_code": "EMP1001", "punched_at": epoch("2026-10-05", "09:30")}).status_code in (404, 422)

    # Two sequential regularizations append both audit records and recompute derived values.
    date_key = "2026-10-05"
    patch1 = api.patch(f"/attendance/EMP1001/{date_key}", json={"punch_in": epoch(date_key, "09:00"), "reason": "Correct late entry", "regularized_by": "qa-admin"})
    assert patch1.status_code == 200 and patch1.json()["late_minutes"] == 0
    patch2 = api.patch(f"/attendance/EMP1001/{date_key}", json={"status": "WFH", "reason": "Correct work mode", "regularized_by": "qa-admin"})
    assert patch2.status_code == 200 and len(patch2.json()["history"]) == 2
    assert set(patch2.json()["history"][0]["changes"]) == {"punch_in", "late_minutes", "work_hours"}
    assert api.patch(f"/attendance/EMP1001/{date_key}", json={"status": "WFH", "reason": "No change", "regularized_by": "qa-admin"}).status_code == 422
    assert api.patch(f"/attendance/EMP1001/{date_key}", json={"status": "LEAVE", "punch_in": epoch(date_key, "09:00"), "reason": "Invalid leave", "regularized_by": "qa-admin"}).status_code == 422
    leave = api.patch(f"/attendance/EMP1001/{date_key}", json={"status": "LEAVE", "reason": "Approved leave", "regularized_by": "qa-admin"})
    assert leave.status_code == 200 and leave.json()["status"] == "LEAVE" and leave.json()["punch_in"] is None and len(leave.json()["history"]) == 3
    assert api.post("/attendance/punch-in", json={"emp_code": "EMP1001", "punched_at": epoch("2026-10-09", "09:10") + 1000}).status_code == 201
    assert api.post("/attendance/punch-out", json={"emp_code": "EMP1001", "punched_at": epoch("2026-10-09", "18:00")}).status_code == 200
    corrected = api.get("/attendance", params={"emp_code": "EMP1001", "date_from": date_key, "date_to": date_key}).json()["items"][0]
    assert corrected["status"] == "LEAVE" and corrected["late_minutes"] == 0

    params = {"date_from": "2026-10-05", "date_to": "2026-10-07", "page_size": 2}
    page = api.get("/attendance", params=params).json()
    assert page["total"] == 3 and len(page["items"]) == 2
    assert [(x["date"], x["emp_code"]) for x in page["items"]] == [("2026-10-07", "EMP1003"), ("2026-10-06", "EMP1002")]
    assert api.get("/attendance", params={**params, "status": "ON_DUTY"}).json()["total"] == 1
    assert api.get("/attendance", params={**params, "emp_code": "EMP1002"}).json()["total"] == 1
    assert api.get("/attendance", params={"date_from": "2026-10-10", "date_to": "2026-10-01"}).status_code == 422
    assert api.get("/attendance", params={"date_from": "yesterday"}).status_code == 422


def test_03_analytics_values_and_explain_endpoints(api):
    monthly = api.get("/analytics/employees/EMP1002/monthly", params={"month": MONTH}).json()
    assert monthly == {"emp_code": "EMP1002", "month": MONTH, "working_days": 22, "present_days": 2,
                       "leave_days": 0, "late_count": 1, "total_late_minutes": 20,
                       "total_overtime_minutes": 0, "attendance_pct": 9.09}
    half_month = api.get("/analytics/employees/EMP1003/monthly", params={"month": MONTH}).json()
    assert half_month["present_days"] == 0.5 and half_month["attendance_pct"] == 2.27 and half_month["late_count"] == 1
    summary = api.get("/analytics/departments/summary", params={"month": MONTH}).json()["items"]
    assert [x["department"] for x in summary] == ["Engineering", "HR"]
    eng = summary[0]
    assert eng["headcount"] == 2 and eng["present_days"] == 3 and eng["avg_work_hours"] == 7.33, eng
    assert summary[1]["headcount"] == 3  # the zero-log employee counts; future joiner does not
    assert api.get("/analytics/departments/summary", params={"month": MONTH, "department": "HR"}).json()["items"][0]["department"] == "HR"
    board = api.get("/analytics/leaderboard/late", params={"month": MONTH}).json()["items"]
    assert [(x["emp_code"], x["total_late_minutes"], x["rank"]) for x in board] == [
        ("EMP1004", 30, 1), ("EMP1002", 20, 2), ("EMP1003", 20, 2), ("EMP1001", 10, 4)]
    limited = api.get("/analytics/leaderboard/late", params={"month": MONTH, "limit": 2}).json()["items"]
    assert len(limited) == 3  # The rank cutoff preserves both employees tied at rank 2.
    assert len(api.get("/analytics/leaderboard/late", params={"month": MONTH, "department": "Engineering"}).json()["items"]) == 2
    trend = api.get("/analytics/departments/Engineering/trend", params={"from": "2026-10-05", "to": "2026-10-10"}).json()["items"]
    assert [x["date"] for x in trend] == [f"2026-10-{d:02}" for d in range(5, 11)]
    assert trend[0]["headcount"] == 2 and trend[0]["attendance_rate"] == 0.0
    assert trend[1]["attendance_rate"] == 0.5 and trend[1]["moving_avg_7d"] == 0.25
    assert trend[4]["attendance_rate"] == 1.0 and trend[4]["moving_avg_7d"] == 0.3
    assert trend[-1]["is_working_day"] is False and trend[-1]["attendance_rate"] is None
    truncated = api.get("/analytics/departments/Engineering/trend", params={"from": "2026-10-06", "to": "2026-10-10"}).json()["items"]
    assert truncated[0]["moving_avg_7d"] == truncated[0]["attendance_rate"] == 0.5
    hr_trend = api.get("/analytics/departments/HR/trend", params={"from": "2026-10-07", "to": "2026-10-07"}).json()["items"][0]
    assert hr_trend["headcount"] == 3 and hr_trend["present_count"] == 0.5 and hr_trend["attendance_rate"] == 0.1667
    assert api.get("/analytics/departments/Engineering/trend", params={"from": "2026-10-10", "to": "2026-10-01"}).status_code == 422
    assert api.get("/analytics/departments/Engineering/trend", params={"from": "2026-01-01", "to": "2026-04-03"}).status_code == 422

    explain_cases = [
        ("attendance_list", {"date_from": "2026-10-05", "date_to": "2026-10-07"}),
        ("employee_monthly", {"emp_code": "EMP1002", "month": MONTH}),
        ("department_summary", {"month": MONTH}),
        ("late_leaderboard", {"month": MONTH}),
        ("department_trend", {"department": "Engineering", "from": "2026-10-05", "to": "2026-10-10"}),
    ]
    for endpoint, params in explain_cases:
        response = api.get(f"/admin/explain/{endpoint}", params=params)
        assert response.status_code == 200, response.text
        plan = response.json()["explain"]
        serialized = str(plan)
        assert "executionStats" in serialized
        assert "IXSCAN" in serialized, f"{endpoint} plan did not contain IXSCAN"
        assert "COLLSCAN" not in serialized, f"{endpoint} plan contained COLLSCAN"
        if endpoint == "employee_monthly":
            workday_plan = response.json()["related_explains"]["working_days"]
            assert "IXSCAN" in str(workday_plan) and "COLLSCAN" not in str(workday_plan)
    assert api.get("/admin/explain/employee_monthly").status_code == 422
    for endpoint in ("department_summary", "late_leaderboard"):
        assert api.get(f"/admin/explain/{endpoint}").status_code == 422
    assert api.get("/admin/explain/department_trend", params={"department": "Engineering"}).status_code == 422
    assert api.get("/admin/explain/employee_monthly", params={"emp_code": "EMP1002", "month": "2026-99"}).status_code == 422
    assert api.get("/admin/explain/attendance_list", params={"page_size": 101}).status_code == 422


def test_04_overnight_and_24_hour_boundaries(api):
    create(api, code="EMP3001", name="Overnight Worker", department="Night Shift", start="22:00", end="06:00")
    pin = api.post("/attendance/punch-in", json={"emp_code": "EMP3001", "punched_at": epoch("2026-10-12", "23:00")})
    assert pin.status_code == 201 and pin.json()["date"] == "2026-10-12"
    out = api.post("/attendance/punch-out", json={"emp_code": "EMP3001", "punched_at": epoch("2026-10-13", "06:00")})
    assert out.status_code == 200 and out.json()["work_hours"] == 7.0
    # An early morning punch before overnight shift end belongs to the preceding shift date.
    assert api.post("/attendance/punch-in", json={"emp_code": "EMP3001", "punched_at": epoch("2026-10-13", "05:30")}).status_code == 409
    create(api, code="EMP3003", name="Future Department Employee", department="Future Ops", joined="2026-11-01")
    future_trend = api.get("/analytics/departments/Future%20Ops/trend", params={"from": "2026-10-12", "to": "2026-10-13"}).json()["items"]
    assert [row["headcount"] for row in future_trend] == [0, 0]
    assert [row["attendance_rate"] for row in future_trend] == [None, None]
    assert [row["moving_avg_7d"] for row in future_trend] == [None, None]

    create(api, code="EMP3002", name="24 Hour Bound", department="Boundary QA")
    start = epoch("2026-10-12", "09:00")
    assert api.post("/attendance/punch-in", json={"emp_code": "EMP3002", "punched_at": start}).status_code == 201
    assert api.post("/attendance/punch-out", json={"emp_code": "EMP3002", "punched_at": start + 24 * 60 * 60 * 1000 + 1000}).status_code == 422


def test_05_concurrent_creation_punch_and_corrections(api):
    # New code isolates each race from earlier tests.
    payload = employee("EMP2001", "Concurrent", joined="2026-10-01")
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: api.post("/employees", json=payload).status_code, range(8)))
    assert results.count(201) == 1 and results.count(409) == 7

    pin = epoch("2026-10-12", "09:00")
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: api.post("/attendance/punch-in", json={"emp_code": "EMP2001", "punched_at": pin}).status_code, range(8)))
    assert results.count(201) == 1 and results.count(409) == 7
    pout = epoch("2026-10-12", "18:00")
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: api.post("/attendance/punch-out", json={"emp_code": "EMP2001", "punched_at": pout}).status_code, range(8)))
    assert results.count(200) == 1 and results.count(409) == 7

    correction_barrier = Barrier(2)
    def correction(arg):
        by, status = arg
        correction_barrier.wait()
        return api.patch("/attendance/EMP2001/2026-10-12", json={"status": status, "reason": f"Correction {by}", "regularized_by": by}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(correction, [("admin-a", "WFH"), ("admin-b", "ON_DUTY")]))
    assert sorted(results) in ([200, 409], [200, 200])
    row = api.get("/attendance", params={"emp_code": "EMP2001"}).json()["items"][0]
    assert len(row["history"]) == results.count(200)


def test_06_negative_requests_do_not_leak_internals(api):
    invalid = [
        api.post("/attendance/punch-in", json={"emp_code": "EMP1004", "punched_at": 1.5}),
        api.post("/attendance/punch-in", json={"emp_code": "EMP1004", "punched_at": "1780000000000"}),
        api.post("/attendance/punch-in", json={"emp_code": "EMP1004", "status": "ABSENT"}),
        api.get("/analytics/employees/EMP1002/monthly", params={"month": "2026-13"}),
        api.get("/analytics/leaderboard/late", params={"month": MONTH, "limit": 0}),
    ]
    for response in invalid:
        assert 400 <= response.status_code < 500, response.text
        body = response.text.lower()
        assert "traceback" not in body and "mongodb://" not in body and "c:\\users\\" not in body


def test_07_remove_employee_retains_attendance_and_audit(api):
    before = api.get("/attendance", params={"emp_code": "EMP1001", "page_size": 100}).json()
    assert before["total"] > 0
    removed = api.delete("/employees/EMP1001")
    assert removed.status_code == 200, removed.text
    result = removed.json()
    assert result["emp_code"] == "EMP1001" and result["removed"] is True and isinstance(result["removed_at"], int)
    listed = api.get("/employees", params={"page_size": 100}).json()
    assert "EMP1001" not in {item["emp_code"] for item in listed["items"]}
    after = api.get("/attendance", params={"emp_code": "EMP1001", "page_size": 100}).json()
    assert after["total"] == before["total"]
    assert api.post("/attendance/punch-in", json={"emp_code": "EMP1001"}).status_code == 409
    assert api.delete("/employees/EMP1001").status_code == 409
    assert api.delete("/employees/EMP9999").status_code == 404
