"""Seed and benchmark a temporary local MongoDB dataset, then remove it."""
import os
import sys
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from pymongo import MongoClient


def main():
    uri = "mongodb://localhost:27017"
    database = f"attendance_perf_{uuid.uuid4().hex}"
    os.environ["MONGO_URI"] = uri
    os.environ["MONGO_DB"] = database
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from fastapi.testclient import TestClient
    from app.main import app, db

    base = date(2026, 1, 1)
    employees = [{"emp_code": f"EMP{i:06d}", "name": f"Employee {i}", "email": f"employee{i}@example.com",
                  "department": "Engineering" if i % 2 else "HR", "shift_start": "09:00", "shift_end": "18:00",
                  "joined_on": "2025-01-01"} for i in range(1000)]
    tz = timezone.utc
    logs = []
    for index, employee in enumerate(employees):
        for offset in range(100):
            day = base + timedelta(days=offset)
            pin = datetime.combine(day, datetime.min.time(), tz) + timedelta(hours=4)
            logs.append({"emp_code": employee["emp_code"], "date": day.isoformat(),
                         "status": ("PRESENT", "WFH", "ON_DUTY", "ABSENT")[offset % 4],
                         "punch_in": pin if offset % 4 != 3 else None,
                         "punch_out": pin + timedelta(hours=8) if offset % 4 != 3 else None,
                         "work_hours": 8.0 if offset % 4 != 3 else None,
                         "late_minutes": (index + offset) % 46 if offset % 5 == 0 else 0,
                         "overtime_minutes": 0, "half_day": offset % 17 == 0, "history": []})
    mongo = MongoClient(uri, serverSelectionTimeoutMS=3000)
    try:
        with TestClient(app) as api:
            db.employees.insert_many(employees, ordered=False)
            for start in range(0, len(logs), 5000):
                db.attendance_logs.insert_many(logs[start:start + 5000], ordered=False)
            print(f"Seeded employees={db.employees.count_documents({})} attendance={db.attendance_logs.count_documents({})}")
            cases = [
                ("attendance_list", "/attendance", {"date_from": "2026-03-01", "date_to": "2026-03-31", "page_size": 50}),
                ("employee_monthly", "/analytics/employees/EMP000001/monthly", {"month": "2026-04"}),
                ("department_summary", "/analytics/departments/summary", {"month": "2026-04"}),
                ("late_leaderboard", "/analytics/leaderboard/late", {"month": "2026-04", "limit": 10}),
                ("department_trend", "/analytics/departments/Engineering/trend", {"from": "2026-02-01", "to": "2026-04-30"}),
            ]
            for name, path, params in cases:
                started = time.perf_counter()
                response = api.get(path, params=params)
                elapsed = (time.perf_counter() - started) * 1000
                assert response.status_code == 200, f"{name}: {response.status_code}: {response.text}"
                print(f"{name}: {elapsed:.1f} ms")
            explain_cases = [
                ("attendance_list", {"date_from": "2026-03-01", "date_to": "2026-03-31", "page_size": 50}),
                ("employee_monthly", {"emp_code": "EMP000001", "month": "2026-04"}),
                ("department_summary", {"month": "2026-04"}),
                ("late_leaderboard", {"month": "2026-04"}),
                ("department_trend", {"department": "Engineering", "from": "2026-02-01", "to": "2026-04-30"}),
            ]
            for name, params in explain_cases:
                response = api.get(f"/admin/explain/{name}", params=params)
                assert response.status_code == 200, f"{name} explain: {response.status_code}: {response.text}"
                explain = response.json()["explain"]
                plan = str(explain)
                assert "IXSCAN" in plan and "COLLSCAN" not in plan, f"Unexpected plan for {name}"
                stats = []
                def collect(node):
                    if isinstance(node, dict):
                        if isinstance(node.get("executionStats"), dict):
                            stats.append(node["executionStats"])
                        for value in node.values():
                            collect(value)
                    elif isinstance(node, list):
                        for value in node:
                            collect(value)
                collect(explain)
                assert stats, f"{name} explain did not include executionStats"
                details = stats[0]
                print(f"{name} explain: IXSCAN, no COLLSCAN; nReturned={details.get('nReturned', 'n/a')}, "
                      f"keysExamined={details.get('totalKeysExamined', 'n/a')}, "
                      f"docsExamined={details.get('totalDocsExamined', 'n/a')}")
                if name == "attendance_list":
                    stages = []
                    def collect_stages(node):
                        if isinstance(node, dict):
                            if isinstance(node.get("stage"), str):
                                stages.append(node["stage"])
                            for value in node.values():
                                collect_stages(value)
                        elif isinstance(node, list):
                            for value in node:
                                collect_stages(value)
                    collect_stages(explain.get("queryPlanner", {}).get("winningPlan", {}))
                    assert "SORT" not in stages, f"attendance_list used a blocking sort: {stages}"
                    print("attendance_list winning plan: no blocking SORT stage")
    finally:
        mongo.drop_database(database)
        mongo.close()
        print(f"Removed temporary database: {database}")


if __name__ == "__main__":
    main()
