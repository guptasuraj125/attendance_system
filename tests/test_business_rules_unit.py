"""Pure calculation tests for attendance rule boundaries."""
from datetime import date, datetime, time, timedelta, timezone

from app.main import attendance_date, derived, late_minutes, round_half

IST = timezone(timedelta(hours=5, minutes=30))
EMPLOYEE = {"shift_start": "09:00", "shift_end": "18:00"}


def instant(day, hhmm, second=0):
    hour, minute = map(int, hhmm.split(":"))
    return datetime.combine(date.fromisoformat(day), time(hour, minute, second), IST).astimezone(timezone.utc)


def test_late_grace_is_strictly_more_than_ten_minutes():
    assert late_minutes(instant("2026-10-12", "09:10"), "2026-10-12", "09:00") == 0
    assert late_minutes(instant("2026-10-12", "09:10", 1), "2026-10-12", "09:00") == 10
    assert late_minutes(instant("2026-10-12", "09:40", 1), "2026-10-12", "09:00") == 40


def test_overtime_threshold_is_thirty_minutes():
    pin = instant("2026-10-12", "09:00")
    assert derived(pin, instant("2026-10-12", "18:29"), "2026-10-12", EMPLOYEE)["overtime_minutes"] == 0
    assert derived(pin, instant("2026-10-12", "18:30"), "2026-10-12", EMPLOYEE)["overtime_minutes"] == 30


def test_hours_round_half_up_and_half_day_uses_rounded_hours():
    pin = instant("2026-10-12", "09:00")
    half_up = derived(pin, instant("2026-10-12", "10:00", 18), "2026-10-12", EMPLOYEE)
    assert half_up["work_hours"] == 1.01
    assert round_half(1.005) == 1.01
    threshold = derived(pin, instant("2026-10-12", "13:29", 59), "2026-10-12", EMPLOYEE)
    assert threshold["work_hours"] == 4.5 and threshold["half_day"] is False
    below = derived(pin, instant("2026-10-12", "13:29"), "2026-10-12", EMPLOYEE)
    assert below["work_hours"] == 4.48 and below["half_day"] is True


def test_overnight_attendance_date_attributes_early_morning_to_previous_shift():
    early = instant("2026-10-13", "05:59")
    after_shift_end = instant("2026-10-13", "06:00")
    assert attendance_date(early, "22:00", "06:00").isoformat() == "2026-10-12"
    assert attendance_date(after_shift_end, "22:00", "06:00").isoformat() == "2026-10-13"


def test_unclosed_record_has_no_work_or_overtime():
    result = derived(instant("2026-10-12", "09:00"), None, "2026-10-12", EMPLOYEE)
    assert result == {"late_minutes": 0, "work_hours": None, "overtime_minutes": 0, "half_day": False}
