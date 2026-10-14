"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CalendarCheck2, Users } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Attendance, DepartmentSummary } from "@/lib/types";
import { dateLabel, timeLabel, thisMonth } from "@/lib/utils";
import { Badge, Card, Notice, PageIntro, StatCard } from "@/components/ui";

export default function Dashboard() {
  const [employeeTotal, setEmployeeTotal] = useState<number | null>(null);
  const [logs, setLogs] = useState<Attendance[] | null>(null);
  const [departments, setDepartments] = useState<DepartmentSummary[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    Promise.all([api.employees(1, 1), api.attendance({ page: 1, page_size: 8 }), api.summary(thisMonth())])
      .then(([employees, attendance, summary]) => {
        setEmployeeTotal(employees.total);
        setLogs(attendance.items);
        setDepartments(summary.items);
      })
      .catch(reason => setError(reason instanceof ApiError ? reason.message : "Unable to load dashboard data."));
  }, []);

  useEffect(() => { load(); }, [load]);

  return <div className="space-y-6 sm:space-y-7">
    <PageIntro eyebrow="Overview" title="People at a glance" description="Current employee records and the latest attendance activity." action={<Link href="/employees" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--brand)] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--brand-strong)]"><Users size={16}/>Manage employees</Link>}/>

    {error && <Notice tone="error" title="Dashboard data is unavailable" retry={load}>{error}</Notice>}

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
      <StatCard label="Employees" value={error ? "—" : employeeTotal === null ? <span className="inline-block h-7 w-16 animate-pulse rounded bg-slate-100"/> : employeeTotal.toLocaleString()} note={error ? "Unavailable" : "Total in the employee directory"} icon={<Users size={17}/>} />
      <StatCard label="Recent records" value={error ? "—" : logs === null ? <span className="inline-block h-7 w-12 animate-pulse rounded bg-slate-100"/> : logs.length} note={error ? "Unavailable" : "Attendance items in the latest preview"} icon={<CalendarCheck2 size={17}/>} tone="blue" />
    </div>

    <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,.8fr)]">
      <Card title="Recent attendance" subtitle="Latest entries returned by the attendance API." action={<Link href="/attendance" className="quiet-link inline-flex items-center gap-1 text-xs">All records <ArrowRight size={14}/></Link>} bodyClassName="p-0">
        {error ? <Notice tone="error" title="Recent activity unavailable">Retry the dashboard request to load recent attendance.</Notice> : logs === null ? <div className="p-5"><div className="h-10 animate-pulse rounded-lg bg-slate-100"/></div> : logs.length === 0 ? <Notice title="No attendance yet">Attendance records will appear here once employees have punched in.</Notice> :
          <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm">
            <thead className="table-head text-[11px] font-semibold uppercase tracking-wide"><tr><th className="px-5 py-3">Employee</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Punch in</th></tr></thead>
            <tbody>{logs.map(record => <tr key={`${record.emp_code}-${record.date}`} className="table-row"><td className="px-5 py-3.5"><span className="font-semibold text-slate-800">{record.emp_code}</span></td><td className="px-4 py-3.5 text-slate-600">{dateLabel(record.date)}</td><td className="px-4 py-3.5"><Badge value={record.status}/></td><td className="px-4 py-3.5 tabular-nums text-slate-600">{timeLabel(record.punch_in)}</td></tr>)}</tbody>
          </table></div>}
      </Card>

      <Card title={`Department overview · ${thisMonth()}`} subtitle="Headcount and present days from the monthly summary." bodyClassName="p-0">
        {error ? <Notice tone="error" title="Summary unavailable">Retry to load the department report.</Notice> : departments === null ? <div className="space-y-3 p-5">{[1, 2, 3].map(item => <div key={item} className="h-9 animate-pulse rounded-lg bg-slate-100"/>)}</div> : departments.length === 0 ? <Notice title="No department summary">There are no eligible employees in this reporting period.</Notice> :
          <ul className="divide-y divide-slate-100">{departments.slice(0, 7).map(department => <li key={department.department} className="flex items-center justify-between gap-3 px-5 py-3.5"><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-800">{department.department}</p><p className="mt-0.5 text-xs text-[var(--muted)]">{department.headcount} employees</p></div><div className="shrink-0 text-right"><p className="text-sm font-semibold tabular-nums">{department.present_days}</p><p className="text-[10px] text-[var(--muted)]">present days</p></div></li>)}</ul>}
        {departments && departments.length > 0 && <div className="border-t border-slate-100 px-5 py-3"><Link href="/analytics" className="quiet-link inline-flex items-center gap-1 text-xs">View analytics <ArrowRight size={14}/></Link></div>}
      </Card>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-white px-5 py-4 shadow-[var(--shadow-card)]">
      <div><p className="text-sm font-semibold">Need to record attendance?</p><p className="mt-1 text-xs text-[var(--muted)]">Punch events are saved by the attendance API and reflected in the records list.</p></div>
      <Link href="/attendance" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50">Open attendance <ArrowRight size={15}/></Link>
    </div>
  </div>;
}
