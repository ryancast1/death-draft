"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Tile = {
  href: string;
  title: string;
  subtitle?: string;
};

export default function Home() {
  const [count, setCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const tiles = useMemo<Tile[]>(
    () => [
      { href: "/board", title: "Draft Board", subtitle: "Screen-share view" },
      { href: "/pick/1", title: "Scoot" },
      { href: "/pick/2", title: "Brian" },
      { href: "/pick/3", title: "Stephan" },
      { href: "/pick/4", title: "Bee" },
      { href: "/pick/5", title: "Ryan" },
      { href: "/pick/6", title: "Thomas" },
    ],
    []
  );

  useEffect(() => {
    (async () => {
      const { count, error } = await supabase
        .from("death_draft_celebrities")
        .select("*", { count: "exact", head: true });

      if (error) setErr(error.message);
      else setCount(count ?? 0);
    })();
  }, []);

  return (
    <main className="min-h-dvh p-6">
      <div className="mx-auto w-full max-w-[520px]">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            Celebrity Death Draft
          </h1>
          <div className="mt-1 text-sm text-neutral-600">
            {err
              ? `DB error: ${err}`
              : count === null
              ? "Loading celebs…"
              : `${count} celebs loaded`}
          </div>
        </div>

        <div className="space-y-3">
          {tiles.map((t, i) => (
            <Link
              key={t.href}
              href={t.href}
              className={
                i === 0
                  ? "flex h-20 w-full items-center justify-between rounded-3xl border border-neutral-200 bg-neutral-900 px-5 text-white shadow-sm transition active:scale-[0.99]"
                  : "flex h-16 w-full items-center justify-between rounded-3xl border border-neutral-200 bg-white px-5 text-neutral-900 shadow-sm transition active:scale-[0.99]"
              }
            >
              <div className="min-w-0">
                <div
                  className={
                    i === 0
                      ? "text-xl font-semibold tracking-tight"
                      : "text-lg font-semibold tracking-tight"
                  }
                >
                  {t.title}
                </div>
                {t.subtitle ? (
                  <div className={i === 0 ? "mt-0.5 text-sm text-white/70" : "mt-0.5 text-sm text-neutral-500"}>
                    {t.subtitle}
                  </div>
                ) : null}
              </div>
              <div className={i === 0 ? "text-white/60" : "text-neutral-400"}>›</div>
            </Link>
          ))}
        </div>

        <div className="mt-6 text-xs text-neutral-500">
          Draft order: Scoot → Brian → Stephan → Bee → Ryan → Thomas
        </div>
      </div>
    </main>
  );
}