"""Validate the deterministic demo dataset without changing MongoDB."""
from datetime import date, datetime, timezone

from app.main import UTC, derived
from seed_demo import DEMO_CODES, ZERO_LOG_CODES, attendance_documents, employee_documents


def test_demo_seed_has_twenty_unique_employees_and_two_zero_log_employees():
    employees = employee_documents(datetime(2026, 10, 14, tzinfo=timezone.utc))
    logs = attendance_documents(employees, date(2026, 10, 14))

    assert len(employees) == 20
    assert [employee["emp_code"] for employee in employees] == DEMO_CODES
    assert len({employee["email"] for employee in employees}) == 20
    assert {employee["department"] for employee in employees} == {"Engineering", "HR", "Finance", "Sales", "Marketing"}
    assert len(logs) == 18 * 14
    assert {employee["emp_code"] for employee in employees} - {row["emp_code"] for row in logs} == ZERO_LOG_CODES


def test_demo_seed_status_and_derived_fields_obey_attendance_rules():
    employees = employee_documents(datetime(2026, 10, 14, tzinfo=timezone.utc))
    employee_by_code = {employee["emp_code"]: employee for employee in employees}
    logs = attendance_documents(employees, date(2026, 10, 14))

    assert {row["status"] for row in logs} == {"PRESENT", "WFH", "ON_DUTY", "LEAVE", "ABSENT"}
    assert any(row["half_day"] for row in logs)
    assert any(row["overtime_minutes"] >= 30 for row in logs)
    for row in logs:
        assert row["history"] == []
        assert row["date"] == date.fromisoformat(row["date"]).isoformat()
        assert {key: row[key] for key in ("late_minutes", "work_hours", "overtime_minutes", "half_day")} == derived(
            row["punch_in"], row["punch_out"], row["date"], employee_by_code[row["emp_code"]]
        )
        if row["status"] in {"ABSENT", "LEAVE"}:
            assert row["punch_in"] is row["punch_out"] is None
        else:
            assert row["punch_in"].tzinfo is UTC and row["punch_out"].tzinfo is UTC
