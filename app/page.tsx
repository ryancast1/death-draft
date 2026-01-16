"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function Home() {
  const [count, setCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
      <h1 className="text-2xl font-semibold">Death Draft Shell</h1>
      <div className="mt-4 text-sm">
        {err ? `Error: ${err}` : count === null ? "Loading…" : `Celebs loaded: ${count}`}
      </div>
    </main>
  );
}