"""Seed or reset the local HROne demo records (EMP1001 through EMP1020).

Usage: python seed_demo.py [--reset]
Reads MONGO_URI and MONGO_DB from the environment or an optional local .env.
This development helper replaces only the reserved demo employee range.
"""
import argparse
from datetime import date, datetime, time, timedelta
import re

from app.main import IST, UTC, client, db, derived


DEPARTMENTS = ("Engineering", "HR", "Finance", "Sales", "Marketing")
ROSTER = (
    ("Aarav Mehta", "Engineering"), ("Isha Kapoor", "HR"),
    ("Kabir Shah", "Finance"), ("Ananya Rao", "Sales"),
    ("Vihaan Patel", "Marketing"), ("Diya Nair", "Engineering"),
    ("Arjun Iyer", "HR"), ("Saanvi Gupta", "Finance"),
    ("Reyansh Singh", "Sales"), ("Aadhya Menon", "Marketing"),
    ("Advait Joshi", "Engineering"), ("Myra Kulkarni", "HR"),
    ("Ishaan Reddy", "Finance"), ("Anvi Desai", "Sales"),
    ("Rohan Verma", "Marketing"), ("Sara Thomas", "Engineering"),
    ("Dev Malhotra", "HR"), ("Nisha Bhat", "Finance"),
    ("Kian Fernandes", "Sales"), ("Tara Sethi", "Marketing"),
)
DEMO_CODES = [f"EMP{number}" for number in range(1001, 1021)]
ZERO_LOG_CODES = {"EMP1001", "EMP1020"}


def local_instant(day: date, clock: str, minutes_after=0) -> datetime:
    parsed = datetime.strptime(clock, "%H:%M").time()
    return (datetime.combine(day, parsed, IST) + timedelta(minutes=minutes_after)).astimezone(UTC)


def employee_documents(now: datetime):
    documents = []
    for index, (name, department) in enumerate(ROSTER):
        shift_start = "09:00" if index % 2 == 0 else "09:30"
        shift_end = "18:00" if index % 2 == 0 else "18:30"
        documents.append({
            "emp_code": DEMO_CODES[index],
            "name": name,
            "email": f"{re.sub(r'[^a-z0-9]+', '.', name.lower()).strip('.')}@example.test",
            "department": department,
            "shift_start": shift_start,
            "shift_end": shift_end,
            "joined_on": date(2022 + (index % 4), 1 + (index % 12), 1 + (index % 26)).isoformat(),
            "created_at": now,
        })
    return documents


def attendance_documents(employees, today: date):
    rows = []
    for index, employee in enumerate(employees):
        code = employee["emp_code"]
        if code in ZERO_LOG_CODES:
            continue
        for offset in range(14):
            day = today - timedelta(days=offset)
            pattern = (index + offset) % 10
            if pattern == 0:
                status, pin, pout = "LEAVE", None, None
            elif pattern == 1:
                status, pin, pout = "ABSENT", None, None
            else:
                status = ("PRESENT", "WFH", "ON_DUTY")[(index + offset) % 3]
                late = (index + offset) % 4 == 0
                half_day = (index + 2 * offset) % 11 == 0
                overtime = not half_day and (index + offset) % 8 == 0
                pin = local_instant(day, employee["shift_start"], 15 if late else 0)
                if half_day:
                    pout = pin + timedelta(hours=4)
                else:
                    pout = local_instant(day, employee["shift_end"], 45 if overtime else -5)
            values = derived(pin, pout, day.isoformat(), employee)
            rows.append({
                "emp_code": code,
                "date": day.isoformat(),
                "status": status,
                "punch_in": pin,
                "punch_out": pout,
                **values,
                "history": [],
            })
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="delete only the EMP1001–EMP1020 demo range")
    args = parser.parse_args()
    selector = {"emp_code": {"$in": DEMO_CODES}}
    removed_logs = db.attendance_logs.delete_many(selector).deleted_count
    removed_employees = db.employees.delete_many(selector).deleted_count
    if args.reset:
        print(f"Removed demo employees={removed_employees}, attendance_records={removed_logs} from {db.name}.")
        client.close()
        return

    now = datetime.now(UTC).replace(microsecond=0)
    today = now.astimezone(IST).date()
    employees = employee_documents(now)
    logs = attendance_documents(employees, today)
    db.employees.insert_many(employees, ordered=True)
    if logs:
        db.attendance_logs.insert_many(logs, ordered=True)
    zero_log_count = len(ZERO_LOG_CODES)
    print(f"Seeded employees={len(employees)}, attendance_records={len(logs)}, zero_log_employees={zero_log_count} in {db.name}.")
    client.close()


if __name__ == "__main__":
    main()
