import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" };
export function Button({ children, variant = "primary", className = "", ...props }: ButtonProps) {
  const style = variant === "primary"
    ? "bg-[var(--brand)] text-white shadow-sm hover:bg-[var(--brand-strong)]"
    : variant === "secondary"
      ? "border border-[var(--line)] bg-white text-slate-700 shadow-sm hover:bg-slate-50"
      : "text-slate-600 hover:bg-slate-100";
  return <button {...props} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition disabled:opacity-50 ${style} ${className}`}>{children}</button>;
}

export function IconButton({ label, children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button {...props} aria-label={label} title={label} className={`inline-grid h-9 w-9 place-items-center rounded-lg border border-[var(--line)] bg-white text-slate-600 transition hover:bg-slate-50 ${className}`}>{children}</button>;
}

export function Card({ title, subtitle, children, action, className = "", bodyClassName = "" }: { title?: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode; className?: string; bodyClassName?: string }) {
  return <section className={`surface min-w-0 ${className}`}>
    {(title || subtitle || action) && <div className="surface-header flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
      <div className="min-w-0">{title && <h2 className="text-sm font-semibold tracking-[-.01em] text-[var(--ink)]">{title}</h2>}{subtitle && <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{subtitle}</p>}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>}
    <div className={`p-5 sm:p-6 ${bodyClassName}`}>{children}</div>
  </section>;
}

export function PageIntro({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0">{eyebrow && <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[.12em] text-[var(--brand)]">{eyebrow}</p>}<h2 className="text-xl font-semibold tracking-[-.035em] text-[var(--ink)] sm:text-2xl">{title}</h2>{description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--muted)]">{description}</p>}</div>
    {action && <div className="shrink-0">{action}</div>}
  </div>;
}

export function StatCard({ label, value, note, icon, tone = "green" }: { label: string; value: React.ReactNode; note?: string; icon: React.ReactNode; tone?: "green" | "blue" | "amber" | "slate" }) {
  const tones = { green: "bg-emerald-50 text-emerald-700", blue: "bg-blue-50 text-blue-700", amber: "bg-amber-50 text-amber-700", slate: "bg-slate-100 text-slate-600" };
  return <div className="surface min-w-0 p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><p className="text-xs font-medium text-[var(--muted)] sm:text-sm">{label}</p><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${tones[tone]}`}>{icon}</span></div><div className="mt-3 text-2xl font-semibold tracking-[-.04em] text-[var(--ink)] sm:text-[28px]">{value}</div>{note && <p className="mt-1 text-xs text-[var(--subtle)]">{note}</p>}</div>;
}

export function Field({ label, hint, error, required, className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = props.id || props.name;
  return <label className={`block min-w-0 text-sm ${className}`} htmlFor={id}>
    <span className="mb-1.5 block font-medium text-slate-700">{label}{required && <span className="ml-1 text-rose-600" aria-hidden="true">*</span>}</span>
    <input {...props} id={id} required={required} aria-invalid={error ? true : props["aria-invalid"]} className={`field-control ${error ? "border-rose-400" : ""}`} />
    {error ? <span className="mt-1 block text-xs text-rose-700">{error}</span> : hint ? <span className="mt-1 block text-xs text-[var(--subtle)]">{hint}</span> : null}
  </label>;
}

export function SelectField({ label, children, hint, className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string }) {
  const id = props.id || props.name;
  return <label className={`block min-w-0 text-sm ${className}`} htmlFor={id}>
    <span className="mb-1.5 block font-medium text-slate-700">{label}</span>
    <select {...props} id={id} className="field-control">{children}</select>
    {hint && <span className="mt-1 block text-xs text-[var(--subtle)]">{hint}</span>}
  </label>;
}

export function Notice({ children, retry, tone = "empty", title }: { children: React.ReactNode; retry?: () => void; tone?: "empty" | "error" | "info"; title?: string }) {
  const iconClass = tone === "error" ? "bg-rose-50 text-rose-600" : tone === "info" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500";
  return <div className="flex min-h-40 flex-col items-center justify-center px-4 py-8 text-center">
    <span className={`mb-3 grid h-10 w-10 place-items-center rounded-full ${iconClass}`}><AlertCircle size={18} aria-hidden="true" /></span>
    {title && <h3 className="text-sm font-semibold text-[var(--ink)]">{title}</h3>}
    <div className="mt-1 max-w-md text-sm leading-6 text-[var(--muted)]">{children}</div>
    {retry && <Button variant="secondary" onClick={retry} className="mt-4"><RefreshCw size={14} aria-hidden="true"/>Try again</Button>}
  </div>;
}

export function Loading({ label = "Loading data" }: { label?: string }) {
  return <div role="status" aria-live="polite" className="space-y-3 py-2"><span className="sr-only">{label}</span>{[0, 1, 2, 3].map(i => <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />)}<div className="flex items-center justify-center gap-2 pt-1 text-xs text-[var(--muted)]"><LoaderCircle className="animate-spin" size={14}/>{label}</div></div>;
}

export function Pager({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-4 py-3 text-xs text-[var(--muted)] sm:px-5"><span>{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : "0 records"}</span><div className="flex gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)} className="min-h-8 px-3 py-1 text-xs">Previous</Button><span className="inline-flex items-center px-1" aria-current="page">{page} / {pages}</span><Button variant="secondary" disabled={page >= pages} onClick={() => onChange(page + 1)} className="min-h-8 px-3 py-1 text-xs">Next</Button></div></div>;
}

export function Badge({ value }: { value: string }) {
  const cls = value === "PRESENT" || value === "WFH" || value === "ON_DUTY" ? "bg-emerald-50 text-emerald-800 ring-emerald-700/10" : value === "LEAVE" ? "bg-blue-50 text-blue-800 ring-blue-700/10" : value === "ABSENT" ? "bg-rose-50 text-rose-800 ring-rose-700/10" : "bg-slate-100 text-slate-700 ring-slate-600/10";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${cls}`}>{value.replaceAll("_", " ")}</span>;
}
