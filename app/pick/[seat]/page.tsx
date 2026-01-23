"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Player = { seat: number; name: string };

type DraftState = {
  id: number;
  turn_seat: number;
  pick_number: number;
  updated_at: string;
};

type AvailableCelebrity = {
  id: string;
  name: string;
  age: number;
  created_at: string;
};

const PLAYERS: Player[] = [
  { seat: 1, name: "Scoot" },
  { seat: 2, name: "Brian" },
  { seat: 3, name: "Stephan" },
  { seat: 4, name: "Bee" },
  { seat: 5, name: "Ryan" },
  { seat: 6, name: "Thomas" },
];

function seatToName(seat: number) {
  return PLAYERS.find((p) => p.seat === seat)?.name ?? `Seat ${seat}`;
}

export default function PickPage() {
  const params = useParams<{ seat: string }>();
  const router = useRouter();

  const seat = Number(params.seat);
  const isValidSeat = Number.isFinite(seat) && seat >= 1 && seat <= 6;

  const [state, setState] = useState<DraftState | null>(null);
  const [available, setAvailable] = useState<AvailableCelebrity[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [pendingPick, setPendingPick] = useState<AvailableCelebrity | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rtStatus, setRtStatus] = useState<string>("connecting");
  const [rtEvents, setRtEvents] = useState<number>(0);
  const [rtLast, setRtLast] = useState<string>("");

  const myName = useMemo(() => (isValidSeat ? seatToName(seat) : "Unknown"), [isValidSeat, seat]);
  const turnSeat = state?.turn_seat ?? null;
  const isMyTurn = isValidSeat && turnSeat === seat;

  const liveLabel = useMemo(() => {
    if (rtStatus === "subscribed") return "Live";
    if (rtStatus === "channel_error") return "Not Live - Refresh";
    return "Connecting";
  }, [rtStatus]);

  const loadState = async () => {
    const { data, error } = await supabase
      .from("death_draft_state")
      .select("id, turn_seat, pick_number, updated_at")
      .eq("id", 1)
      .single();

    if (error) throw error;
    setState(data as DraftState);
  };

  const loadAvailable = async () => {
    const { data, error } = await supabase
      .from("death_draft_available")
      .select("id, name, age, created_at")
      .order("age", { ascending: false })
      .order("name", { ascending: true });

    if (error) throw error;
    setAvailable((data ?? []) as AvailableCelebrity[]);
  };

  const loadAll = async () => {
    setErr(null);
    await Promise.all([loadState(), loadAvailable()]);
  };

  useEffect(() => {
    if (!isValidSeat) return;

    let alive = true;

    const run = async () => {
      setLoading(true);
      try {
        await loadAll();
      } catch (e: any) {
        if (alive) setErr(e?.message ?? "Failed to load.");
      } finally {
        if (alive) setLoading(false);
      }
    };

    void run();

    // Live updates: state changes (turn) + picks changes (availability)
    setRtStatus("connecting");
    const channel = supabase
      .channel(`death-draft-pick-seat-${seat}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "death_draft_state",
          filter: "id=eq.1",
        },
        (payload) => {
          const next = payload.new as any;
          if (next?.id === 1) {
            setState({
              id: next.id,
              turn_seat: next.turn_seat,
              pick_number: next.pick_number,
              updated_at: next.updated_at,
            });
            setRtEvents((n) => n + 1);
            setRtLast(new Date().toLocaleTimeString());
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "death_draft_picks" },
        () => {
          setRtEvents((n) => n + 1);
          setRtLast(new Date().toLocaleTimeString());
          void loadAvailable().catch(() => {
            /* ignore transient */
          });
        }
      )
      .subscribe((status) => {
        if (!alive) return;
        // statuses include: 'SUBSCRIBED', 'TIMED_OUT', 'CLOSED', 'CHANNEL_ERROR'
        setRtStatus(String(status).toLowerCase());
      });

    // Auto-refresh when returning to tab (handles stale connections)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && alive) {
        // Refresh data when user returns to the tab
        void loadAll().catch(() => {});
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      alive = false;
      void supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isValidSeat, seat]);

  const onPick = (c: AvailableCelebrity) => {
    if (!isValidSeat) return;
    if (!isMyTurn) return;
    if (pickingId) return;

    setErr(null);
    setPendingPick(c);
  };

  const confirmPick = async () => {
    if (!isValidSeat) return;
    if (!isMyTurn) return;
    if (!pendingPick) return;
    if (pickingId) return;

    setErr(null);
    setPickingId(pendingPick.id);

    try {
      const { data, error } = await supabase.rpc("death_draft_make_pick", {
        p_seat: seat,
        p_celebrity_id: pendingPick.id,
      });

      if (error) throw error;

      const res = Array.isArray(data) ? data[0] : data;
      if (!res?.ok) {
        throw new Error(res?.message ?? "Pick failed.");
      }

      // Close confirm sheet
      setPendingPick(null);

      // Optimistic refresh (realtime will also handle it)
      await loadAll();

      // Tiny haptic (iOS)
      try {
        navigator.vibrate?.(40);
      } catch {
        // ignore
      }
    } catch (e: any) {
      setErr(e?.message ?? "Pick failed.");
    } finally {
      setPickingId(null);
    }
  };

  const handleRefresh = async () => {
    setErr(null);
    setLoading(true);
    try {
      await loadAll();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to refresh.");
    } finally {
      setLoading(false);
    }
  };

  if (!isValidSeat) {
    return (
      <main className="min-h-dvh bg-white p-6 text-neutral-900">
        <div className="mx-auto max-w-md">
          <h1 className="text-2xl font-semibold">Invalid seat</h1>
          <p className="mt-2 text-sm text-neutral-600">
            This page expects a seat from 1 to 6.
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex items-center rounded-2xl border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold"
          >
            Back to Home
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-50">
      {/* Sticky header for mobile */}
      <div className="sticky top-0 z-10 border-b border-white/10 bg-neutral-950/85 backdrop-blur">
        <div className="mx-auto w-full max-w-[720px] px-4 pb-3 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Picker
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">{myName}</h1>
              <div className="mt-1 text-sm text-neutral-300">
                {turnSeat === null
                  ? "Loading turn…"
                  : `Current turn: ${seatToName(turnSeat)}`}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleRefresh}
                disabled={loading}
                className="mt-1 inline-flex items-center rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-neutral-100 active:scale-[0.99] disabled:opacity-50"
                title="Refresh"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                onClick={() => router.push("/")}
                className="mt-1 inline-flex items-center rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-neutral-100 active:scale-[0.99]"
              >
                Home
              </button>
            </div>
          </div>

          {/* Turn banner */}
          <div
            className={
              isMyTurn
                ? "mt-4 rounded-3xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3"
                : "mt-4 rounded-3xl border border-white/10 bg-white/5 px-4 py-3"
            }
          >
            <div
              className={
                isMyTurn
                  ? "text-2xl font-extrabold tracking-tight text-emerald-200"
                  : "text-2xl font-extrabold tracking-tight text-neutral-200"
              }
            >
              {isMyTurn ? "YOUR TURN" : "Not your turn"}
            </div>
          </div>

          {/* Status line */}
          <div className="mt-3 flex items-center justify-between text-xs text-neutral-400">
            <div>{loading ? "Loading…" : `${available.length} available`}</div>
            <div className="flex items-center gap-3">
              <div className="uppercase">{liveLabel}</div>
              <div>{state ? `Pick #${state.pick_number + 1}` : ""}</div>
            </div>
          </div>

          {err ? (
            <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {err}
            </div>
          ) : null}
        </div>
      </div>

      {/* List */}
      <div className="mx-auto w-full max-w-[720px] px-4 pb-10 pt-3">
        <div className="space-y-2">
          {available.map((c) => {
            const disabled = !isMyTurn || !!pickingId;
            const isThis = pickingId === c.id;

            return (
              <button
                key={c.id}
                onClick={() => onPick(c)}
                disabled={disabled}
                className={
                  "flex w-full items-center justify-between gap-3 rounded-3xl border px-4 py-3 text-left transition active:scale-[0.99] " +
                  (disabled
                    ? "border-white/10 bg-white/5 text-neutral-100 opacity-60"
                    : "border-white/10 bg-white/5 text-neutral-100 hover:bg-white/10")
                }
              >
                <div className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {c.name}
                  <span className="ml-2 text-xs font-semibold text-neutral-400 tabular-nums">
                    {c.age}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {isThis ? (
                    <div className="text-xs font-semibold text-emerald-700">Picking…</div>
                  ) : null}
                  <div
                    className={
                      "rounded-2xl px-3 py-1.5 text-xs font-semibold " +
                      (disabled
                        ? "bg-white/10 text-neutral-400"
                        : "bg-emerald-500/20 text-emerald-200 border border-emerald-400/20")
                    }
                  >
                    Pick
                  </div>
                </div>
              </button>
            );
          })}

          {!loading && available.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-center text-sm text-neutral-400">
              Draft Complete!
            </div>
          ) : null}
        </div>
      </div>

      {/* Confirm Pick Bottom Sheet */}
      {pendingPick ? (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => (pickingId ? null : setPendingPick(null))}
          />
          <div className="absolute bottom-0 left-0 right-0 mx-auto w-full max-w-[720px] rounded-t-3xl border border-white/10 bg-neutral-950 p-4 shadow-2xl">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Confirm pick
            </div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-neutral-50">
              {pendingPick.name}
            </div>
            <div className="mt-1 text-sm text-neutral-300">Age {pendingPick.age}</div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                className="h-12 rounded-2xl border border-white/10 bg-white/5 text-neutral-100 text-sm font-semibold active:scale-[0.99]"
                onClick={() => setPendingPick(null)}
                disabled={!!pickingId}
              >
                Cancel
              </button>
              <button
                type="button"
                className="h-12 rounded-2xl bg-emerald-500/20 border border-emerald-400/20 text-emerald-200 text-sm font-semibold active:scale-[0.99] disabled:opacity-60"
                onClick={confirmPick}
                disabled={!isMyTurn || !!pickingId}
              >
                {pickingId ? "Picking…" : "Confirm"}
              </button>
            </div>

            {!isMyTurn ? (
              <div className="mt-3 text-xs text-neutral-500">
                Not your turn.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}