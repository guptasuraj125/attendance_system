"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, RotateCcw, SlidersHorizontal } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Attendance, Page, Status } from "@/lib/types";
import { dateLabel, timeLabel, today } from "@/lib/utils";
import { Badge, Button, Card, Field, Loading, Notice, PageIntro, Pager, SelectField } from "@/components/ui";

const statuses: [string, Status][] = [["Present", "PRESENT"], ["Absent", "ABSENT"], ["Leave", "LEAVE"], ["Work from home", "WFH"], ["On duty", "ON_DUTY"]];
type Filters = { emp_code: string; date_from: string; date_to: string; status: string };
const noFilters = (): Filters => ({ emp_code: "", date_from: "", date_to: today(), status: "" });

export default function AttendancePage() {
  const [data, setData] = useState<Page<Attendance> | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(noFilters);
  const [draft, setDraft] = useState(noFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterError, setFilterError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [busy, setBusy] = useState<"in" | "out" | "">("");
  const [punchCode, setPunchCode] = useState("");
  const [punchStatus, setPunchStatus] = useState<Status>("PRESENT");

  const load = useCallback(() => {
    setLoading(true); setError("");
    api.attendance({ page, page_size: 20, emp_code: filters.emp_code, date_from: filters.date_from, date_to: filters.date_to, status: filters.status as Status || undefined })
      .then(setData).catch(reason => setError(reason.message || "Unable to load attendance records. Please check that the API is running and try again."))
      .finally(() => setLoading(false));
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  const applyFilters = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.date_from && draft.date_to && draft.date_from > draft.date_to) { setFilterError("The start date must be on or before the end date."); return; }
    setFilterError(""); setPage(1); setFilters({ ...draft, emp_code: draft.emp_code.trim() });
  };

  const resetFilters = () => { const defaults = noFilters(); setDraft(defaults); setFilters(defaults); setFilterError(""); setPage(1); };

  const punch = async (kind: "in" | "out") => {
    const code = punchCode.trim();
    if (!code || busy) return;
    setBusy(kind); setActionError(""); setActionSuccess("");
    try {
      if (kind === "in") await api.punchIn(code, punchStatus); else await api.punchOut(code);
      setActionSuccess(kind === "in" ? "Punch-in recorded." : "Punch-out recorded.");
      load();
    } catch (reason) {
      setActionError(reason instanceof ApiError ? reason.message : "Unable to complete this attendance action.");
    } finally { setBusy(""); }
  };

  return <div className="space-y-5 sm:space-y-6">
    <PageIntro eyebrow="Daily operations" title="Attendance activity" description="Record punch events and review the attendance ledger. All times are displayed in IST."/>
    <Card title="Record a punch" subtitle="The API applies the employee shift and attendance-date rules." bodyClassName="p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto_auto] xl:items-end">
        <Field label="Employee code" name="punch-code" value={punchCode} onChange={event => setPunchCode(event.target.value)} placeholder="EMP0001" maxLength={9}/>
        <SelectField label="Punch-in status" value={punchStatus} onChange={event => setPunchStatus(event.target.value as Status)}>{statuses.filter(([, value]) => ["PRESENT", "WFH", "ON_DUTY"].includes(value)).map(([label, value]) => <option key={value} value={value}>{label}</option>)}</SelectField>
        <Button type="button" disabled={!punchCode.trim() || !!busy} onClick={() => punch("in")} className="w-full xl:w-auto"><ArrowDownToLine size={16}/>{busy === "in" ? "Recording…" : "Punch in"}</Button>
        <Button type="button" variant="secondary" disabled={!punchCode.trim() || !!busy} onClick={() => punch("out")} className="w-full xl:w-auto"><ArrowUpFromLine size={16}/>{busy === "out" ? "Recording…" : "Punch out"}</Button>
      </div>
      {actionError && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{actionError}</p>}
      {actionSuccess && <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{actionSuccess} The list is refreshing from the API.</p>}
    </Card>

    <Card title="Attendance records" subtitle="Filter by employee, date, or attendance status." bodyClassName="p-0">
      <form onSubmit={applyFilters} className="grid gap-3 border-b border-[var(--line)] bg-slate-50/70 p-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-4 xl:grid-cols-[1.15fr_1fr_1fr_1fr_auto] xl:items-end">
        <Field label="Employee code" name="filter-employee" value={draft.emp_code} onChange={event => setDraft({ ...draft, emp_code: event.target.value })} placeholder="Any employee" maxLength={9}/>
        <SelectField label="Status" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}><option value="">All statuses</option>{statuses.map(([label, value]) => <option key={value} value={value}>{label}</option>)}</SelectField>
        <Field label="From date" name="date-from" type="date" value={draft.date_from} onChange={event => setDraft({ ...draft, date_from: event.target.value })}/>
        <Field label="To date" name="date-to" type="date" value={draft.date_to} onChange={event => setDraft({ ...draft, date_to: event.target.value })}/>
        <div className="flex gap-2 lg:col-span-2 xl:col-span-1"><Button><SlidersHorizontal size={15}/>Apply</Button><Button type="button" variant="secondary" onClick={resetFilters} aria-label="Reset attendance filters"><RotateCcw size={15}/><span className="hidden sm:inline">Reset</span></Button></div>
        {filterError && <p role="alert" className="text-xs text-rose-700 sm:col-span-2 lg:col-span-4 xl:col-span-5">{filterError}</p>}
      </form>
      {loading ? <div className="p-5"><Loading label="Loading attendance records"/></div> : error ? <Notice tone="error" title="Unable to load attendance" retry={load}>{error}</Notice> : !data?.items.length ? <Notice title="No attendance records found">No attendance records found for the selected filters. Try adjusting the dates or clearing a filter.</Notice> : <>
        <div className="overflow-x-auto"><table className="w-full min-w-[1020px] text-left text-sm">
          <thead className="table-head text-[10px] font-semibold uppercase tracking-wide"><tr><th scope="col" className="px-5 py-3.5">Employee</th><th scope="col" className="px-3 py-3.5">Attendance date</th><th scope="col" className="px-3 py-3.5">Status</th><th scope="col" className="px-3 py-3.5">Punch in</th><th scope="col" className="px-3 py-3.5">Punch out</th><th scope="col" className="px-3 py-3.5 text-right">Hours</th><th scope="col" className="px-3 py-3.5 text-right">Late min</th><th scope="col" className="px-3 py-3.5 text-right">Overtime</th><th scope="col" className="px-5 py-3.5">Half day</th></tr></thead>
          <tbody>{data.items.map(record => <tr key={`${record.emp_code}-${record.date}`} className="table-row"><td className="px-5 py-3.5 font-mono text-xs font-semibold text-slate-800">{record.emp_code}</td><td className="whitespace-nowrap px-3 py-3.5 text-slate-600">{dateLabel(record.date)}</td><td className="px-3 py-3.5"><Badge value={record.status}/></td><td className="px-3 py-3.5 tabular-nums text-slate-600">{timeLabel(record.punch_in)}</td><td className="px-3 py-3.5 tabular-nums text-slate-600">{timeLabel(record.punch_out)}</td><td className="px-3 py-3.5 text-right tabular-nums">{record.work_hours ?? "—"}</td><td className="px-3 py-3.5 text-right tabular-nums">{record.late_minutes}</td><td className="px-3 py-3.5 text-right tabular-nums">{record.overtime_minutes}</td><td className="px-5 py-3.5">{record.half_day ? <span className="font-medium text-amber-700">Yes</span> : <span className="text-slate-400">No</span>}</td></tr>)}</tbody>
        </table></div>
        <Pager page={page} total={data.total} pageSize={20} onChange={setPage}/>
      </>}
    </Card>
  </div>;
}
