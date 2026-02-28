"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

const PLAYERS = [
  { seat: 1, name: "Scoot",   color: "#3b82f6" },
  { seat: 2, name: "Brian",   color: "#22c55e" },
  { seat: 3, name: "Stephan", color: "#f97316" },
  { seat: 4, name: "Bee",     color: "#ec4899" },
  { seat: 5, name: "Ryan",    color: "#a855f7" },
  { seat: 6, name: "Thomas",  color: "#eab308" },
];

const SIMS = 200_000;
const DEATH_PROB_PER_DAY = 0.0425;

// Empirical death age distribution from 109 historical draft deaths
const DEATH_AGE_POOL = [
  64, 66, 67, 71,
  74, 74,
  75, 75, 75, 75, 75,
  76, 76, 76, 76, 76,
  78, 78, 78, 78, 78,
  79, 79,
  80, 80, 80,
  81, 81, 81, 81, 81,
  82, 82,
  83, 83,
  84, 84, 84, 84,
  85,
  86, 86, 86, 86, 86,
  87, 87, 87,
  88, 88, 88, 88, 88, 88, 88,
  89, 89,
  90, 90, 90, 90, 90, 90, 90, 90, 90,
  91, 91, 91, 91,
  92, 92, 92, 92, 92, 92, 92, 92,
  93, 93, 93,
  94, 94, 94, 94, 94, 94,
  95, 95, 95, 95, 95, 95, 95,
  96, 96, 96,
  97, 97,
  98, 98, 98,
  99, 99, 99, 99,
  100, 100,
  103,
]; // 109 entries

function sampleDeathAge(): number {
  return DEATH_AGE_POOL[Math.floor(Math.random() * DEATH_AGE_POOL.length)];
}

function daysRemainingIn2026(): number {
  const now = new Date();
  const yearEnd = new Date("2026-12-31T23:59:59Z");
  return Math.max(0, Math.ceil((yearEnd.getTime() - now.getTime()) / 86_400_000));
}

function dayOfYear(dateStr: string): number {
  const d = new Date(dateStr + "T12:00:00Z");
  const jan1 = new Date("2026-01-01T12:00:00Z");
  return Math.round((d.getTime() - jan1.getTime()) / 86_400_000);
}

function daysFromDateToYearEnd(dateStr: string): number {
  const d = new Date(dateStr + "T12:00:00Z");
  const dec31 = new Date("2026-12-31T23:59:59Z");
  return Math.max(0, Math.ceil((dec31.getTime() - d.getTime()) / 86_400_000));
}

// realAgeSums: sum of actual ages at death for each player's confirmed deaths
// Simulated future deaths sampled from empirical distribution for tiebreaker
function runSimulation(
  currentDeaths: number[],
  realAgeSums: number[],
  daysLeft: number,
  numSims = SIMS,
): number[] {
  const wins = new Array(6).fill(0);

  for (let s = 0; s < numSims; s++) {
    const scores = currentDeaths.slice();
    const ageSums = realAgeSums.slice();

    for (let d = 0; d < daysLeft; d++) {
      if (Math.random() < DEATH_PROB_PER_DAY) {
        const i = Math.floor(Math.random() * 6);
        scores[i]++;
        ageSums[i] += sampleDeathAge();
      }
    }

    // Primary: highest death count wins
    const max = Math.max(...scores);
    const tied: number[] = [];
    for (let i = 0; i < 6; i++) {
      if (scores[i] === max) tied.push(i);
    }

    if (tied.length === 1) {
      wins[tied[0]]++;
    } else {
      // Tiebreaker: lowest average age at death wins
      let minAvg = Infinity;
      for (const i of tied) {
        const avg = scores[i] > 0 ? ageSums[i] / scores[i] : Infinity;
        if (avg < minAvg) minAvg = avg;
      }
      const best = tied.filter((i) => {
        const avg = scores[i] > 0 ? ageSums[i] / scores[i] : Infinity;
        return Math.abs(avg - minAvg) < 0.0001;
      });
      wins[best[Math.floor(Math.random() * best.length)]]++;
    }
  }

  return wins.map((w) => (w / numSims) * 100);
}

type CelebData = { died_at: string | null; age: number | null };
type BoardRow = { seat: number; celebrity_id: string };
type HistoryRow = { date: string; odds: number[] };

// SVG chart constants
const SVG_W = 520, SVG_H = 220;
const PAD_L = 36, PAD_R = 12, PAD_T = 12, PAD_B = 24;
const CHART_W = SVG_W - PAD_L - PAD_R;
const CHART_H = SVG_H - PAD_T - PAD_B;

function dayToX(day: number) { return PAD_L + (day / 364) * CHART_W; }
function pctToY(pct: number) { return PAD_T + CHART_H - (pct / 100) * CHART_H; }

const MONTHS = [
  { day: 0,   label: "Jan" },
  { day: 31,  label: "Feb" },
  { day: 59,  label: "Mar" },
  { day: 90,  label: "Apr" },
  { day: 120, label: "May" },
  { day: 151, label: "Jun" },
  { day: 181, label: "Jul" },
  { day: 212, label: "Aug" },
  { day: 243, label: "Sep" },
  { day: 273, label: "Oct" },
  { day: 304, label: "Nov" },
  { day: 334, label: "Dec" },
];

