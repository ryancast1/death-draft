"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Celebrity = {
  id: string;
  name: string;
  age: number;
};

function todayStr() {
  const d = new Date();
  return d.toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
}

export default function LogDeathPage() {
  const [celebs, setCelebs] = useState<Celebrity[]>([]);
  const [pickedBy, setPickedBy] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<Celebrity | null>(null);
  const [deathDate, setDeathDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = async () => {
    const [celebsRes, boardRes] = await Promise.all([
      supabase
        .from("death_draft_celebrities")
        .select("id, name, age")
        .is("died_at", null)
        .order("age", { ascending: false })
        .order("name", { ascending: true }),
      supabase
        .from("death_draft_board")
        .select("celebrity_id, player_name"),
    ]);

    if (celebsRes.error) {
      setErr(celebsRes.error.message);
      return;
    }

    setCelebs((celebsRes.data ?? []) as Celebrity[]);

    if (!boardRes.error && boardRes.data) {
      const m = new Map<string, string>();
      for (const row of boardRes.data as { celebrity_id: string; player_name: string }[]) {
        m.set(row.celebrity_id, row.player_name);
      }
      setPickedBy(m);
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
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return celebs;
    return celebs.filter((c) => c.name.toLowerCase().includes(q));
  }, [celebs, search]);

  const openModal = (c: Celebrity) => {
    setPending(c);
    setDeathDate(todayStr());
  };

  const confirmDeath = async () => {
    if (!pending || saving) return;
    setSaving(true);
    setErr(null);

    const died_at = new Date(`${deathDate}T12:00:00Z`).toISOString();

    const { error } = await supabase
      .from("death_draft_celebrities")
      .update({ died_at })
      .eq("id", pending.id);

    if (error) {
      setErr(error.message);
      setSaving(false);
      return;
    }

    const name = pending.name;
    setPending(null);
    setSaving(false);
    setSearch("");
    setSuccessMsg(`${name} has been marked as deceased.`);
    await load();
  };

  return (
    <main className="min-h-dvh bg-neutral-950 p-6 text-neutral-50">
      <div className="mx-auto w-full max-w-[520px]">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Log a Death</h1>
          <Link
            href="/"
            className="inline-flex h-9 items-center rounded-2xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-neutral-100"
          >
            ← Home
          </Link>
        </div>

        {successMsg ? (
          <div className="mb-4 rounded-2xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
            {successMsg}
            <button className="ml-3 underline" onClick={() => setSuccessMsg(null)}>
              Dismiss
            </button>
          </div>
        ) : null}

        {err ? (
          <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {err}
          </div>
        ) : null}

        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-4 w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-neutral-50 placeholder-neutral-500 outline-none focus:border-white/30"
        />

        {loading ? (
          <div className="py-16 text-center text-sm text-neutral-500">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-neutral-500">
            {search ? "No matches." : "No living celebrities in the list."}
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((c) => {
              const owner = pickedBy.get(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => openModal(c)}
                  className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:bg-white/10 active:scale-[0.99]"
                >
                  <div>
                    <div className="text-sm font-semibold text-neutral-100">{c.name}</div>
                    <div className="text-xs text-neutral-400">
                      Age {c.age}
                      {owner ? <span className="ml-2 text-neutral-500">· {owner}</span> : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-sm font-medium text-red-400">Mark dead</div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirm modal */}
      {pending ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => { if (!saving) setPending(null); }}
          />
          <div className="relative mx-4 w-full max-w-[420px] rounded-3xl border border-white/15 bg-neutral-900 p-6 shadow-2xl">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Confirm death
            </div>
            <div className="mt-1 text-xl font-bold text-neutral-50">{pending.name}</div>
            <div className="mt-0.5 text-sm text-neutral-400">
              Age {pending.age}
              {pickedBy.get(pending.id) ? (
                <span className="ml-2 text-neutral-500">· {pickedBy.get(pending.id)}</span>
              ) : null}
            </div>

            <div className="mt-4">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Date of death
              </label>
              <input
                type="date"
                value={deathDate}
                onChange={(e) => setDeathDate(e.target.value)}
                max={todayStr()}
                className="w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-neutral-50 outline-none focus:border-white/30"
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={saving}
                className="h-12 rounded-2xl border border-white/15 bg-white/10 text-sm font-semibold text-neutral-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeath}
                disabled={saving || !deathDate}
                className="h-12 rounded-2xl bg-red-500 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Mark as Deceased"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
