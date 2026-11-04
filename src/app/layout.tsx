import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Purchasing Agent",
  description: "An agent that makes, executes and validates purchasing decisions.",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/scenarios", label: "Scenarios" },
  { href: "/runs", label: "Agent Runs" },
  { href: "/approvals", label: "Approvals" },
  { href: "/purchase-orders", label: "Purchase Orders" },
  { href: "/inventory", label: "Inventory" },
  { href: "/evaluation", label: "Evaluation" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header className="sticky top-0 z-20 border-b border-edge bg-ink/90 backdrop-blur">
            <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
              <Link href="/" className="flex items-center gap-2.5">
                <span className="grid h-7 w-7 place-items-center rounded bg-sky-500/15 text-sky-400">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 2.3A1 1 0 0 0 5.4 17H17" />
                    <circle cx="9" cy="20" r="1" /><circle cx="17" cy="20" r="1" />
                  </svg>
                </span>
                <span className="text-sm font-semibold tracking-tight text-slate-100">
                  AI Purchasing Agent
                </span>
              </Link>
              <nav className="flex flex-wrap items-center gap-1">
                {NAV.map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    className="rounded px-2.5 py-1.5 text-[13px] text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-100"
                  >
                    {n.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-[1500px] px-6 py-7">{children}</main>
        </div>
      </body>
    </html>
  );
}
