"""FastAPI service for employee attendance and analytics (MongoDB 6+)."""
import os
import re
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator
from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.errors import DuplicateKeyError, PyMongoError

load_dotenv()
IST = timezone(timedelta(hours=5, minutes=30))
UTC = timezone.utc
client = MongoClient(os.getenv("MONGO_URI", "mongodb://localhost:27017"), tz_aware=True, tzinfo=UTC, serverSelectionTimeoutMS=3000)
db = client[os.getenv("MONGO_DB", "attendance_db")]
app = FastAPI(title="Employee Attendance & Analytics API", version="2.0.0")


@app.on_event("startup")
def create_indexes():
    db.employees.create_index([("emp_code", ASCENDING)], unique=True, name="uq_employee_code")
    db.employees.create_index([("department", ASCENDING), ("emp_code", ASCENDING)], name="department_employee_code")
    db.employees.create_index([("department", ASCENDING), ("joined_on", ASCENDING), ("emp_code", ASCENDING)], name="department_joined_code")
    db.employees.create_index([("joined_on", ASCENDING)], name="employee_joined_date")
    db.employees.create_index([("email_key", ASCENDING)], unique=True, partialFilterExpression={"email_key": {"$type": "string"}}, name="uq_employee_email_key")
    db.employee_removals.create_index([("emp_code", ASCENDING)], unique=True, name="uq_removed_employee_code")
    db.attendance_logs.create_index([("emp_code", ASCENDING), ("date", ASCENDING)], unique=True, name="uq_attendance_employee_date")
    db.attendance_logs.create_index([("date", DESCENDING), ("emp_code", ASCENDING)], name="attendance_date_code")
    db.attendance_logs.create_index([("emp_code", ASCENDING), ("date", ASCENDING), ("status", ASCENDING)], name="attendance_employee_date_status")
    db.attendance_logs.create_index([("date", ASCENDING), ("late_minutes", ASCENDING)], name="attendance_date_late")


@app.exception_handler(RequestValidationError)
async def validation_error(_, exc):
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors())})


def fail(status: int, detail: str):
    raise HTTPException(status, detail)


def parsed_date(value: str) -> date:
    try:
        d = date.fromisoformat(value)
        if d.isoformat() != value:
            raise ValueError
        return d
    except (ValueError, TypeError):
        fail(422, "date must be YYYY-MM-DD")


def parse_month(value: str) -> tuple[date, date]:
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", value):
        fail(422, "month must be YYYY-MM")
    try:
        y, m = map(int, value.split("-"))
        first = date(y, m, 1)
        last = date(y, 12, 31) if m == 12 else date(y, m + 1, 1) - timedelta(days=1)
        return first, last
    except ValueError:
        fail(422, "month is outside the supported calendar range")


def strict_epoch(value: int | None) -> datetime:
    if type(value) is not int or not 100_000_000_000 <= value <= 4_102_444_800_000:
        fail(422, "timestamp must be epoch milliseconds in the supported range")
    return datetime.fromtimestamp(value / 1000, UTC).replace(microsecond=0)


def epoch(value: datetime | None):
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return int(value.timestamp() * 1000)


def attendance_date(ts: datetime, shift_start: str, shift_end: str) -> date:
    local = ts.astimezone(IST)
    d = local.date()
    if shift_end <= shift_start and local.strftime("%H:%M") < shift_end:
        d -= timedelta(days=1)
    return d


def shift_end_instant(day: str, shift_start: str, shift_end: str) -> datetime:
    d = parsed_date(day)
    h, m = map(int, shift_end.split(":"))
    end_day = d + timedelta(days=1) if shift_end <= shift_start else d
    return datetime.combine(end_day, time(h, m), IST).astimezone(UTC)


def late_minutes(ts: datetime, day: str, shift_start: str) -> int:
    d = parsed_date(day)
    h, m = map(int, shift_start.split(":"))
    start = datetime.combine(d, time(h, m), IST).astimezone(UTC)
    elapsed = int((ts - start).total_seconds())
    return elapsed // 60 if elapsed > 600 else 0


