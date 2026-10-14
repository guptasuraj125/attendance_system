"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarDays, LayoutDashboard, Menu, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "@/components/ui";

const navigation = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, description: "A current view of employee and attendance activity." },
  { href: "/employees", label: "Employees", icon: Users, description: "Manage employee records and review the team directory." },
  { href: "/attendance", label: "Attendance", icon: CalendarDays, description: "Review attendance records and capture punch events." },
  { href: "/analytics", label: "Analytics", icon: BarChart3, description: "Explore monthly, department, and attendance trend reports." },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const current = navigation.find(item => item.href === path) || navigation[0];

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return <div className="min-h-screen">
    {open && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-slate-950/35 backdrop-blur-[1px] md:hidden" onClick={() => setOpen(false)} />}
    <aside className={`${open ? "visible translate-x-0" : "invisible -translate-x-full"} fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col border-r border-[var(--line)] bg-white transition-transform duration-200 md:visible md:translate-x-0`}>
      <div className="flex h-[76px] items-center gap-3 border-b border-[var(--line)] px-5">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--brand)] text-white shadow-sm"><span className="text-lg font-bold">H</span></div>
        <div className="min-w-0"><div className="truncate text-[15px] font-bold tracking-[-.03em]">HROne</div><div className="mt-0.5 text-[11px] font-medium text-[var(--muted)]">People operations</div></div>
        <IconButton label="Close navigation" className="ml-auto md:hidden" onClick={() => setOpen(false)}><X size={17}/></IconButton>
      </div>
      <div className="px-5 pb-2 pt-6 text-[10px] font-bold uppercase tracking-[.13em] text-slate-400">Workspace</div>
      <nav aria-label="Main navigation" className="space-y-1 px-3">
        {navigation.map(({ href, label, icon: Icon }) => {
          const selected = path === href;
          return <Link key={href} href={href} aria-current={selected ? "page" : undefined} onClick={() => setOpen(false)} className={`group flex min-h-10 items-center gap-3 rounded-lg px-3 text-[13px] transition ${selected ? "bg-[var(--brand-soft)] font-semibold text-[var(--brand-strong)]" : "font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}>
            <Icon size={17} strokeWidth={selected ? 2.2 : 1.8} aria-hidden="true"/><span>{label}</span>{selected && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--brand)]"/>}
          </Link>;
        })}
      </nav>
      <div className="mt-auto border-t border-[var(--line)] px-5 py-4"><div className="text-[10px] text-slate-400">Attendance workspace · API v2</div></div>
    </aside>

    <main className="min-h-screen min-w-0 md:ml-[260px]">
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex min-h-[76px] max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-9">
          <div className="flex min-w-0 items-center gap-3">
            <IconButton label="Open navigation" className="shrink-0 md:hidden" onClick={() => setOpen(true)}><Menu size={18}/></IconButton>
            <div className="min-w-0"><p className="truncate text-[11px] font-medium text-[var(--subtle)]">HROne / Workspace</p><h1 className="mt-0.5 truncate text-[17px] font-semibold tracking-[-.025em] sm:text-lg">{current.label}</h1><p className="hidden truncate text-xs text-[var(--muted)] sm:block lg:hidden">{current.description}</p></div>
          </div>
        </div>
        <div className="mx-auto hidden max-w-[1600px] px-6 pb-3 pl-[4.5rem] text-xs text-[var(--muted)] lg:block">{current.description}</div>
      </header>
      <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-7 lg:px-9 lg:py-8">{children}</div>
    </main>
  </div>;
}
