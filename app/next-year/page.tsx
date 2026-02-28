"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type NextYearName = { id: string; name: string; created_at: string };

export default function NextYearPage() {
  const [names, setNames] = useState<NextYearName[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase
      .from("death_draft_next_year")
      .select("id, name, created_at")
      .order("name", { ascending: true });

    if (error) {
      setErr(error.message);
      return;
    }
    setNames((data ?? []) as NextYearName[]);
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

  const addName = async () => {
    const trimmed = input.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    setErr(null);

    const { error } = await supabase
      .from("death_draft_next_year")
      .insert({ name: trimmed });

    if (error) {
      setErr(error.message);
      setSaving(false);
      return;
    }

    setInput("");
    setSaving(false);
    await load();
  };

  const deleteName = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    setErr(null);

    const { error } = await supabase
      .from("death_draft_next_year")
      .delete()
      .eq("id", id);

    if (error) {
      setErr(error.message);
    } else {
      setNames((prev) => prev.filter((n) => n.id !== id));
    }
    setDeletingId(null);
  };

  return (
    <main className="min-h-dvh bg-neutral-950 p-6 text-neutral-50">
      <div className="mx-auto w-full max-w-[520px]">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Add To Next Year's List</h1>
          <Link
            href="/"
            className="inline-flex h-9 items-center rounded-2xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-neutral-100"
          >
            ← Home
          </Link>
        </div>

        <div className="mb-4 flex gap-2">
          <input
            type="text"
            placeholder="Add a name…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void addName(); }}
            className="flex-1 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-neutral-50 placeholder-neutral-500 outline-none focus:border-white/30"
          />
          <button
            onClick={addName}
            disabled={saving || !input.trim()}
            className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-neutral-900 transition disabled:opacity-30"
          >
            {saving ? "Adding…" : "Add"}
          </button>
        </div>

        {err ? (
          <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {err}
          </div>
        ) : null}

        {loading ? (
          <div className="py-16 text-center text-sm text-neutral-500">Loading…</div>
        ) : names.length === 0 ? (
          <div className="py-12 text-center text-sm text-neutral-500">No names yet. Add one above.</div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/10">
            {names.map((n, i) => (
              <div
                key={n.id}
                className={
                  "flex items-center px-4 py-3 " +
                  (i < names.length - 1 ? "border-b border-white/8" : "")
                }
              >
                <span className="flex-1 text-sm font-medium text-neutral-100">{n.name}</span>
                <button
                  onClick={() => deleteName(n.id)}
                  disabled={deletingId === n.id}
                  className="ml-3 shrink-0 text-xs text-neutral-500 transition hover:text-red-400 disabled:opacity-40"
                >
                  {deletingId === n.id ? "…" : "Remove"}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 text-right text-xs text-neutral-600">
          {names.length} {names.length === 1 ? "name" : "names"}
        </div>
      </div>
    </main>
  );
}
