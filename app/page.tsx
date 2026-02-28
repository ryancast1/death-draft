"use client";

import Link from "next/link";

const TILES = [
  { href: "/current-board", title: "Current Board" },
  { href: "/log-death", title: "Log a Death" },
  { href: "/next-year", title: "Add to Next Year's List" },
  { href: "/odds", title: "Current Odds" },
  { href: "/draft", title: "Draft" },
];

export default function Home() {
  return (
    <main className="min-h-dvh p-6">
      <div className="mx-auto w-full max-w-[520px]">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            Celebrity Death Draft
          </h1>
          <div className="mt-1 text-sm text-neutral-400">10th Annual — 2026</div>
        </div>

        <div className="space-y-3">
          {TILES.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="flex h-16 w-full items-center justify-center rounded-3xl border border-neutral-700 bg-neutral-900 px-5 text-white shadow-sm transition active:scale-[0.99]"
            >
              <div className="text-lg font-semibold tracking-tight">{t.title}</div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
