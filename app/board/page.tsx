"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

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

  const load = async () => {
    setErr(null);
    const { data, error } = await supabase
      .from("death_draft_board")
      .select("pick_number, seat, player_name, celebrity_id, celebrity_name, celebrity_age, picked_at");

    if (error) {
      setErr(error.message);
      return;
    }

    setRows((data ?? []) as BoardRow[]);
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

  return (
    <main className="min-h-dvh bg-white px-8 py-8 text-neutral-900">
      <div className="mx-auto w-full max-w-[1400px]">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Draft Board</h1>
            <div className="mt-1 text-sm text-neutral-500">
              Live board (desktop). Columns are in draft order. Sorted by age.
            </div>
          </div>
          <div className="text-sm text-neutral-500">
            {loading ? (
              "Loading…"
            ) : err ? (
              ""
            ) : (
              <div className="flex items-center gap-3">
                <div>{`${rows.length} picks`}</div>
                <div className="text-xs uppercase text-neutral-400">RT: {rtStatus}</div>
                <div className="text-xs uppercase text-neutral-400">EV: {rtEvents}</div>
              </div>
            )}
          </div>
        </div>

        {err ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Error loading board: {err}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <div className="grid min-w-[1200px] grid-cols-6 gap-8">
            {PLAYERS.map((p) => {
              const list = bySeat.get(p.seat) ?? [];
              return (
                <section key={p.seat} className="">
                  <div className="mb-2 text-center text-lg font-semibold">{p.name}</div>

                  <div className="space-y-1 text-sm">
                    {list.length === 0 ? (
                      <div className="py-2 text-center text-xs text-neutral-400">No picks yet</div>
                    ) : null}

                    {list.map((r) => (
                      <div
                        key={r.celebrity_id}
                        className="flex items-baseline justify-between gap-3 border-b border-neutral-200/70 py-1"
                      >
                        <div className="min-w-0 flex-1 truncate">{r.celebrity_name}</div>
                        <div className="w-10 shrink-0 text-right tabular-nums text-neutral-600">
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