def derived(pin, pout, day, employee):
    if pin is None:
        return {"late_minutes": 0, "work_hours": None, "overtime_minutes": 0, "half_day": False}
    late = late_minutes(pin, day, employee["shift_start"])
    if pout is None:
        return {"late_minutes": late, "work_hours": None, "overtime_minutes": 0, "half_day": False}
    seconds = int((pout - pin).total_seconds())
    hours = float((Decimal(seconds) / Decimal(3600)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    overtime = int((pout - shift_end_instant(day, employee["shift_start"], employee["shift_end"])).total_seconds()) // 60
    overtime = max(0, overtime) if overtime >= 30 else 0
    return {"late_minutes": late, "work_hours": hours, "overtime_minutes": overtime, "half_day": hours < 4.5}


def record_out(doc):
    doc = dict(doc)
    doc.pop("_id", None)
    doc["punch_in"] = epoch(doc.get("punch_in"))
    doc["punch_out"] = epoch(doc.get("punch_out"))
    doc["late_minutes"] = doc.get("late_minutes", 0)
    doc["overtime_minutes"] = doc.get("overtime_minutes", 0)
    doc["half_day"] = doc.get("half_day", False)
    doc["history"] = [{**h, "at": epoch(h.get("at")), "changes": {k: {x: epoch(v) if k in ("punch_in", "punch_out") else v for x, v in change.items()} for k, change in h.get("changes", {}).items()}} for h in doc.get("history", [])]
    return doc


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EmployeeIn(StrictModel):
    emp_code: str = Field(pattern=r"^EMP\d{4,6}$")
    name: str = Field(min_length=1, max_length=100)
    email: str = Field(max_length=120, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    department: str = Field(min_length=1, max_length=50)
    shift_start: str = Field(default="09:30", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    shift_end: str = Field(default="18:30", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    joined_on: str

    @field_validator("joined_on")
    @classmethod
    def valid_joined(cls, v):
        parsed_date(v); return v

    @model_validator(mode="after")
    def shifts_differ(self):
        if self.shift_start == self.shift_end: raise ValueError("shift_start must differ from shift_end")
        return self


class PunchInIn(StrictModel):
    emp_code: str
    punched_at: StrictInt | None = None
    status: Literal["PRESENT", "WFH", "ON_DUTY"] = "PRESENT"

    @model_validator(mode="after")
    def timestamp_if_supplied(self):
        if "punched_at" in self.model_fields_set and self.punched_at is None:
            raise ValueError("punched_at must be an epoch-millisecond integer when supplied")
        return self


class PunchOutIn(StrictModel):
    emp_code: str
    punched_at: StrictInt | None = None

    @model_validator(mode="after")
    def timestamp_if_supplied(self):
        if "punched_at" in self.model_fields_set and self.punched_at is None:
            raise ValueError("punched_at must be an epoch-millisecond integer when supplied")
        return self


class RegularizeIn(StrictModel):
    status: Literal["PRESENT", "ABSENT", "LEAVE", "WFH", "ON_DUTY"] | None = None
    punch_in: StrictInt | None = None
    punch_out: StrictInt | None = None
    reason: str = Field(min_length=5, max_length=200)
    regularized_by: str = Field(min_length=1, max_length=50)

    @field_validator("punch_in", "punch_out")
    @classmethod
    def valid_punch(cls, v):
        if v is not None: strict_epoch(v)
        return v

    @model_validator(mode="after")
    def punch_fields_are_instants(self):
        if "status" in self.model_fields_set and self.status is None:
            raise ValueError("status must be one of the supported values")
        for field in ("punch_in", "punch_out"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} must be an epoch-millisecond integer")
        return self


@app.get("/health")
def health():
    try:
        client.admin.command("ping")
        return {"status": "ok"}
    except PyMongoError:
        fail(503, "database unavailable")


@app.post("/employees", status_code=201)
def create_employee(body: EmployeeIn):
    doc = body.model_dump()
    email_key = body.email.casefold()
    legacy_email = {"$regex": f"^{re.escape(body.email)}$", "$options": "i"}
    if db.employees.find_one({"$or": [{"email_key": email_key}, {"email": legacy_email}]}, {"_id": 1}):
        fail(409, "email already belongs to an employee")
    doc["email_key"] = email_key
    doc["created_at"] = datetime.now(UTC)
    try:
        db.employees.insert_one(doc)
    except DuplicateKeyError:
        fail(409, "emp_code or email already belongs to an employee")
    doc.pop("_id", None)
    doc.pop("email_key", None)
    doc["created_at"] = epoch(doc["created_at"])
    return doc


@app.get("/employees")
def list_employees(department: str | None = None, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
    removed_codes = db.employee_removals.distinct("emp_code")
    q = {"emp_code": {"$nin": removed_codes}}
    if department is not None: q["department"] = department
    items = list(db.employees.find(q, {"_id": 0, "email_key": 0}).sort("emp_code", ASCENDING).skip((page-1)*page_size).limit(page_size))
    for x in items: x["created_at"] = epoch(x.get("created_at"))
    return {"items": items, "total": db.employees.count_documents(q), "page": page, "page_size": page_size}


@app.delete("/employees/{emp_code}")
def remove_employee(emp_code: str):
    if not db.employees.find_one({"emp_code": emp_code}, {"_id": 1}): fail(404, "employee not found")
    removed_at = datetime.now(UTC)
    try:
        db.employee_removals.insert_one({"emp_code": emp_code, "removed_at": removed_at})
    except DuplicateKeyError:
        fail(409, "employee already removed")
    return {"emp_code": emp_code, "removed": True, "removed_at": epoch(removed_at)}


@app.post("/attendance/punch-in", status_code=201)
def punch_in(body: PunchInIn):
    emp = db.employees.find_one({"emp_code": body.emp_code})
    if not emp: fail(404, "employee not found")
    if db.employee_removals.find_one({"emp_code": body.emp_code}, {"_id": 1}): fail(409, "employee has been removed")
    ts = strict_epoch(body.punched_at) if body.punched_at is not None else datetime.now(UTC).replace(microsecond=0)
    day = attendance_date(ts, emp["shift_start"], emp["shift_end"]).isoformat()
    d = derived(ts, None, day, emp)
    doc = {"emp_code": body.emp_code, "date": day, "status": body.status, "punch_in": ts, "punch_out": None, **d, "history": []}
    try: db.attendance_logs.insert_one(doc)
    except DuplicateKeyError: fail(409, "already punched in for this date")
    return record_out(doc)


@app.post("/attendance/punch-out")
def punch_out(body: PunchOutIn):
    emp = db.employees.find_one({"emp_code": body.emp_code})
    if not emp: fail(404, "employee not found")
    ts = strict_epoch(body.punched_at) if body.punched_at is not None else datetime.now(UTC).replace(microsecond=0)
    doc = db.attendance_logs.find_one({"emp_code": body.emp_code, "punch_in": {"$lte": ts}, "status": {"$in": ["PRESENT", "WFH", "ON_DUTY"]}}, sort=[("punch_in", DESCENDING)])
    if not doc:
        future_punch = db.attendance_logs.find_one({"emp_code": body.emp_code, "punch_in": {"$gt": ts}, "status": {"$in": ["PRESENT", "WFH", "ON_DUTY"]}})
        if future_punch: fail(422, "punch_out must be after punch_in")
        fail(404, "no eligible punch-in found")
    if doc.get("punch_out") is not None: fail(409, "record already punched out")
    if ts <= doc["punch_in"] or ts - doc["punch_in"] > timedelta(hours=24): fail(422, "punch_out must be after punch_in and within 24 hours")
    fields = derived(doc["punch_in"], ts, doc["date"], emp)
    changed = db.attendance_logs.update_one({"emp_code": body.emp_code, "date": doc["date"], "punch_out": None, "punch_in": doc["punch_in"]}, {"$set": {"punch_out": ts, **fields}})
    if not changed.modified_count: fail(409, "record already punched out")
    return record_out(db.attendance_logs.find_one({"emp_code": body.emp_code, "date": doc["date"]}))


@app.get("/attendance")
def list_attendance(emp_code: str | None = None, date_from: str | None = None, date_to: str | None = None, status: Literal["PRESENT", "ABSENT", "LEAVE", "WFH", "ON_DUTY"] | None = None, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
    q = {}
    if emp_code is not None: q["emp_code"] = emp_code
    if status is not None: q["status"] = status
    if date_from or date_to:
        bounds = {}
        if date_from: bounds["$gte"] = parsed_date(date_from).isoformat()
        if date_to: bounds["$lte"] = parsed_date(date_to).isoformat()
        if date_from and date_to and date_from > date_to: fail(422, "date_from must not be after date_to")
        q["date"] = bounds
    items = [record_out(x) for x in db.attendance_logs.find(q).sort([("date", DESCENDING), ("emp_code", ASCENDING)]).skip((page-1)*page_size).limit(page_size)]
    return {"items": items, "total": db.attendance_logs.count_documents(q), "page": page, "page_size": page_size}


@app.patch("/attendance/{emp_code}/{date}")
def regularize(emp_code: str, date: str, body: RegularizeIn):
    d = parsed_date(date).isoformat()
    emp = db.employees.find_one({"emp_code": emp_code})
    doc = db.attendance_logs.find_one({"emp_code": emp_code, "date": d})
    if not emp or not doc: fail(404, "employee or attendance record not found")
    pin, pout, status = doc.get("punch_in"), doc.get("punch_out"), doc["status"]
    supplied = body.model_fields_set
    if "status" in supplied: status = body.status
    if "punch_in" in supplied: pin = strict_epoch(body.punch_in) if body.punch_in is not None else None
    if "punch_out" in supplied: pout = strict_epoch(body.punch_out) if body.punch_out is not None else None
    if status in ("ABSENT", "LEAVE"):
        if ("punch_in" in supplied and body.punch_in is not None) or ("punch_out" in supplied and body.punch_out is not None): fail(422, "ABSENT and LEAVE cannot have punch times")
        pin = pout = None
    elif pin is None: fail(422, "presence status requires punch_in")
    if pin is not None and attendance_date(pin, emp["shift_start"], emp["shift_end"]).isoformat() != d: fail(422, "punch_in must belong to attendance date")
    if pout is not None and (pin is None or pout <= pin or pout - pin > timedelta(hours=24)): fail(422, "punch_out must be after punch_in and within 24 hours")
    vals = {"status": status, "punch_in": pin, "punch_out": pout, **derived(pin, pout, d, emp)}
    before = {k: doc.get(k, {"late_minutes": 0, "overtime_minutes": 0, "half_day": False}.get(k)) for k in vals}
    changes = {k: {"from": before[k], "to": v} for k, v in vals.items() if before[k] != v}
    if not changes: fail(422, "request does not change the record")
    history = {"at": datetime.now(UTC), "by": body.regularized_by, "reason": body.reason, "changes": changes}
    # Compare-and-swap guards against lost updates; append preserves prior audit history.
    expected = {"_id": doc["_id"], "status": doc["status"], "punch_in": doc.get("punch_in"), "punch_out": doc.get("punch_out"), "work_hours": doc.get("work_hours")}
    expected["late_minutes"] = doc["late_minutes"] if "late_minutes" in doc else {"$exists": False}
    result = db.attendance_logs.update_one(expected, {"$set": vals, "$push": {"history": history}})
    if not result.modified_count: fail(409, "record changed concurrently; retry")
    return record_out(db.attendance_logs.find_one({"emp_code": emp_code, "date": d}))


def month_bounds(month):
    first, last = parse_month(month)
    return first.isoformat(), last.isoformat(), first, last


def working_days_expr(start_expr, end_expr):
    # Count weekdays in [start_expr, end_expr] entirely inside MongoDB.
    return {"$size": {"$filter": {"input": {"$map": {"input": {"$range": [0, {"$add": [{"$dateDiff": {"startDate": {"$dateFromString": {"dateString": start_expr}}, "endDate": {"$dateFromString": {"dateString": end_expr}}, "unit": "day"}}, 1]}]}, "as": "n", "in": {"$dayOfWeek": {"$dateAdd": {"startDate": {"$dateFromString": {"dateString": start_expr}}, "unit": "day", "amount": "$$n"}}}}}, "as": "dow", "cond": {"$and": [{"$gte": ["$$dow", 2]}, {"$lte": ["$$dow", 6]}]}}}}


def employee_monthly_pipeline(emp_code, start, end):
    return [{"$match": {"emp_code": emp_code, "date": {"$gte": start, "$lte": end}}}, {"$group": {"_id": None, "present_days": {"$sum": {"$cond": [{"$and": [{"$in": ["$status", ["PRESENT", "WFH", "ON_DUTY"]]}, {"$in": [{"$dayOfWeek": {"$dateFromString": {"dateString": "$date"}}}, [2,3,4,5,6]]}]}, {"$cond": ["$half_day", 0.5, 1]}, 0]}}, "leave_days": {"$sum": {"$cond": [{"$eq": ["$status", "LEAVE"]}, 1, 0]}}, "late_count": {"$sum": {"$cond": [{"$gt": [{"$ifNull": ["$late_minutes", 0]}, 0]}, 1, 0]}}, "total_late_minutes": {"$sum": {"$ifNull": ["$late_minutes", 0]}}, "total_overtime_minutes": {"$sum": {"$ifNull": ["$overtime_minutes", 0]}}}}]


def employee_working_days_pipeline(emp_code, start, end):
    return [{"$match": {"emp_code": emp_code}}, {"$project": {"_id": 0, "working_days": working_days_expr(start, end)}}]


def department_summary_pipeline(start, end, last, department=None):
    match = {"joined_on": {"$lte": last}}
    if department is not None: match["department"] = department
    return [{"$match": match}, {"$lookup": {"from": "attendance_logs", "let": {"code": "$emp_code"}, "pipeline": [{"$match": {"$expr": {"$and": [{"$eq": ["$emp_code", "$$code"]}, {"$gte": ["$date", start]}, {"$lte": ["$date", end]}]}}}], "as": "logs"}}, {"$unwind": {"path": "$logs", "preserveNullAndEmptyArrays": True}}, {"$group": {"_id": "$department", "headcount": {"$addToSet": "$emp_code"}, "present_days": {"$sum": {"$cond": [{"$and": [{"$ne": ["$logs", None]}, {"$in": ["$logs.status", ["PRESENT", "WFH", "ON_DUTY"]]}, {"$in": [{"$dayOfWeek": {"$dateFromString": {"dateString": "$logs.date"}}}, [2,3,4,5,6]]}]}, {"$cond": ["$logs.half_day", 0.5, 1]}, 0]}}, "hours": {"$avg": {"$cond": [{"$and": [{"$in": ["$logs.status", ["PRESENT", "WFH", "ON_DUTY"]]}, {"$ne": ["$logs.work_hours", None]}]}, "$logs.work_hours", None]}}, "late_count": {"$sum": {"$cond": [{"$gt": [{"$ifNull": ["$logs.late_minutes", 0]}, 0]}, 1, 0]}}, "late_minutes": {"$sum": {"$ifNull": ["$logs.late_minutes", 0]}}, "leave_count": {"$sum": {"$cond": [{"$eq": ["$logs.status", "LEAVE"]}, 1, 0]}}, "on_duty_count": {"$sum": {"$cond": [{"$eq": ["$logs.status", "ON_DUTY"]}, 1, 0]}}}}, {"$project": {"department": "$_id", "headcount": {"$size": "$headcount"}, "present_days": 1, "avg_work_hours": "$hours", "late_count": 1, "total_late_minutes": "$late_minutes", "leave_count": 1, "on_duty_count": 1}}, {"$sort": {"department": 1}}]


def late_leaderboard_pipeline(start, end, limit, department=None):
    pipe = [{"$match": {"date": {"$gte": start, "$lte": end}, "late_minutes": {"$gt": 0}}}, {"$group": {"_id": "$emp_code", "total_late_minutes": {"$sum": "$late_minutes"}, "late_count": {"$sum": 1}}}, {"$lookup": {"from": "employees", "localField": "_id", "foreignField": "emp_code", "as": "employee"}}, {"$unwind": "$employee"}]
    if department is not None: pipe.append({"$match": {"employee.department": department}})
    return pipe + [{"$set": {"emp_code": "$_id", "name": "$employee.name", "department": "$employee.department"}}, {"$setWindowFields": {"sortBy": {"total_late_minutes": -1}, "output": {"rank": {"$rank": {}}}}}, {"$match": {"rank": {"$lte": limit}}}, {"$sort": {"total_late_minutes": -1, "emp_code": 1}}, {"$project": {"_id": 0, "rank": 1, "emp_code": 1, "name": 1, "department": 1, "total_late_minutes": 1, "late_count": 1}}]


@app.get("/analytics/employees/{emp_code}/monthly")
def employee_monthly(emp_code: str, month: str):
    start, end, first, last = month_bounds(month)
    emp = db.employees.find_one({"emp_code": emp_code}, {"_id": 0, "joined_on": 1})
    if not emp: fail(404, "employee not found")
    work_start = max(first, parsed_date(emp["joined_on"]))
    workday_pipe = employee_working_days_pipeline(emp_code, work_start.isoformat(), last.isoformat())
    work_days = 0 if work_start > last else next(db.employees.aggregate(workday_pipe), {}).get("working_days", 0)
    pipe = employee_monthly_pipeline(emp_code, start, end)
    agg = next(db.attendance_logs.aggregate(pipe), {})
    pct = None if not work_days else float(((Decimal(str(agg.get("present_days", 0))) * Decimal(100) / Decimal(work_days)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)))
    return {"emp_code": emp_code, "month": month, "working_days": work_days, "present_days": round_half(agg.get("present_days",0)), "leave_days": agg.get("leave_days",0), "late_count": agg.get("late_count",0), "total_late_minutes": agg.get("total_late_minutes",0), "total_overtime_minutes": agg.get("total_overtime_minutes",0), "attendance_pct": pct}


def round_half(v, places=2):
    return float(Decimal(str(v)).quantize(Decimal("1." + "0"*places), rounding=ROUND_HALF_UP))


@app.get("/analytics/departments/summary")
def department_summary(month: str, department: str | None = None):
    start, end, _, last = month_bounds(month)
    pipe = department_summary_pipeline(start, end, last.isoformat(), department)
    items = list(db.employees.aggregate(pipe))
    for x in items:
        x.pop("_id", None)
        if x["avg_work_hours"] is not None: x["avg_work_hours"] = round_half(x["avg_work_hours"])
        x["present_days"] = round_half(x["present_days"])
    return {"month": month, "items": items}


@app.get("/analytics/leaderboard/late")
def late_leaderboard(month: str, limit: int = Query(10, ge=1, le=50), department: str | None = None):
    start, end, _, _ = month_bounds(month)
    pipe = late_leaderboard_pipeline(start, end, limit, department)
    return {"month": month, "items": list(db.attendance_logs.aggregate(pipe))}


def trend_pipeline(department, start, end):
    try:
        start_dt = datetime.combine(parsed_date(start), time.min, IST).astimezone(UTC)
        # `$densify` has an exclusive upper bound; end-of-day includes `to` without advancing its date.
        end_dt = datetime.combine(parsed_date(end), time.max, IST).astimezone(UTC)
    except OverflowError:
        fail(422, "date range is outside the supported calendar range")
    return [
        {"$match": {"department": department}},
        {"$lookup": {"from": "attendance_logs", "let": {"code": "$emp_code"}, "pipeline": [
            {"$match": {"$expr": {"$and": [{"$eq": ["$emp_code", "$$code"]}, {"$gte": ["$date", start]}, {"$lte": ["$date", end]}]}}},
            {"$set": {"day": {"$dateFromString": {"dateString": "$date", "timezone": "Asia/Kolkata"}}}}
        ], "as": "logs"}},
        {"$unwind": {"path": "$logs", "preserveNullAndEmptyArrays": True}},
        {"$group": {"_id": {"$ifNull": ["$logs.day", start_dt]},
            "present_count": {"$sum": {"$cond": [{"$in": ["$logs.status", ["PRESENT", "WFH", "ON_DUTY"]]}, {"$cond": ["$logs.half_day", 0.5, 1]}, 0]}},
            "late_count": {"$sum": {"$cond": [{"$gt": [{"$ifNull": ["$logs.late_minutes", 0]}, 0]}, 1, 0]}}}},
        {"$project": {"date": "$_id", "present_count": 1, "late_count": 1}},
        {"$densify": {"field": "date", "range": {"step": 1, "unit": "day", "bounds": [start_dt, end_dt]}}},
        {"$set": {"is_working_day": {"$and": [{"$gte": [{"$dayOfWeek": {"date": "$date", "timezone": "Asia/Kolkata"}}, 2]}, {"$lte": [{"$dayOfWeek": {"date": "$date", "timezone": "Asia/Kolkata"}}, 6]}]}, "present_count": {"$ifNull": ["$present_count", 0]}, "late_count": {"$ifNull": ["$late_count", 0]}}},
        {"$lookup": {"from": "employees", "let": {"d": "$date"}, "pipeline": [
            {"$match": {"department": department}},
            {"$match": {"$expr": {"$lte": [{"$dateFromString": {"dateString": "$joined_on", "timezone": "Asia/Kolkata"}}, "$$d"]}}},
            {"$count": "n"}], "as": "hc"}},
        {"$set": {"headcount": {"$ifNull": [{"$arrayElemAt": ["$hc.n", 0]}, 0]},
            "attendance_rate": {"$cond": [{"$and": ["$is_working_day", {"$gt": [{"$ifNull": [{"$arrayElemAt": ["$hc.n", 0]}, 0]}, 0]}]}, {"$divide": [{"$floor": {"$add": [{"$multiply": [{"$divide": ["$present_count", {"$arrayElemAt": ["$hc.n", 0]}]}, 10000]}, 0.5]}}, 10000]}, None]}}},
        {"$setWindowFields": {"sortBy": {"date": 1}, "output": {"moving_avg_7d": {"$avg": "$attendance_rate", "window": {"documents": [-6, 0]}}}}},
        {"$sort": {"date": 1}},
        {"$project": {"_id": 0, "date": {"$dateToString": {"date": "$date", "format": "%Y-%m-%d", "timezone": "Asia/Kolkata"}}, "is_working_day": 1, "headcount": 1, "present_count": 1, "late_count": 1, "attendance_rate": 1, "moving_avg_7d": 1}}
    ]
@app.get("/analytics/departments/{department}/trend")
def department_trend(department: str, from_: str = Query(..., alias="from"), to: str = Query(...)):
    start_s, end_s = from_, to
    if not start_s or not end_s: fail(422, "from and to are required")
    start, end = parsed_date(start_s), parsed_date(end_s)
    if end < start or (end-start).days+1 > 92: fail(422, "invalid date range; maximum is 92 days")
    if not db.employees.find_one({"department": department}): fail(404, "department not found")
    pipe = trend_pipeline(department, start.isoformat(), end.isoformat())
    items = list(db.employees.aggregate(pipe))
    for x in items:
        if x.get("attendance_rate") is not None: x["attendance_rate"] = round_half(x["attendance_rate"], 4)
        if x.get("moving_avg_7d") is not None: x["moving_avg_7d"] = round_half(x["moving_avg_7d"], 4)
    return {"department": department, "items": items}


def explain_pipeline(pipeline, collection):
    return db.command({"explain": {"aggregate": collection.name, "pipeline": pipeline, "cursor": {}}, "verbosity": "executionStats"})


@app.get("/admin/explain/{endpoint}")
def explain(endpoint: str, emp_code: str | None = None, month: str | None = None, department: str | None = None, limit: int = Query(10, ge=1, le=50), date_from: str | None = None, date_to: str | None = None, status: Literal["PRESENT", "ABSENT", "LEAVE", "WFH", "ON_DUTY"] | None = None, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), from_: str | None = Query(None, alias="from"), to: str | None = None):
    related_explains = {}
    if endpoint == "attendance_list":
        q = {}
        if emp_code is not None: q["emp_code"] = emp_code
        if status is not None: q["status"] = status
        if date_from: q.setdefault("date", {})["$gte"] = parsed_date(date_from).isoformat()
        if date_to: q.setdefault("date", {})["$lte"] = parsed_date(date_to).isoformat()
        if date_from and date_to and date_from > date_to: fail(422, "date_from must not be after date_to")
        result = db.command({"explain": {"find": "attendance_logs", "filter": q, "sort": {"date": -1, "emp_code": 1}, "skip": (page-1)*page_size, "limit": page_size}, "verbosity": "executionStats"})
        return {"endpoint": endpoint, "collection": "attendance_logs", "explain": result}
    if not month and endpoint in ("employee_monthly", "department_summary", "late_leaderboard"): fail(422, "month is required")
    if endpoint == "employee_monthly":
        if not emp_code: fail(422, "emp_code is required")
        if not db.employees.find_one({"emp_code": emp_code}, {"_id": 1}): fail(404, "employee not found")
        s,e,_,_ = month_bounds(month)
        pipe = employee_monthly_pipeline(emp_code, s, e)
        employee = db.employees.find_one({"emp_code": emp_code}, {"_id": 0, "joined_on": 1})
        work_start = max(date.fromisoformat(s), parsed_date(employee["joined_on"]))
        if work_start <= date.fromisoformat(e):
            workday_pipe = employee_working_days_pipeline(emp_code, work_start.isoformat(), e)
            related_explains["working_days"] = explain_pipeline(workday_pipe, db.employees)
        coll = db.attendance_logs
    elif endpoint == "department_summary":
        s,e,_,last=month_bounds(month)
        pipe = department_summary_pipeline(s, e, last.isoformat(), department)
        coll=db.employees
    elif endpoint == "late_leaderboard":
        s,e,_,_=month_bounds(month)
        pipe = late_leaderboard_pipeline(s, e, limit, department)
        coll=db.attendance_logs
    elif endpoint == "department_trend":
        if not department or not from_ or not to: fail(422,"department, from and to are required")
        trend_from, trend_to = parsed_date(from_), parsed_date(to)
        if trend_to < trend_from or (trend_to-trend_from).days + 1 > 92: fail(422, "invalid date range; maximum is 92 days")
        if not db.employees.find_one({"department": department}, {"_id": 1}): fail(404, "department not found")
        s, e = trend_from.isoformat(), trend_to.isoformat()
        pipe=trend_pipeline(department,s,e); coll=db.employees
    else: fail(422,"unsupported endpoint")
    result = {"endpoint":endpoint,"collection":coll.name,"explain":explain_pipeline(pipe,coll)}
    if related_explains:
        result["related_explains"] = related_explains
    return result



