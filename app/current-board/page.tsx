"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import html2canvas from "html2canvas";

type Player = { seat: number; name: string };

type BoardRow = {
  pick_number: number;
  seat: number;
  player_name: string;
  celebrity_id: string;
  celebrity_name: string;
  celebrity_age: number;
  picked_at: string;
};

type CelebDeath = { id: string; died_at: string | null };

const PLAYERS: Player[] = [
  { seat: 1, name: "Scoot" },
  { seat: 2, name: "Brian" },
  { seat: 3, name: "Stephan" },
  { seat: 4, name: "Bee" },
  { seat: 5, name: "Ryan" },
  { seat: 6, name: "Thomas" },
];

export default function CurrentBoardPage() {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [deaths, setDeaths] = useState<Map<string, string | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setErr(null);

    const [boardRes, deathsRes] = await Promise.all([
      supabase
        .from("death_draft_board")
        .select("pick_number, seat, player_name, celebrity_id, celebrity_name, celebrity_age, picked_at"),
      supabase
        .from("death_draft_celebrities")
        .select("id, died_at"),
    ]);

    if (boardRes.error) {
      setErr(boardRes.error.message);
      return;
    }

    setRows((boardRes.data ?? []) as BoardRow[]);

    if (!deathsRes.error && deathsRes.data) {
      const m = new Map<string, string | null>();
      for (const c of deathsRes.data as CelebDeath[]) {
        m.set(c.id, c.died_at);
      }
      setDeaths(m);
    }
  };

  useEffect(() => {
    let alive = true;

    const run = async () => {
      setLoading(true);
      try {
        await load();
      } finally {
        if (alive) setLoading(false);
      }
    };

    void run();

    const channel = supabase
      .channel("death-draft-current-board")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "death_draft_picks" }, () => {
        void load();
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "death_draft_picks" }, () => {
        void load();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "death_draft_picks" }, () => {
        void load();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "death_draft_celebrities" }, () => {
        void load();
      })
      .subscribe();

    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bySeat = useMemo(() => {
    const m = new Map<number, BoardRow[]>();
    for (const p of PLAYERS) m.set(p.seat, []);

    for (const r of rows) {
      if (!m.has(r.seat)) m.set(r.seat, []);
      m.get(r.seat)!.push(r);
    }

    for (const [seat, list] of m.entries()) {
      list.sort((a, b) => {
        if (b.celebrity_age !== a.celebrity_age) return b.celebrity_age - a.celebrity_age;
        return a.celebrity_name.localeCompare(b.celebrity_name);
      });
      m.set(seat, list);
    }

    return m;
  }, [rows]);

  // Score = number of dead picks per player
  const scoresBySeat = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of PLAYERS) m.set(p.seat, 0);
    for (const r of rows) {
      if (deaths.get(r.celebrity_id) != null) {
        m.set(r.seat, (m.get(r.seat) ?? 0) + 1);
      }
    }
    return m;
  }, [rows, deaths]);

  const totalDeaths = useMemo(() => {
    let n = 0;
    for (const r of rows) {
      if (deaths.get(r.celebrity_id) != null) n++;
    }
    return n;
  }, [rows, deaths]);

  const exportImage = async () => {
    if (!exportRef.current) return;
    try {
      const canvas = await html2canvas(exportRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        logging: false,
      });
      canvas.toBlob(
        (blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
          a.href = url;
          a.download = `death-draft-board-${stamp}.jpg`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        },
        "image/jpeg",
        0.92
      );
    } catch (error) {
      console.error("Failed to export image:", error);
    }
  };

  return (
    <main className="min-h-dvh bg-white px-8 py-4 text-neutral-900">
      <div className="mx-auto w-full max-w-[1400px]">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">10th Annual Celebrity Death Draft — 2026</h1>
            {!loading && !err && (
              <div className="mt-1 flex items-center gap-4 text-sm text-neutral-600">
                <div>{rows.length} picks</div>
                <div className="font-medium text-blue-600">{totalDeaths} deaths</div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportImage}
              className="inline-flex h-9 items-center rounded-2xl border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-900 shadow-sm transition active:scale-[0.99]"
            >
              Export Image
            </button>
            <Link
              href="/"
              className="inline-flex h-9 items-center rounded-2xl border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-900 shadow-sm"
            >
              ← Home
            </Link>
          </div>
        </div>

        {err ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Error loading board: {err}
          </div>
        ) : loading ? (
          <div className="py-16 text-center text-sm text-neutral-400">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="max-h-[calc(100vh-120px)] overflow-y-auto pb-16">
              <div className="grid min-w-[1200px] grid-cols-6 gap-8">
                {PLAYERS.map((p) => {
                  const list = bySeat.get(p.seat) ?? [];
                  const score = scoresBySeat.get(p.seat) ?? 0;
                  return (
                    <section key={p.seat}>
                      <div className="sticky top-0 z-10 border-b border-neutral-200 bg-white/95 py-2 text-center backdrop-blur">
                        <div className="text-base font-semibold">{p.name}</div>
                        {score > 0 ? (
                          <div className="text-xs font-semibold text-blue-600">
                            {score} {score === 1 ? "death" : "deaths"}
                          </div>
                        ) : (
                          <div className="text-xs text-neutral-400">0 deaths</div>
                        )}
                      </div>

                      <div className="pr-1 text-sm">
                        {list.length === 0 ? (
                          <div className="py-2 text-center text-xs text-neutral-400">No picks yet</div>
                        ) : null}

                        {list.map((r) => {
                          const isDead = deaths.get(r.celebrity_id) != null;
                          return (
                            <div
                              key={r.celebrity_id}
                              className={
                                "flex items-center justify-between gap-2 py-0.5 leading-tight " +
                                (isDead
                                  ? "bg-blue-500 text-white rounded px-1 -mx-1 my-[1px]"
                                  : "border-b border-neutral-200/60")
                              }
                            >
                              <div className="min-w-0 flex-1 truncate text-[13px]">
                                {r.celebrity_name}
                              </div>
                              <div
                                className={
                                  "w-9 shrink-0 text-right tabular-nums text-[12px] " +
                                  (isDead ? "text-white/80" : "text-neutral-500")
                                }
                              >
                                {r.celebrity_age}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Hidden offscreen board for image export — auto height so nothing is cut off */}
      <div
        ref={exportRef}
        style={{
          position: 'fixed',
          left: '-9999px',
          top: '0',
          backgroundColor: '#ffffff',
          padding: '24px 40px 30px',
          width: '1800px',
          color: '#171717',
          boxSizing: 'border-box',
        }}
      >
        <div style={{
          textAlign: 'center',
          marginBottom: '12px',
        }}>
          <div style={{
            fontSize: '24px',
            fontWeight: '600',
            letterSpacing: '-0.025em',
            color: '#171717',
          }}>
            10th Annual Celebrity Death Draft — 2026
          </div>
          <div style={{
            fontSize: '13px',
            color: '#3b82f6',
            fontWeight: '600',
            marginTop: '2px',
          }}>
            {totalDeaths} {totalDeaths === 1 ? 'death' : 'deaths'}
          </div>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
          gap: '20px',
        }}>
          {PLAYERS.map((p) => {
            const list = bySeat.get(p.seat) ?? [];
            const score = scoresBySeat.get(p.seat) ?? 0;
            return (
              <section key={p.seat}>
                <div style={{
                  textAlign: 'center',
                  borderBottom: '2px solid #171717',
                  paddingBottom: '4px',
                  marginBottom: '4px',
                }}>
                  <div style={{ fontSize: '15px', fontWeight: '600', color: '#171717', lineHeight: '20px' }}>
                    {p.name}
                  </div>
                  <div style={{
                    fontSize: '11px',
                    fontWeight: '600',
                    color: score > 0 ? '#3b82f6' : '#a3a3a3',
                    lineHeight: '14px',
                  }}>
                    {score} {score === 1 ? 'death' : 'deaths'}
                  </div>
                </div>

                {list.map((r) => {
                  const isDead = deaths.get(r.celebrity_id) != null;
                  return (
                    <div
                      key={r.celebrity_id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '6px',
                        fontSize: '13px',
                        lineHeight: '22px',
                        ...(isDead
                          ? {
                              backgroundColor: '#3b82f6',
                              color: '#ffffff',
                              borderRadius: '3px',
                              padding: '1px 6px',
                              margin: '1px 0',
                            }
                          : {
                              borderBottom: '1px solid #e5e5e5',
                              padding: '1px 0',
                              color: '#171717',
                            }),
                      }}
                    >
                      <div style={{
                        minWidth: '0',
                        flex: '1',
                        whiteSpace: 'nowrap',
                      }}>
                        {r.celebrity_name}
                      </div>
                      <div style={{
                        width: '28px',
                        flexShrink: 0,
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        fontSize: '12px',
                        color: isDead ? 'rgba(255,255,255,0.8)' : '#525252',
                      }}>
                        {r.celebrity_age}
                      </div>
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
