"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import html2canvas from "html2canvas";

type Player = {
  seat: number;
  name: string;
};

type BoardRow = {
  pick_number: number;
  seat: number;
  player_name: string;
  celebrity_id: string;
  celebrity_name: string;
  celebrity_age: number;
  picked_at: string;
};

const PLAYERS: Player[] = [
  { seat: 1, name: "Scoot" },
  { seat: 2, name: "Brian" },
  { seat: 3, name: "Stephan" },
  { seat: 4, name: "Bee" },
  { seat: 5, name: "Ryan" },
  { seat: 6, name: "Thomas" },
];

export default function BoardPage() {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rtStatus, setRtStatus] = useState<string>("connecting");
  const [rtEvents, setRtEvents] = useState<number>(0);
  const [turnSeat, setTurnSeat] = useState<number | null>(null);
  const [totalCelebrities, setTotalCelebrities] = useState<number>(0);
  const boardImageRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setErr(null);

    const [boardRes, stateRes, countRes] = await Promise.all([
      supabase
        .from("death_draft_board")
        .select(
          "pick_number, seat, player_name, celebrity_id, celebrity_name, celebrity_age, picked_at"
        ),
      supabase
        .from("death_draft_state")
        .select("turn_seat")
        .eq("id", 1)
        .single(),
      supabase
        .from("death_draft_celebrities")
        .select("*", { count: "exact", head: true }),
    ]);

    if (boardRes.error) {
      setErr(boardRes.error.message);
      return;
    }

    setRows((boardRes.data ?? []) as BoardRow[]);

    if (!stateRes.error && stateRes.data) {
      setTurnSeat((stateRes.data as any).turn_seat ?? null);
    }

    if (!countRes.error && countRes.count !== null) {
      setTotalCelebrities(countRes.count);
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

    setRtStatus("connecting");

    const channel = supabase
      .channel("death-draft-board")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "death_draft_picks" },
        async (payload) => {
          try {
            const nextPick = payload.new as any;
            // Fetch the joined row from the view (so we have name + age)
            const { data, error } = await supabase
              .from("death_draft_board")
              .select(
                "pick_number, seat, player_name, celebrity_id, celebrity_name, celebrity_age, picked_at"
              )
              .eq("pick_number", nextPick.pick_number)
              .single();

            if (error || !data) return;

            setRows((prev) => {
              // Avoid duplicates if the event fires twice
              if (prev.some((r) => r.pick_number === (data as any).pick_number)) return prev;
              return [...prev, data as BoardRow];
            });
            setRtEvents((n) => n + 1);
          } catch {
            // If anything goes wrong, fall back to full reload
            void load();
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "death_draft_picks" },
        (payload) => {
          const oldRow = payload.old as any;
          setRows((prev) => prev.filter((r) => r.celebrity_id !== oldRow.celebrity_id));
          setRtEvents((n) => n + 1);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "death_draft_picks" },
        () => {
          // Updates are rare; easiest correct behavior is refetch.
          void load();
          setRtEvents((n) => n + 1);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "death_draft_state", filter: "id=eq.1" },
        (payload) => {
          const next = payload.new as any;
          setTurnSeat(next?.turn_seat ?? null);
          setRtEvents((n) => n + 1);
        }
      )
      .subscribe((status) => {
        setRtStatus(String(status).toLowerCase());
      });

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

    // Sort within each seat by age (desc), tie-break by name.
    for (const [seat, list] of m.entries()) {
      list.sort((a, b) => {
        if (b.celebrity_age !== a.celebrity_age) return b.celebrity_age - a.celebrity_age;
        return a.celebrity_name.localeCompare(b.celebrity_name);
      });
      m.set(seat, list);
    }

    return m;
  }, [rows]);

  const lastPickNumber = useMemo(() => {
    if (rows.length === 0) return null;
    return rows.reduce((max, r) => (r.pick_number > max ? r.pick_number : max), rows[0].pick_number);
  }, [rows]);

  const liveLabel = useMemo(() => {
    if (rtStatus === "subscribed") return "Live";
    if (rtStatus === "channel_error") return "Not Live - Refresh";
    return "Connecting";
  }, [rtStatus]);

  const roundNumber = useMemo(() => {
    const numPicks = rows.length;
    return Math.max(1, Math.ceil(numPicks / 6));
  }, [rows.length]);

  const percentComplete = useMemo(() => {
    if (totalCelebrities === 0) return 0;
    return Math.round((rows.length / totalCelebrities) * 100);
  }, [rows.length, totalCelebrities]);

  const exportBoardCsv = () => {
    // Build per-seat lists in the same order as the UI
    const lists: Record<number, BoardRow[]> = {};
    for (const p of PLAYERS) {
      const l = (bySeat.get(p.seat) ?? []).slice();
      // bySeat is already sorted, but keep it explicit
      l.sort((a, b) => {
        if (b.celebrity_age !== a.celebrity_age) return b.celebrity_age - a.celebrity_age;
        return a.celebrity_name.localeCompare(b.celebrity_name);
      });
      lists[p.seat] = l;
    }

    const maxLen = Math.max(0, ...PLAYERS.map((p) => lists[p.seat].length));

    const headers: string[] = [];
    for (const p of PLAYERS) {
      headers.push(p.name);
      headers.push(`${p.name} Age`);
    }

    const escape = (v: string) => {
      // CSV escaping: wrap in quotes if needed and double internal quotes
      if (/[\n\r,\"]/g.test(v)) return `"${v.replace(/\"/g, '""')}"`;
      return v;
    };

    const lines: string[] = [];
    lines.push(headers.map(escape).join(","));

    for (let i = 0; i < maxLen; i++) {
      const row: string[] = [];
      for (const p of PLAYERS) {
        const item = lists[p.seat][i];
        row.push(item ? item.celebrity_name : "");
        row.push(item ? String(item.celebrity_age) : "");
      }
      lines.push(row.map(escape).join(","));
    }

    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.href = url;
    a.download = `death-draft-board-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const exportBoardImage = async () => {
    if (!boardImageRef.current) return;

    try {
      // Capture at actual size first
      const canvas = await html2canvas(boardImageRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        logging: false,
        ignoreElements: (element) => {
          return false;
        },
        onclone: (clonedDoc) => {
          const clonedElement = clonedDoc.querySelector('[data-export-board]');
          if (clonedElement) {
            (clonedElement as HTMLElement).style.color = '#171717';
          }
        },
      });

      // Create a new canvas with fixed 1920x1080 dimensions
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = 1920 * 2; // 2x for retina
      finalCanvas.height = 1080 * 2; // 2x for retina
      const ctx = finalCanvas.getContext('2d');

      if (ctx) {
        // Fill with white background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);

        // Calculate scaling to fit the content within 1920x1080
        const scaleX = finalCanvas.width / canvas.width;
        const scaleY = finalCanvas.height / canvas.height;
        const scale = Math.min(scaleX, scaleY);

        // Calculate centered position
        const scaledWidth = canvas.width * scale;
        const scaledHeight = canvas.height * scale;
        const x = (finalCanvas.width - scaledWidth) / 2;
        const y = (finalCanvas.height - scaledHeight) / 2;

        // Draw the scaled image centered
        ctx.drawImage(canvas, x, y, scaledWidth, scaledHeight);
      }

      finalCanvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        a.href = url;
        a.download = `death-draft-board-${stamp}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      });
    } catch (error) {
      console.error("Failed to export image:", error);
    }
  };

  return (
    <main className="min-h-dvh bg-white px-8 py-4 text-neutral-900">
      <div className="mx-auto w-full max-w-[1400px]">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">10th Annual Celebrity Death Draft - 2026</h1>
            {!loading && !err && (
              <div className="mt-1 flex items-center gap-4 text-sm text-neutral-600">
                <div>Round {roundNumber}</div>
                <div>{percentComplete}% Complete</div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportBoardCsv}
              className="inline-flex h-9 items-center rounded-2xl border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-900 shadow-sm transition active:scale-[0.99]"
            >
              Export CSV
            </button>

            <button
              type="button"
              onClick={exportBoardImage}
              className="inline-flex h-9 items-center rounded-2xl border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-900 shadow-sm transition active:scale-[0.99]"
            >
              Export Image
            </button>

            <div className="text-sm text-neutral-500">
              {loading ? (
                "Loading…"
              ) : err ? (
                ""
              ) : (
                <div className="flex items-center gap-3">
                  <div>{`${rows.length} picks`}</div>
                  <div className="text-xs uppercase text-neutral-400">{liveLabel}</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {err ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Error loading board: {err}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <div className="max-h-[calc(100vh-120px)] overflow-y-auto pb-64">
            <div className="grid min-w-[1200px] grid-cols-6 gap-8">
              {PLAYERS.map((p) => {
                const list = bySeat.get(p.seat) ?? [];
                return (
                  <section key={p.seat} className="">
                    <div
                      className={
                        "sticky top-0 z-10 backdrop-blur py-2 text-center text-base font-semibold border-b " +
                        (turnSeat === p.seat
                          ? "bg-amber-100 border-amber-200 text-neutral-900"
                          : "bg-white/95 border-neutral-200 text-neutral-900")
                      }
                    >
                      {p.name}
                      {turnSeat === p.seat ? (
                        <span className="ml-2 rounded-full bg-amber-300/70 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide">
                          UP
                        </span>
                      ) : null}
                    </div>

                    <div className="pr-1 text-sm">
                      {list.length === 0 ? (
                        <div className="py-2 text-center text-xs text-neutral-400">No picks yet</div>
                      ) : null}

                      {list.map((r) => (
                        <div
                          key={r.celebrity_id}
                          className={
                            "flex items-center justify-between gap-2 border-b border-neutral-200/60 py-0.5 leading-tight " +
                            (lastPickNumber !== null && r.pick_number === lastPickNumber
                              ? "relative font-semibold text-[14px] after:content-[''] after:pointer-events-none after:absolute after:inset-y-0 after:-inset-x-1 after:rounded after:border after:border-neutral-300"
                              : "")
                          }
                        >
                          <div
                            className={
                              "min-w-0 flex-1 truncate " +
                              (lastPickNumber !== null && r.pick_number === lastPickNumber ? "text-[14px]" : "text-[13px]")
                            }
                          >
                            {r.celebrity_name}
                          </div>
                          <div
                            className={
                              "w-9 shrink-0 text-right tabular-nums " +
                              (lastPickNumber !== null && r.pick_number === lastPickNumber
                                ? "text-neutral-900 text-[13px]"
                                : "text-neutral-600 text-[12px]")
                            }
                          >
                            {r.celebrity_age}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </div>

        {/* Hidden board for image export */}
        <div
          ref={boardImageRef}
          data-export-board
          style={{
            position: 'fixed',
            left: '-9999px',
            top: '0',
            backgroundColor: '#ffffff',
            padding: '40px 50px',
            width: '1820px',
            height: '1000px',
            color: '#171717',
            boxSizing: 'border-box',
          }}
        >
          <h1 style={{
            fontSize: '32px',
            fontWeight: '600',
            letterSpacing: '-0.025em',
            textAlign: 'center',
            marginBottom: '30px',
            color: '#171717',
          }}>
            10th Annual Celebrity Death Draft
          </h1>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: '20px',
            height: 'calc(100% - 90px)',
          }}>
            {PLAYERS.map((p) => {
              const list = bySeat.get(p.seat) ?? [];
              return (
                <section key={p.seat} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div style={{
                    backgroundColor: '#ffffff',
                    padding: '8px 0',
                    textAlign: 'center',
                    fontSize: '18px',
                    fontWeight: '600',
                    borderBottom: '2px solid #171717',
                    color: '#171717',
                    marginBottom: '10px',
                    flexShrink: 0,
                  }}>
                    {p.name}
                  </div>

                  <div style={{ paddingRight: '4px', fontSize: '14px', flex: '1', overflow: 'auto' }}>
                    {list.map((r) => (
                      <div
                        key={r.celebrity_id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          borderBottom: '1px solid #e5e5e5',
                          padding: '5px 0',
                          lineHeight: '1.3',
                        }}
                      >
                        <div style={{
                          minWidth: '0',
                          flex: '1',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontSize: '14px',
                          color: '#171717',
                        }}>
                          {r.celebrity_name}
                        </div>
                        <div style={{
                          width: '32px',
                          flexShrink: '0',
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                          color: '#525252',
                          fontSize: '13px',
                        }}>
                          {r.celebrity_age}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}
