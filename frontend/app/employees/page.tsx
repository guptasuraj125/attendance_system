"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Ellipsis, Plus, Search, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Employee, Page } from "@/lib/types";
import { dateLabel } from "@/lib/utils";
import { Button, Card, Field, Loading, Notice, PageIntro, Pager, SelectField } from "@/components/ui";

const blank = { emp_code: "", name: "", email: "", department: "", shift_start: "09:30", shift_end: "18:30", joined_on: "" };

export default function Employees() {
  const [data, setData] = useState<Page<Employee> | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [department, setDepartment] = useState("");
  const [departmentDraft, setDepartmentDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const [openActions, setOpenActions] = useState<string | null>(null);
  const [removeEmployee, setRemoveEmployee] = useState<Employee | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.employees(1, 100, department).then(async first => {
      const pageCount = Math.ceil(first.total / first.page_size);
      const remaining = await Promise.all(Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => api.employees(index + 2, 100, department)));
      setData({ ...first, items: [...first.items, ...remaining.flatMap(result => result.items)] });
    }).catch(reason => setError(reason.message || "Unable to load employees. Please check that the API is running and try again.")).finally(() => setLoading(false));
  }, [department]);

  useEffect(() => { load(); }, [load]);

  const filteredEmployees = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return data?.items ?? [];
    return (data?.items ?? []).filter(employee => [employee.emp_code, employee.name, employee.email, employee.department]
      .some(value => value.toLocaleLowerCase().includes(query)));
  }, [data, search]);
  const visibleEmployees = filteredEmployees.slice((page - 1) * pageSize, page * pageSize);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    if (form.shift_start === form.shift_end) { setMessageError(true); setMessage("Shift start and end times must differ."); return; }
    setSaving(true); setMessage(""); setMessageError(false);
    try {
      await api.createEmployee(form);
      setModal(false); setForm(blank); setPage(1); setSearch(""); setDepartment(""); setDepartmentDraft(""); setMessage("Employee created successfully.");
      if (page === 1 && !department) load();
    } catch (reason) {
      setMessageError(true);
      setMessage(reason instanceof ApiError ? `${reason.message}${reason.status === 409 ? " Try a different employee code." : ""}` : "Unable to create employee.");
    } finally { setSaving(false); }
  };

  const confirmRemove = async () => {
    if (!removeEmployee || removing) return;
    setRemoving(true); setMessage(""); setMessageError(false);
    try {
      await api.removeEmployee(removeEmployee.emp_code);
      setMessage(`${removeEmployee.name} was removed from the active directory. Attendance history is retained.`);
      setRemoveEmployee(null); setOpenActions(null); load();
    } catch (reason) {
      setMessageError(true);
      setMessage(reason instanceof ApiError ? reason.message : "Unable to remove this employee.");
    } finally { setRemoving(false); }
  };

  return <div className="space-y-5 sm:space-y-6">
    <PageIntro eyebrow="People" title="Employee directory" description={error ? "The employee list could not be refreshed." : data ? `${data.total.toLocaleString()} employee${data.total === 1 ? "" : "s"} in the directory. Profile records are managed through the attendance API.` : "Browse employee records and work shifts."} action={<Button onClick={() => { setMessage(""); setMessageError(false); setModal(true); }}><Plus size={16}/>Add employee</Button>}/>

    {message && !modal && <div role={messageError ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${messageError ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{message}</div>}

    <Card title="Employee records" subtitle="Profile details, department, and assigned work shifts." action={<Button variant="secondary" type="button" disabled={loading} onClick={load}>Refresh</Button>} bodyClassName="p-0">
      <form onSubmit={event => { event.preventDefault(); setDepartment(departmentDraft.trim()); setPage(1); }} className="flex flex-col gap-3 border-b border-[var(--line)] bg-slate-50/70 p-4 sm:flex-row sm:items-end sm:px-5">
        <Field label="Department" placeholder="Exact department name" value={departmentDraft} onChange={event => setDepartmentDraft(event.target.value)} className="w-full sm:max-w-xs"/>
        <div className="flex gap-2"><Button><Search size={15}/>Apply filter</Button>{(department || departmentDraft) && <Button variant="secondary" type="button" onClick={() => { setDepartmentDraft(""); setDepartment(""); setPage(1); }}>Reset</Button>}</div>
      </form>
      <div className="grid gap-3 border-b border-[var(--line)] p-4 sm:grid-cols-[minmax(240px,1fr)_minmax(150px,auto)_auto] sm:items-end sm:px-5">
        <Field label="Search employees" name="employee-search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Search code, name, email, or department" type="search"/>
        <SelectField label="Rows per page" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={10}>10 employees</option><option value={20}>20 employees</option><option value={50}>50 employees</option></SelectField>
        <p className="pb-2 text-xs text-[var(--muted)]" aria-live="polite">{search ? `${filteredEmployees.length} matching employee${filteredEmployees.length === 1 ? "" : "s"}` : `${data?.total ?? 0} employee${data?.total === 1 ? "" : "s"}`}</p>
      </div>
      {loading ? <div className="p-5"><Loading label="Loading employees"/></div> : error ? <Notice tone="error" title="Unable to load employees" retry={load}>{error}</Notice> : !filteredEmployees.length ? <Notice title={search ? "No employees match your search" : department ? "No employees match this department" : "No employees yet"}>{search ? "Try another employee code, name, email, or department." : department ? "Try changing or clearing the department filter." : "Add an employee to start building your directory."}</Notice> : <>
        <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm">
          <thead className="table-head text-[11px] font-semibold uppercase tracking-wide"><tr><th scope="col" className="px-5 py-3.5">Employee</th><th scope="col" className="px-4 py-3.5">Email</th><th scope="col" className="px-4 py-3.5">Department</th><th scope="col" className="px-4 py-3.5">Shift</th><th scope="col" className="px-4 py-3.5">Joined</th><th scope="col" className="px-4 py-3.5 text-right">Actions</th></tr></thead>
          <tbody>{visibleEmployees.map(employee => <tr key={employee.emp_code} className="table-row"><td className="px-5 py-3.5"><div className="font-semibold text-slate-800">{employee.name}</div><code className="mt-0.5 inline-block font-mono text-[11px] text-[var(--muted)]">{employee.emp_code}</code></td><td className="px-4 py-3.5 text-slate-600">{employee.email}</td><td className="px-4 py-3.5"><span className="inline-flex rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{employee.department}</span></td><td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-slate-600">{employee.shift_start}–{employee.shift_end}</td><td className="whitespace-nowrap px-4 py-3.5 text-slate-600">{dateLabel(employee.joined_on)}</td><td className="relative px-4 py-3.5 text-right"><button type="button" aria-label={`Actions for ${employee.emp_code}`} aria-haspopup="menu" aria-expanded={openActions === employee.emp_code} onClick={() => setOpenActions(openActions === employee.emp_code ? null : employee.emp_code)} className="inline-grid h-9 w-9 place-items-center rounded-lg border border-[var(--line)] bg-white text-slate-600 hover:bg-slate-50"><Ellipsis size={18}/></button>{openActions === employee.emp_code && <div role="menu" aria-label={`${employee.emp_code} actions`} className="absolute right-4 top-12 z-20 w-48 rounded-xl border border-[var(--line)] bg-white p-1.5 text-left shadow-xl"><button role="menuitem" type="button" onClick={() => { setRemoveEmployee(employee); setOpenActions(null); }} className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-rose-700 hover:bg-rose-50">Remove employee</button></div>}</td></tr>)}</tbody>
        </table></div>
        <Pager page={page} total={filteredEmployees.length} pageSize={pageSize} onChange={setPage}/>
      </>}
    </Card>

    {removeEmployee && <div role="presentation" className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/40 p-3 backdrop-blur-[2px] sm:p-6" onMouseDown={event => { if (event.target === event.currentTarget && !removing) setRemoveEmployee(null); }}>
      <section role="alertdialog" aria-modal="true" aria-labelledby="remove-employee-title" aria-describedby="remove-employee-description" className="my-auto w-full max-w-md rounded-2xl border border-white/70 bg-white shadow-2xl">
        <div className="px-5 pt-5 sm:px-6"><h2 id="remove-employee-title" className="text-base font-semibold">Remove {removeEmployee.name}?</h2><p id="remove-employee-description" className="mt-2 text-sm leading-6 text-[var(--muted)]">They will disappear from the active employee directory. Their employee record and attendance history will be retained.</p></div>
        {messageError && <p role="alert" className="mx-5 mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800 sm:mx-6">{message}</p>}
        <div className="flex flex-col-reverse justify-end gap-2 p-5 sm:flex-row sm:px-6"><Button variant="secondary" type="button" disabled={removing} onClick={() => setRemoveEmployee(null)}>Cancel</Button><Button type="button" disabled={removing} onClick={confirmRemove} className="bg-rose-700 hover:bg-rose-800">{removing ? "Removing…" : "Remove employee"}</Button></div>
      </section>
    </div>}

    {modal && <div role="presentation" className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/40 p-3 backdrop-blur-[2px] sm:p-6" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setModal(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="add-employee-title" tabIndex={-1} onKeyDown={event => {
        if (event.key === "Escape" && !saving) setModal(false);
        if (event.key === "Tab") { const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button,input,select")); const first = focusable[0], last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
      }} className="my-auto w-full max-w-2xl rounded-2xl border border-white/70 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4 sm:px-6"><div><h2 id="add-employee-title" className="text-base font-semibold">Add employee</h2><p className="mt-1 text-xs text-[var(--muted)]">Required fields are marked with an asterisk.</p></div><button type="button" aria-label="Close dialog" disabled={saving} onClick={() => setModal(false)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100"><X size={18}/></button></div>
        <form onSubmit={submit} className="grid gap-x-4 gap-y-4 p-5 sm:grid-cols-2 sm:p-6">
          <Field label="Employee code" name="emp_code" autoFocus required placeholder="EMP0001" value={form.emp_code} onChange={event => setForm({ ...form, emp_code: event.target.value })} pattern="EMP[0-9]{4,6}" hint="EMP followed by 4–6 digits." maxLength={9}/>
          <Field label="Full name" name="name" required placeholder="Employee name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} maxLength={100}/>
          <Field label="Email address" name="email" type="email" required placeholder="name@company.com" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} maxLength={120}/>
          <Field label="Department" name="department" required placeholder="People Operations" value={form.department} onChange={event => setForm({ ...form, department: event.target.value })} maxLength={50}/>
          <Field label="Shift starts" name="shift_start" type="time" required value={form.shift_start} onChange={event => setForm({ ...form, shift_start: event.target.value })}/>
          <Field label="Shift ends" name="shift_end" type="time" required value={form.shift_end} onChange={event => setForm({ ...form, shift_end: event.target.value })}/>
          <Field label="Joined on" name="joined_on" type="date" required value={form.joined_on} onChange={event => setForm({ ...form, joined_on: event.target.value })} className="sm:col-span-2"/>
          {messageError && <div role="alert" className="sm:col-span-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">{message}</div>}
          <div className="sm:col-span-2 flex flex-col-reverse justify-end gap-2 border-t border-slate-100 pt-4 sm:flex-row"><Button variant="secondary" type="button" disabled={saving} onClick={() => setModal(false)}>Cancel</Button><Button disabled={saving}>{saving ? "Saving…" : "Create employee"}</Button></div>
        </form>
      </section>
    </div>}
  </div>;
}