export default function OddsPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [currentDeaths, setCurrentDeaths] = useState<number[]>([]);
  const [realAgeSums, setRealAgeSums] = useState<number[]>([]);
  const [odds, setOdds] = useState<number[]>([]);

  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyProgress, setHistoryProgress] = useState<{ done: number; total: number } | null>(null);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);

  // Refs so recalculate can re-run history without re-fetching board data
  const celebMapRef = useRef<Map<string, CelebData>>(new Map());
  const boardDataRef = useRef<BoardRow[]>([]);

  const runHistory = async (
    celebMap: Map<string, CelebData>,
    boardData: BoardRow[],
    alive: () => boolean,
  ) => {
    setHistoryLoading(true);
    setHistoryProgress(null);

    const histRes = await supabase
      .from("death_draft_odds_history")
      .select("sim_date, odds");
    if (!alive()) return;

    const cachedRows = (histRes.data ?? []) as { sim_date: string; odds: number[] }[];
    const cached = new Set(cachedRows.map((r) => r.sim_date));
    const existing: HistoryRow[] = cachedRows.map((r) => ({ date: r.sim_date, odds: r.odds }));
    setHistoryRows(existing);

    // Find missing dates: Jan 1 2026 → yesterday
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const missing: string[] = [];
    const cursor = new Date("2026-01-01T00:00:00Z");
    while (cursor < today) {
      const str = cursor.toISOString().slice(0, 10);
      if (!cached.has(str)) missing.push(str);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    if (missing.length > 0) {
      setHistoryProgress({ done: 0, total: missing.length });
      const newRows: { sim_date: string; odds: number[]; deaths: number[] }[] = [];

      for (let i = 0; i < missing.length; i++) {
        if (!alive()) return;
        const dateStr = missing[i];

        // Deaths as of this date
        const d = new Array(6).fill(0);
        const a = new Array(6).fill(0);
        for (const row of boardData) {
          const celeb = celebMap.get(row.celebrity_id);
          if (celeb?.died_at != null && celeb.died_at.slice(0, 10) <= dateStr) {
            const idx = row.seat - 1;
            d[idx]++;
            a[idx] += celeb.age ?? 87;
          }
        }

        const dLeft = daysFromDateToYearEnd(dateStr);
        const simOdds = runSimulation(d, a, dLeft);
        newRows.push({ sim_date: dateStr, odds: simOdds.map(Math.round), deaths: d });

        if (alive()) setHistoryProgress({ done: i + 1, total: missing.length });
        await new Promise((r) => setTimeout(r, 0)); // yield to browser
      }

      if (!alive()) return;
      await supabase.from("death_draft_odds_history").upsert(newRows);

      setHistoryRows((prev) => {
        const map = new Map(prev.map((r) => [r.date, r]));
        for (const r of newRows) map.set(r.sim_date, { date: r.sim_date, odds: r.odds });
        return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
      });
    }

    if (alive()) {
      setHistoryProgress(null);
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    let isAlive = true;
    const alive = () => isAlive;

    const run = async () => {
      setLoading(true);
      setHistoryLoading(true);
      setErr(null);

      try {
        const [boardRes, celebsRes] = await Promise.all([
          supabase.from("death_draft_board").select("seat, celebrity_id"),
          supabase.from("death_draft_celebrities").select("id, age, died_at"),
        ]);
        if (!alive()) return;
        if (boardRes.error) {
          setErr(boardRes.error.message);
          setLoading(false);
          setHistoryLoading(false);
          return;
        }

        const celebMap = new Map<string, CelebData>();
        for (const c of (celebsRes.data ?? []) as { id: string; age: number | null; died_at: string | null }[]) {
          celebMap.set(c.id, { died_at: c.died_at, age: c.age });
        }
        const boardData = (boardRes.data ?? []) as BoardRow[];

        // Store for recalculate
        celebMapRef.current = celebMap;
        boardDataRef.current = boardData;

        // Current odds (fast — renders rankings immediately)
        const deaths = new Array(6).fill(0);
        const ageSums = new Array(6).fill(0);
        for (const row of boardData) {
          const celeb = celebMap.get(row.celebrity_id);
          if (celeb?.died_at != null) {
            const idx = row.seat - 1;
            deaths[idx]++;
            ageSums[idx] += celeb.age ?? 87;
          }
        }
        const result = runSimulation(deaths, ageSums, daysRemainingIn2026());
        if (!alive()) return;
        setCurrentDeaths(deaths);
        setRealAgeSums(ageSums);
        setOdds(result);
        setLoading(false); // rankings visible now

        // History backfill (may take several seconds on first run)
        await runHistory(celebMap, boardData, alive);
      } catch (e) {
        if (alive()) {
          setErr(String(e));
          setLoading(false);
          setHistoryLoading(false);
        }
      }
    };

    void run();
    return () => { isAlive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rerun = () => {
    if (currentDeaths.length === 0) return;
    const result = runSimulation(currentDeaths, realAgeSums, daysRemainingIn2026());
    setOdds(result);
  };

  const recalculate = async () => {
    await supabase
      .from("death_draft_odds_history")
      .delete()
      .gte("sim_date", "2026-01-01");
    setHistoryRows([]);
    let isAlive = true;
    await runHistory(celebMapRef.current, boardDataRef.current, () => isAlive);
  };

  const ranked = useMemo(() => {
    return PLAYERS.map((p, i) => ({
      ...p,
      deaths: currentDeaths[i] ?? 0,
      odds: odds[i] ?? 0,
    })).sort((a, b) => b.odds - a.odds);
  }, [currentDeaths, odds]);

  const maxOdds = useMemo(() => Math.max(...ranked.map((r) => r.odds), 1), [ranked]);
  const daysLeft = daysRemainingIn2026();

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayDay = dayOfYear(todayStr);
  const todayX = dayToX(todayDay);

  // Combine history rows + today's live result for the chart
  const allChartRows = useMemo(() => {
    const todayRow: HistoryRow = { date: todayStr, odds: odds.map(Math.round) };
    const rows = historyRows.filter((r) => r.date !== todayStr);
    return [...rows, todayRow].sort((a, b) => a.date.localeCompare(b.date));
  }, [historyRows, odds, todayStr]);

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
            {/* Rankings */}
            <div className="overflow-hidden rounded-2xl border border-white/10">
              {ranked.map((p, i) => (
                <div
                  key={p.seat}
                  className={"px-4 py-3 " + (i < ranked.length - 1 ? "border-b border-white/8" : "")}
                >
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="w-4 text-xs text-neutral-500 tabular-nums">{i + 1}</span>
                      <span className="text-sm font-semibold text-neutral-100">{p.name}</span>
                      <span className="text-xs text-neutral-500">
                        {p.deaths} {p.deaths === 1 ? "death" : "deaths"}
                      </span>
                    </div>
                    <span className="text-sm font-bold tabular-nums text-neutral-100">
                      {Math.round(p.odds)}%
                    </span>
                  </div>
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

            {/* History chart */}
            <div className="mt-8">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-neutral-300">Win Probability — 2026</h2>
                {!historyLoading && (
                  <button
                    onClick={recalculate}
                    className="text-xs text-neutral-600 transition hover:text-neutral-400"
                  >
                    Recalculate ↺
                  </button>
                )}
              </div>

              {historyLoading ? (
                <div className="flex h-[220px] items-center justify-center rounded-2xl border border-white/10">
                  <div className="text-center text-sm text-neutral-500">
                    {historyProgress
                      ? `Building chart… (${historyProgress.done} / ${historyProgress.total} days)`
                      : "Loading…"}
                  </div>
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/40 p-2">
                  <svg
                    viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                    width="100%"
                    style={{ display: "block" }}
                  >
                    {/* Y gridlines + labels */}
                    {[0, 25, 50, 75, 100].map((pct) => {
                      const y = pctToY(pct);
                      return (
                        <g key={pct}>
                          <line
                            x1={PAD_L} y1={y} x2={SVG_W - PAD_R} y2={y}
                            stroke="rgba(255,255,255,0.06)" strokeWidth="1"
                          />
                          <text
                            x={PAD_L - 4} y={y + 4}
                            textAnchor="end" fontSize="9" fill="rgba(255,255,255,0.3)"
                          >
                            {pct}%
                          </text>
                        </g>
                      );
                    })}

                    {/* X month ticks + labels */}
                    {MONTHS.map(({ day, label }) => {
                      const x = dayToX(day);
                      return (
                        <g key={label + day}>
                          <line
                            x1={x} y1={PAD_T} x2={x} y2={PAD_T + CHART_H}
                            stroke="rgba(255,255,255,0.04)" strokeWidth="1"
                          />
                          <text
                            x={x} y={SVG_H - PAD_B + 13}
                            textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.25)"
                          >
                            {label}
                          </text>
                        </g>
                      );
                    })}

                    {/* Today marker */}
                    <line
                      x1={todayX} y1={PAD_T} x2={todayX} y2={PAD_T + CHART_H}
                      stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="3 3"
                    />

                    {/* Player lines */}
                    {PLAYERS.map((p, playerIdx) => {
                      const points = allChartRows
                        .map((row) => {
                          const x = dayToX(dayOfYear(row.date));
                          const y = pctToY(row.odds[playerIdx] ?? 0);
                          return `${x.toFixed(1)},${y.toFixed(1)}`;
                        })
                        .join(" ");
                      return (
                        <polyline
                          key={p.seat}
                          points={points}
                          fill="none"
                          stroke={p.color}
                          strokeWidth="1.5"
                          strokeLinejoin="round"
                          strokeLinecap="round"
                          opacity="0.85"
                        />
                      );
                    })}
                  </svg>

                  {/* Legend */}
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 px-2 pb-1">
                    {PLAYERS.map((p) => (
                      <div key={p.seat} className="flex items-center gap-1.5">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                        <span className="text-xs text-neutral-400">{p.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
