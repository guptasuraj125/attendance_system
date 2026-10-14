"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Building2, CalendarDays, Clock3, Users } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, ApiError } from "@/lib/api";
import type { DepartmentSummary, Employee, Leader, Monthly, Trend } from "@/lib/types";
import { thisMonth, today } from "@/lib/utils";
import { Button, Card, Field, Loading, Notice, PageIntro, SelectField, StatCard } from "@/components/ui";

type Tab = "monthly" | "departments" | "leaderboard" | "trend";
const tabs: { id: Tab; label: string }[] = [
  { id: "monthly", label: "Employee monthly" },
  { id: "departments", label: "Department summary" },
  { id: "leaderboard", label: "Late leaderboard" },
  { id: "trend", label: "Department trend" },
];

export default function Analytics() {
  const [tab, setTab] = useState<Tab>("monthly");
  const [month, setMonth] = useState(thisMonth());
  const [leaderboardLimit, setLeaderboardLimit] = useState(10);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeTotal, setEmployeeTotal] = useState(0);
  const [employeePage, setEmployeePage] = useState(1);
  const [employeeLoading, setEmployeeLoading] = useState(true);
  const [employeeError, setEmployeeError] = useState("");
  const [code, setCode] = useState("");
  const [department, setDepartment] = useState("");
  const [from, setFrom] = useState(`${thisMonth()}-01`);
  const [to, setTo] = useState(today());
  const [monthly, setMonthly] = useState<Monthly | null>(null);
  const [summary, setSummary] = useState<DepartmentSummary[] | null>(null);
  const [leaders, setLeaders] = useState<Leader[] | null>(null);
  const [trend, setTrend] = useState<Trend[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const loadEmployees = useCallback(async () => {
    setEmployeeLoading(true); setEmployeeError("");
    try {
      const response = await api.employees(1, 100);
      setEmployees(response.items); setEmployeeTotal(response.total); setEmployeePage(1);
      if (response.items[0]) setCode(current => current || response.items[0].emp_code);
    } catch (reason) { setEmployeeError(reason instanceof ApiError ? reason.message : "Unable to load employees."); }
    finally { setEmployeeLoading(false); }
  }, []);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  useEffect(() => {
    let active = true;
    setBusy(true); setError("");
    if (tab === "trend" && department && (!from || !to || from > to)) {
      setError(!from || !to ? "Choose both a start date and an end date." : "The end date must be on or after the start date."); setBusy(false); return;
    }
    const task = tab === "monthly"
      ? (code ? api.monthly(code, month).then(setMonthly) : Promise.resolve())
      : tab === "departments"
        ? api.summary(month, department || undefined).then(response => setSummary(response.items))
        : tab === "leaderboard"
          ? api.leaderboard(month, leaderboardLimit, department || undefined).then(response => setLeaders(response.items))
          : department ? api.trend(department, from, to).then(response => setTrend(response.items)) : Promise.resolve();
    task.catch(reason => { if (active) setError(reason instanceof ApiError ? reason.message : "Unable to load analytics. Please check that the API is running and try again."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [tab, month, code, department, from, to, leaderboardLimit, retryKey]);

  const loadMoreEmployees = async () => {
    if (employeeLoading || employees.length >= employeeTotal) return;
    const nextPage = employeePage + 1;
    setEmployeeLoading(true); setEmployeeError("");
    try {
      const response = await api.employees(nextPage, 100);
      setEmployees(current => [...current, ...response.items]); setEmployeePage(nextPage);
    } catch (reason) { setEmployeeError(reason instanceof ApiError ? reason.message : "Unable to load more employees."); }
    finally { setEmployeeLoading(false); }
  };

  return <div className="space-y-5 sm:space-y-6">
    <PageIntro eyebrow="Reporting" title="Attendance insights" description="Explore employee and department attendance measures as calculated by the backend."/>
    <div className="border-b border-[var(--line)]">
      <div role="tablist" aria-label="Analytics reports" className="-mb-px grid grid-cols-2 gap-1 lg:grid-cols-4">
        {tabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} aria-controls="analytics-panel" onClick={() => setTab(item.id)} className={`w-full border-b-2 px-2 py-3 text-[11px] font-semibold transition sm:px-3 sm:text-sm ${tab === item.id ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{item.label}</button>)}
      </div>
    </div>

    <section id="analytics-panel" role="tabpanel" className="space-y-5" aria-label={tabs.find(item => item.id === tab)?.label}>
      <Card title="Report filters" subtitle={filterDescription(tab)} bodyClassName="p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {tab === "monthly" && <div>
            <SelectField label="Employee" value={code} onChange={event => setCode(event.target.value)}><option value="">Select employee</option>{employees.map(employee => <option key={employee.emp_code} value={employee.emp_code}>{employee.emp_code} · {employee.name}</option>)}</SelectField>
            {employeeTotal > employees.length && <Button variant="quiet" type="button" disabled={employeeLoading} onClick={loadMoreEmployees} className="mt-1 px-0 text-xs">{employeeLoading ? "Loading employees…" : `Load more (${employeeTotal - employees.length} remaining)`}</Button>}
            {employeeError && <p role="alert" className="mt-1 text-xs text-rose-700">{employeeError} <button type="button" onClick={loadEmployees} className="font-semibold underline">Retry</button></p>}
          </div>}
          {tab !== "trend" && <Field label="Reporting month" type="month" value={month} onChange={event => setMonth(event.target.value)}/>}
          {tab === "leaderboard" && <SelectField label="Rank limit" value={leaderboardLimit} onChange={event => setLeaderboardLimit(Number(event.target.value))}><option value={10}>Top 10 ranks</option><option value={20}>Top 20 ranks</option><option value={50}>Top 50 ranks</option></SelectField>}
          {(tab === "leaderboard" || tab === "trend") && <div>
            <SelectField label="Department" value={department} onChange={event => setDepartment(event.target.value)}><option value="">{tab === "trend" ? "Select department" : "All departments"}</option>{departmentOptions(employees).map(value => <option key={value} value={value}>{value}</option>)}</SelectField>
            {employeeTotal > employees.length && <Button variant="quiet" type="button" disabled={employeeLoading} onClick={loadMoreEmployees} className="mt-1 px-0 text-xs">Load more department options</Button>}
            {employeeError && <p role="alert" className="mt-1 text-xs text-rose-700">{employeeError} <button type="button" onClick={loadEmployees} className="font-semibold underline">Retry</button></p>}
          </div>}
          {tab === "departments" && <div>
            <SelectField label="Department" value={department} onChange={event => setDepartment(event.target.value)}><option value="">All departments</option>{departmentOptions(employees).map(value => <option key={value} value={value}>{value}</option>)}</SelectField>
            {employeeTotal > employees.length && <Button variant="quiet" type="button" disabled={employeeLoading} onClick={loadMoreEmployees} className="mt-1 px-0 text-xs">Load more department options</Button>}
            {employeeError && <p role="alert" className="mt-1 text-xs text-rose-700">{employeeError} <button type="button" onClick={loadEmployees} className="font-semibold underline">Retry</button></p>}
          </div>}
          {tab === "trend" && <><Field label="From date" type="date" value={from} onChange={event => setFrom(event.target.value)}/><Field label="To date" type="date" value={to} onChange={event => setTo(event.target.value)}/></>}
        </div>
      </Card>

      {error ? <Notice tone="error" title="Unable to load this report" retry={() => setRetryKey(value => value + 1)}>{error}</Notice> : busy ? <Card title="Loading report"><Loading label="Loading analytics"/></Card> : <>
        {tab === "monthly" && <MonthlyReport data={monthly} selected={!!code}/>}
        {tab === "departments" && <DepartmentReport data={summary}/>}
        {tab === "leaderboard" && <LeaderboardReport data={leaders}/>}
        {tab === "trend" && <TrendReport data={trend} selected={!!department}/>}
      </>}
    </section>
  </div>;
}

function filterDescription(tab: Tab) {
  if (tab === "monthly") return "Choose an employee and month to view backend-calculated attendance metrics.";
  if (tab === "departments") return "View department-level totals returned by the monthly summary endpoint.";
  if (tab === "leaderboard") return "Late minutes and competition ranks are supplied by the API.";
  return "Choose a department and date range. The API fills missing dates and calculates the moving average.";
}

function departmentOptions(employees: Employee[]) { return Array.from(new Set(employees.map(employee => employee.department))).sort((a, b) => a.localeCompare(b)); }

function MonthlyReport({ data, selected }: { data: Monthly | null; selected: boolean }) {
  if (!selected) return <Notice title="Select an employee">Choose an employee above to load their monthly report.</Notice>;
  if (!data) return <Notice title="Monthly report unavailable">No report data was returned for this selection.</Notice>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">{data.emp_code}</p><p className="mt-0.5 text-xs text-[var(--muted)]">Monthly attendance · {data.month}</p></div><span className="rounded-full bg-[var(--brand-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-strong)]">{data.attendance_pct === null ? "Rate unavailable" : `${data.attendance_pct}% attendance`}</span></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <StatCard label="Working days" value={data.working_days} icon={<CalendarDays size={17}/>} tone="slate"/>
      <StatCard label="Present days" value={data.present_days} icon={<Users size={17}/>} tone="green"/>
      <StatCard label="Leave days" value={data.leave_days} icon={<Building2 size={17}/>} tone="blue"/>
      <StatCard label="Late count" value={data.late_count} icon={<Clock3 size={17}/>} tone="amber"/>
      <StatCard label="Total late minutes" value={data.total_late_minutes} icon={<Clock3 size={17}/>} tone="slate"/>
      <StatCard label="Overtime minutes" value={data.total_overtime_minutes} icon={<Activity size={17}/>} tone="green"/>
    </div>
  </div>;
}

function DepartmentReport({ data }: { data: DepartmentSummary[] | null }) {
  if (data === null) return <Loading label="Loading department summary"/>;
  if (data.length === 0) return <Notice title="No department data">No eligible employees or attendance summary was returned for this month.</Notice>;
  return <Card title="Department summary" subtitle="Values and ordering are taken directly from the API response." bodyClassName="p-0">
    <div className="hidden overflow-x-auto sm:block"><table className="w-full min-w-[850px] text-left text-sm">
      <thead className="table-head text-[10px] font-semibold uppercase tracking-wide"><tr>{["Department", "Headcount", "Present days", "Avg hours", "Late count", "Late minutes", "Leave", "On duty"].map((heading, index) => <th key={heading} scope="col" className={`px-3 py-3.5 ${index > 0 ? "text-right" : "pl-5"}`}>{heading}</th>)}</tr></thead>
      <tbody>{data.map(row => <tr key={row.department} className="table-row"><th scope="row" className="px-5 py-3.5 text-left font-semibold">{row.department}</th><td className="px-3 py-3.5 text-right tabular-nums">{row.headcount}</td><td className="px-3 py-3.5 text-right tabular-nums">{row.present_days}</td><td className="px-3 py-3.5 text-right tabular-nums">{row.avg_work_hours ?? "—"}</td><td className="px-3 py-3.5 text-right tabular-nums">{row.late_count}</td><td className="px-3 py-3.5 text-right tabular-nums">{row.total_late_minutes}</td><td className="px-3 py-3.5 text-right tabular-nums">{row.leave_count}</td><td className="px-5 py-3.5 text-right tabular-nums">{row.on_duty_count}</td></tr>)}</tbody>
    </table></div>
    <div className="divide-y divide-slate-100 sm:hidden">{data.map(row => <article key={row.department} className="p-4"><h3 className="text-sm font-semibold">{row.department}</h3><div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">{[["Headcount", row.headcount], ["Present days", row.present_days], ["Average hours", row.avg_work_hours ?? "—"], ["Late count", row.late_count], ["Late minutes", row.total_late_minutes], ["Leave", row.leave_count], ["On duty", row.on_duty_count]].map(([label, value]) => <div key={label}><p className="text-[10px] uppercase tracking-wide text-[var(--subtle)]">{label}</p><p className="mt-1 text-sm font-semibold tabular-nums">{value}</p></div>)}</div></article>)}</div>
  </Card>;
}

function LeaderboardReport({ data }: { data: Leader[] | null }) {
  if (data === null) return <Loading label="Loading late leaderboard"/>;
  if (data.length === 0) return <Notice title="No late arrivals">No late attendance records were returned for this month.</Notice>;
  return <Card title="Late leaderboard" subtitle="Competition ranking: tied employees share a rank and the next rank is skipped." bodyClassName="p-0">
    <div className="overflow-x-auto"><table className="w-full min-w-[610px] text-left text-sm">
      <thead className="table-head text-[10px] font-semibold uppercase tracking-wide"><tr><th scope="col" className="w-20 px-5 py-3.5">Rank</th><th scope="col" className="px-3 py-3.5">Employee</th><th scope="col" className="px-3 py-3.5">Department</th><th scope="col" className="px-3 py-3.5 text-right">Late count</th><th scope="col" className="px-5 py-3.5 text-right">Late minutes</th></tr></thead>
      <tbody>{data.map(row => {
        const tied = data.filter(item => item.rank === row.rank).length > 1;
        return <tr key={row.emp_code} className="table-row"><td className="px-5 py-3.5"><span className={`inline-grid h-7 min-w-7 place-items-center rounded-md px-1 text-xs font-bold ${row.rank === 1 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{row.rank}</span>{tied && <span className="ml-2 text-[10px] text-[var(--muted)]">Tied</span>}</td><td className="px-3 py-3.5"><p className="font-semibold">{row.name}</p><code className="font-mono text-[10px] text-[var(--muted)]">{row.emp_code}</code></td><td className="px-3 py-3.5 text-slate-600">{row.department}</td><td className="px-3 py-3.5 text-right tabular-nums">{row.late_count}</td><td className="px-5 py-3.5 text-right font-semibold tabular-nums">{row.total_late_minutes}</td></tr>;
      })}</tbody>
    </table></div>
  </Card>;
}

function TrendReport({ data, selected }: { data: Trend[] | null; selected: boolean }) {
  if (!selected) return <Notice title="Choose a department">Select a department and date range to load the trend.</Notice>;
  if (data === null) return <Loading label="Loading department trend"/>;
  if (data.length === 0) return <Notice title="No trend returned">The API returned no daily trend points for this date range.</Notice>;
  const chartData = data.map(point => ({
    ...point,
    chartDate: shortDate(point.date),
    attendance_rate: toPercent(point.attendance_rate),
    moving_avg_7d: toPercent(point.moving_avg_7d),
  }));
  return <div className="space-y-4">
    <Card title="Attendance trend" subtitle="Daily attendance rate and API-provided 7-day moving average." bodyClassName="p-4 sm:p-6">
      <div className="h-[260px] w-full sm:h-[320px]" role="img" aria-label="Line chart of department attendance rate and seven-day moving average by day">
        <ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 12, right: 12, left: -14, bottom: 5 }}>
          <CartesianGrid stroke="#edf0f4" strokeDasharray="3 4" vertical={false}/>
          <XAxis dataKey="chartDate" interval={Math.max(0, Math.ceil(data.length / 7) - 1)} tick={{ fontSize: 10, fill: "#718096" }} tickLine={false} axisLine={{ stroke: "#dce3e9" }}/>
          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#718096" }} tickLine={false} axisLine={false} tickFormatter={value => `${value}%`} width={42}/>
          <Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ""} formatter={(value, name) => [value === null || value === undefined ? "No value" : `${value}%`, name]}/>
          <Line name="Attendance rate" dataKey="attendance_rate" stroke="#176b60" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: "#176b60" }} connectNulls={false}/>
          <Line name="7-day moving average" dataKey="moving_avg_7d" stroke="#cf8a3d" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#cf8a3d" }} connectNulls={false}/>
        </LineChart></ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-[var(--muted)]"><span className="inline-flex items-center gap-2"><i className="h-0.5 w-4 bg-[#176b60]"/>Attendance rate</span><span className="inline-flex items-center gap-2"><i className="h-0.5 w-4 bg-[#cf8a3d]"/>7-day moving average</span><span className="text-slate-400">Null values remain gaps.</span></div>
    </Card>
    <Card title="Daily details" subtitle="Attendance date, working day, headcount, and daily totals from the API." bodyClassName="p-0">
      <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm">
        <thead className="table-head text-[10px] font-semibold uppercase tracking-wide"><tr>{["Date", "Day type", "Headcount", "Present", "Late", "Rate", "7-day avg"].map((heading, index) => <th key={heading} scope="col" className={`px-3 py-3.5 ${index === 0 ? "pl-5" : index > 1 ? "text-right" : ""}`}>{heading}</th>)}</tr></thead>
        <tbody>{data.map(row => <tr key={row.date} className={`table-row ${!row.is_working_day ? "text-slate-400" : ""}`}><th scope="row" className="whitespace-nowrap px-5 py-3 text-left font-medium">{dateLabelForTrend(row.date)}</th><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${row.is_working_day ? "bg-slate-100 text-slate-600" : "bg-slate-50 text-slate-400"}`}>{row.is_working_day ? "Working day" : "Weekend"}</span></td><td className="px-3 py-3 text-right tabular-nums">{row.headcount}</td><td className="px-3 py-3 text-right tabular-nums">{row.present_count}</td><td className="px-3 py-3 text-right tabular-nums">{row.late_count}</td><td className="px-3 py-3 text-right tabular-nums">{formatRate(row.attendance_rate)}</td><td className="px-5 py-3 text-right tabular-nums">{formatRate(row.moving_avg_7d)}</td></tr>)}</tbody>
      </table></div>
    </Card>
  </div>;
}

function shortDate(date: string) { return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)); }
function dateLabelForTrend(date: string) { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)); }
function toPercent(rate: number | null) { return rate === null ? null : rate * 100; }
function formatRate(rate: number | null) { return rate === null ? "—" : `${(rate * 100).toFixed(2)}%`; }
