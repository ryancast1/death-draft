"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

const PLAYERS = [
  { seat: 1, name: "Scoot" },
  { seat: 2, name: "Brian" },
  { seat: 3, name: "Stephan" },
  { seat: 4, name: "Bee" },
  { seat: 5, name: "Ryan" },
  { seat: 6, name: "Thomas" },
];

const SIMS = 50_000;
const DEATH_PROB_PER_DAY = 0.0425;

function daysRemainingIn2026() {
  const now = new Date();
  const yearEnd = new Date("2026-12-31T23:59:59");
  return Math.max(0, Math.ceil((yearEnd.getTime() - now.getTime()) / 86_400_000));
}

function runSimulation(currentDeaths: number[]): number[] {
  const daysLeft = daysRemainingIn2026();
  const wins = new Array(6).fill(0);

  for (let s = 0; s < SIMS; s++) {
    const scores = currentDeaths.slice(); // copy

    for (let d = 0; d < daysLeft; d++) {
      if (Math.random() < DEATH_PROB_PER_DAY) {
        scores[Math.floor(Math.random() * 6)]++;
      }
    }

    // Find max score, collect tied players, pick one winner randomly
    const max = Math.max(...scores);
    const tied = [];
    for (let i = 0; i < 6; i++) {
      if (scores[i] === max) tied.push(i);
    }
    wins[tied[Math.floor(Math.random() * tied.length)]]++;
  }

  return wins.map((w) => (w / SIMS) * 100);
}

export default function OddsPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [currentDeaths, setCurrentDeaths] = useState<number[]>([]);
  const [odds, setOdds] = useState<number[]>([]);
  const [simCount, setSimCount] = useState(0);

  const load = useCallback(async () => {
    const [boardRes, deathsRes] = await Promise.all([
      supabase.from("death_draft_board").select("seat, celebrity_id"),
      supabase.from("death_draft_celebrities").select("id, died_at"),
    ]);

    if (boardRes.error) { setErr(boardRes.error.message); return; }

    // Build map: celebrity_id -> died_at
    const diedAt = new Map<string, string | null>();
    for (const c of (deathsRes.data ?? []) as { id: string; died_at: string | null }[]) {
      diedAt.set(c.id, c.died_at);
    }

    // Count deaths per seat (index = seat - 1)
    const deaths = new Array(6).fill(0);
    for (const row of (boardRes.data ?? []) as { seat: number; celebrity_id: string }[]) {
      if (diedAt.get(row.celebrity_id) != null) {
        deaths[row.seat - 1]++;
      }
    }

    setCurrentDeaths(deaths);
    const result = runSimulation(deaths);
    setOdds(result);
    setSimCount((n) => n + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setLoading(true);
      setErr(null);
      try {
        await load();
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    return () => { alive = false; };
  }, [load]);

  const rerun = () => {
    if (currentDeaths.length === 0) return;
    const result = runSimulation(currentDeaths);
    setOdds(result);
    setSimCount((n) => n + 1);
  };

  // Build sorted display list
  const ranked = useMemo(() => {
    return PLAYERS.map((p, i) => ({
      ...p,
      deaths: currentDeaths[i] ?? 0,
      odds: odds[i] ?? 0,
    })).sort((a, b) => b.odds - a.odds);
  }, [currentDeaths, odds]);

  const maxOdds = useMemo(() => Math.max(...ranked.map((r) => r.odds), 1), [ranked]);
  const daysLeft = daysRemainingIn2026();

  return (
    <main className="min-h-dvh bg-neutral-950 p-6 text-neutral-50">
      <div className="mx-auto w-full max-w-[520px]">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Current Odds</h1>
          <Link
            href="/"
            className="inline-flex h-9 items-center rounded-2xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-neutral-100"
          >
            ← Home
          </Link>
        </div>

        {err ? (
          <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {err}
          </div>
        ) : null}

        {loading ? (
          <div className="py-16 text-center text-sm text-neutral-500">Running simulation…</div>
        ) : (
          <>
            <div className="overflow-hidden rounded-2xl border border-white/10">
              {ranked.map((p, i) => (
                <div
                  key={p.seat}
                  className={
                    "px-4 py-3 " +
                    (i < ranked.length - 1 ? "border-b border-white/8" : "")
                  }
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-3">
                      <span className="w-4 text-xs text-neutral-500 tabular-nums">{i + 1}</span>
                      <span className="text-sm font-semibold text-neutral-100">{p.name}</span>
                      <span className="text-xs text-neutral-500">{p.deaths} {p.deaths === 1 ? "death" : "deaths"}</span>
                    </div>
                    <span className="text-sm font-bold tabular-nums text-neutral-100">
                      {p.odds.toFixed(1)}%
                    </span>
                  </div>
                  {/* Bar */}
                  <div className="ml-7 h-1.5 w-full rounded-full bg-white/10">
                    <div
                      className="h-1.5 rounded-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${(p.odds / maxOdds) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between">
              <div className="text-xs text-neutral-600">
                {daysLeft} days left · {SIMS.toLocaleString()} sims · {DEATH_PROB_PER_DAY * 100}% death/day
              </div>
              <button
                onClick={rerun}
                className="text-xs text-neutral-500 transition hover:text-neutral-300"
              >
                Re-run ↺
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
