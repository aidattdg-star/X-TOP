// Reads a saved automation_flow and expands it into rows in execution_queue.
// Consumed by an external worker. Auth: requires user JWT (verify_jwt = true by default).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { flow_id } = await req.json();
    if (!flow_id) return json({ error: "flow_id required" }, 400);

    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: flow, error } = await supabase
      .from("automation_flows")
      .select("*")
      .eq("id", flow_id)
      .maybeSingle();
    if (error || !flow) return json({ error: "flow not found" }, 404);

    const { nodes = [], edges = [] } = (flow.react_flow_data ?? {}) as {
      nodes: Array<{ id: string; data: { kind: string; config?: Record<string, unknown> } }>;
      edges: Array<{ source: string; target: string }>;
    };

    // Build adjacency from triggers downward
    const childrenOf = new Map<string, string[]>();
    for (const e of edges) {
      const arr = childrenOf.get(e.source) ?? [];
      arr.push(e.target);
      childrenOf.set(e.source, arr);
    }

    const triggers = nodes.filter((n) => n.data?.kind?.startsWith("trigger."));
    const requestedIds: string[] = flow.account_ids ?? [];
    if (!requestedIds.length) return json({ error: "no accounts selected" }, 400);

    // Filter to accounts that actually exist & belong to the user (avoids FK violation)
    const { data: existingAccounts } = await supabase
      .from("twitter_accounts")
      .select("id")
      .in("id", requestedIds);
    const accountIds: string[] = (existingAccounts ?? []).map((a: { id: string }) => a.id);
    if (!accountIds.length) {
      return json({ error: "as contas selecionadas no fluxo não existem mais. Edite o fluxo e selecione contas válidas." }, 400);
    }
    const missing = requestedIds.filter((id) => !accountIds.includes(id));

    // Walk from each trigger and queue an entry per (action node × account).
    const rows: Array<Record<string, unknown>> = [];
    const baseTime = Date.now();
    let offsetSec = 0;

    const visit = (id: string, depth: number, seen: Set<string>) => {
      if (seen.has(id)) return;
      seen.add(id);
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      if (node.data.kind.startsWith("action.")) {
        for (const accId of accountIds) {
          offsetSec += 5 + depth * 2; // small stagger
          rows.push({
            user_id: flow.user_id,
            flow_id: flow.id,
            twitter_account_id: accId,
            action_type: node.data.kind,
            payload: { config: node.data.config ?? {}, node_id: node.id },
            scheduled_for: new Date(baseTime + offsetSec * 1000).toISOString(),
            status: "pending",
          });
        }
      }
      for (const next of childrenOf.get(id) ?? []) visit(next, depth + 1, seen);
    };

    for (const t of triggers) visit(t.id, 0, new Set());

    if (rows.length) {
      const { error: insErr } = await supabase.from("execution_queue").insert(rows);
      if (insErr) return json({ error: insErr.message }, 500);
    }

    await supabase.from("execution_logs").insert({
      user_id: flow.user_id,
      flow_id: flow.id,
      level: "info",
      message: `Flow "${flow.name}" → ${rows.length} tarefas enfileiradas${missing.length ? ` (${missing.length} conta(s) inválida(s) ignorada(s))` : ""}`,
    });

    return json({ queued: rows.length, skipped_accounts: missing.length });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
