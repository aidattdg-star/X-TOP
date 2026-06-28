import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  ConnectionLineType,
  MarkerType,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  ReactFlowProvider,
} from "reactflow";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { nodeTypes, NODE_LIBRARY, type NodeKind, getNodeMeta } from "./nodes";
import { edgeTypes } from "./edges";
import { PropertiesPanel } from "./properties-panel";
import { TestNodeDialog } from "./test-node-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Save, Plus, Clock, FileText, Users, Search, Dice5, Check } from "lucide-react";
import { cn } from "@/lib/utils";

let nodeIdCounter = 1;
const genId = () => `n${Date.now()}_${nodeIdCounter++}`;

// ---- Agenda humanizada: conversões minutos <-> cron base ----
function minutesToCron(mins: number): string {
  const m = Math.max(1, Math.round(mins));
  if (m % 1440 === 0) return `0 0 */${m / 1440} * *`;
  if (m % 60 === 0) return `0 */${m / 60} * * *`;
  return `*/${m} * * * *`;
}
function cronToMinutes(expr: string): number {
  const e = (expr || "").trim();
  let m;
  if ((m = e.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/))) return Math.max(1, +m[1]);
  if ((m = e.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/))) return Math.max(1, +m[1]) * 60;
  if ((m = e.match(/^0\s+0\s+\*\/(\d+)\s+\*\s+\*$/))) return Math.max(1, +m[1]) * 1440;
  if (e === "0 * * * *") return 60;
  if (e === "0 0 * * *") return 1440;
  return 60;
}
// Formata minutos em texto humano (ex.: 90 -> "1 h 30 min").
function humanMinutes(mins: number): string {
  const m = Math.max(1, Math.round(mins));
  if (m < 60) return `${m} min`;
  if (m % 60 === 0) return `${m / 60} h`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

const SCHEDULE_PRESETS = [
  { label: "Rápido", min: 1, max: 3 },
  { label: "Ágil", min: 5, max: 15 },
  { label: "Normal", min: 15, max: 45 },
  { label: "Calmo", min: 60, max: 180 },
  { label: "Lento", min: 240, max: 720 },
];

const DEFAULT_EDGE_OPTIONS = {
  type: "deletable",
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "oklch(0.45 0.01 90)" },
} as const;


export function FlowBuilder({ flowId }: { flowId?: string }) {
  return (
    <ReactFlowProvider>
      <BuilderInner flowId={flowId} />
    </ReactFlowProvider>
  );
}

function BuilderInner({ flowId }: { flowId?: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("Novo fluxo");
  const [description, setDescription] = useState("");
  const [interval, setInterval] = useState("0 */1 * * *");
  // Agenda humanizada: faixa aleatória (min–max). Guardada em minutos.
  const [schedMin, setSchedMin] = useState(15);
  const [schedMax, setSchedMax] = useState(45);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [testNodeId, setTestNodeId] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);

  const openTest = useCallback((id: string) => {
    setTestNodeId(id);
    setTestOpen(true);
  }, []);

  // Inject onTest callback into every node's data so the hover button works.
  const nodesWithTest = useMemo(
    () => nodes.map((n) => ({ ...n, data: { ...n.data, onTest: openTest } })),
    [nodes, openTest],
  );

  // Load accounts for the selector
  const { data: accounts } = useQuery({
    queryKey: ["twitter_accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("twitter_accounts")
        .select("id, username, display_name")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Load existing flow if editing
  useEffect(() => {
    if (!flowId) return;
    (async () => {
      const { data, error } = await supabase
        .from("automation_flows")
        .select("*")
        .eq("id", flowId)
        .maybeSingle();
      if (error || !data) return;
      setName(data.name);
      setDescription(data.description || "");
      setInterval(data.execution_interval || "");
      setAccountIds(data.account_ids || []);
      const rf = data.react_flow_data as any;
      setNodes((rf?.nodes ?? []) as Node[]);

      // Recupera a faixa humanizada: do nó cron (interval_min/max) ou do intervalo salvo.
      const cronCfg = (rf?.nodes ?? []).find((n: any) => n.data?.kind === "trigger.cron")?.data?.config ?? {};
      const base = cronToMinutes(cronCfg.cron || data.execution_interval || "0 */1 * * *");
      const lo = Number(cronCfg.interval_min) || Math.max(1, Math.round(base * 0.7));
      const hi = Number(cronCfg.interval_max) || Math.max(lo, Math.round(base * 1.3));
      setSchedMin(lo);
      setSchedMax(hi);
      const loaded = (rf?.edges ?? []) as Edge[];
      setEdges(loaded.map((e) => ({ ...DEFAULT_EDGE_OPTIONS, ...e, type: "deletable" })));

    })();
  }, [flowId]);

  const onNodesChange = useCallback((c: NodeChange[]) => setNodes((n) => applyNodeChanges(c, n)), []);
  const onEdgesChange = useCallback((c: EdgeChange[]) => setEdges((e) => applyEdgeChanges(c, e)), []);
  const onConnect = useCallback(
    (c: Connection) => setEdges((e) => addEdge({ ...c, ...DEFAULT_EDGE_OPTIONS }, e)),
    [],
  );

  const addNode = (kind: NodeKind) => {
    const meta = getNodeMeta(kind);
    const newNode: Node = {
      id: genId(),
      type: "flowNode",
      position: { x: 240 + Math.random() * 160, y: 120 + nodes.length * 110 },
      data: { kind, label: meta.label, config: {} },
    };

    setNodes((n) => [...n, newNode]);
    setSelectedId(newNode.id);
  };

  const updateNodeData = (id: string, data: any) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data } : n)));
  };

  const deleteNode = (id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setSelectedId(null);
  };

  // Aplica a faixa humanizada: estado + intervalo base + config do nó cron (se existir).
  const applySchedule = useCallback((lo: number, hi: number) => {
    const min = Math.max(1, Math.round(lo));
    const max = Math.max(min, Math.round(hi));
    setSchedMin(min);
    setSchedMax(max);
    const baseCron = minutesToCron(min); // base de cadência; o worker sorteia entre min–max
    setInterval(baseCron);
    setNodes((ns) =>
      ns.map((n) =>
        n.data?.kind === "trigger.cron"
          ? { ...n, data: { ...n.data, config: { ...(n.data.config ?? {}), cron: baseCron, interval_min: min, interval_max: max } } }
          : n,
      ),
    );
  }, []);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);

  async function handleSave(activate: boolean) {
    if (!name.trim()) return toast.error("Dê um nome ao fluxo");
    if (nodes.length === 0) return toast.error("Adicione ao menos um nó");
    if (accountIds.length === 0) return toast.error("Selecione ao menos uma conta");
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");

      const payload = {
        user_id: u.user.id,
        name,
        description: description || null,
        status: (activate ? "active" : "draft") as "active" | "draft",
        react_flow_data: { nodes, edges } as any,
        execution_interval: interval || null,
        account_ids: accountIds,
      };

      let savedId = flowId;
      if (flowId) {
        const { error } = await supabase.from("automation_flows").update(payload).eq("id", flowId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("automation_flows")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        savedId = data.id;
      }

      if (activate && savedId) {
        const { error } = await supabase.functions.invoke("parse-flow-to-queue", {
          body: { flow_id: savedId },
        });
        if (error) console.warn("parse-flow-to-queue:", error);
      }

      toast.success(activate ? "Fluxo salvo e ativado" : "Fluxo salvo como rascunho");
      qc.invalidateQueries({ queryKey: ["automation_flows"] });
      navigate({ to: "/automations" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Top bar */}
      <header className="h-14 border-b border-border bg-surface flex items-center px-5 gap-4">
        <Link to="/automations" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
        </Link>
        <div className="flex-1 min-w-0">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border-0 shadow-none px-0 h-8 text-sm font-medium focus-visible:ring-0"
            placeholder="Nome do fluxo"
          />
        </div>
        <Button variant="outline" onClick={() => handleSave(false)} disabled={saving}>
          Salvar rascunho
        </Button>
        <Button onClick={() => handleSave(true)} disabled={saving}>
          <Save className="h-4 w-4 mr-2" strokeWidth={1.5} />
          Salvar e ativar fluxo
        </Button>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Node palette */}
        <aside className="w-64 border-r border-border bg-surface overflow-auto">
          <div className="p-5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">Triggers</p>
            <div className="space-y-1.5">
              {NODE_LIBRARY.filter((n) => n.category === "trigger").map((n) => (
                <PaletteButton key={n.kind} kind={n.kind} onAdd={addNode} />
              ))}
            </div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mt-6 mb-3">Actions</p>
            <div className="space-y-1.5">
              {NODE_LIBRARY.filter((n) => n.category === "action").map((n) => (
                <PaletteButton key={n.kind} kind={n.kind} onAdd={addNode} />
              ))}
            </div>
          </div>
        </aside>

        {/* Canvas + bottom bar */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 relative">
            <ReactFlow
              nodes={nodesWithTest}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
              connectionLineType={ConnectionLineType.SmoothStep}
              connectionRadius={28}
              snapToGrid
              snapGrid={[16, 16]}
              deleteKeyCode={["Backspace", "Delete"]}
              multiSelectionKeyCode={["Meta", "Shift"]}
              elevateEdgesOnSelect
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, node) => setSelectedId(node.id)}
              onPaneClick={() => setSelectedId(null)}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              proOptions={{ hideAttribution: true }}
            >

              <Background gap={20} size={1} color="oklch(0.88 0.003 90)" />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable maskColor="oklch(0.95 0.003 90 / 0.7)" />
            </ReactFlow>

            {nodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-sm text-muted-foreground">Adicione um trigger pela barra lateral para começar.</p>
              </div>
            )}
          </div>

          <div className="border-t border-border bg-surface px-6 py-5">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-5">
              {/* Frequência humanizada */}
              <div className="lg:col-span-5">
                <BarLabel icon={Clock}>Com que frequência rodar</BarLabel>
                <HumanSchedule
                  min={schedMin}
                  max={schedMax}
                  onChange={applySchedule}
                />
              </div>

              {/* Descrição */}
              <div className="lg:col-span-3">
                <BarLabel icon={FileText}>Descrição <span className="text-muted-foreground/60 normal-case tracking-normal">(opcional)</span></BarLabel>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex.: aquece contas do lote 1"
                  className="mt-2 h-10"
                />
                <p className="mt-1.5 text-[11px] text-muted-foreground">Só pra você se organizar. Não afeta o robô.</p>
              </div>

              {/* Contas executoras */}
              <div className="lg:col-span-4">
                <BarLabel icon={Users}>Quais contas vão executar</BarLabel>
                <AccountPicker
                  accounts={accounts ?? []}
                  selected={accountIds}
                  onChange={setAccountIds}
                />
              </div>
            </div>
          </div>
        </div>

        <PropertiesPanel
          node={selectedNode}
          onChange={updateNodeData}
          onClose={() => setSelectedId(null)}
          onDelete={deleteNode}
        />
      </div>

      <TestNodeDialog
        open={testOpen}
        onOpenChange={setTestOpen}
        node={nodes.find((n) => n.id === testNodeId) ?? null}
        nodes={nodes}
        edges={edges}
        flowId={flowId}
        accounts={accounts ?? undefined}
        defaultAccountIds={accountIds}
      />
    </div>
  );
}

function BarLabel({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return (
    <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
      <Icon className="h-3.5 w-3.5 text-brand" strokeWidth={1.75} />
      {children}
    </Label>
  );
}

/** Randomizador de tempo humanizado: faixa "de X a Y" + presets + frase explicativa. */
function HumanSchedule({
  min, max, onChange,
}: { min: number; max: number; onChange: (lo: number, hi: number) => void }) {
  // Unidade de exibição: se ambos são múltiplos de 60, mostra em horas.
  const useHours = min >= 60 && max >= 60 && min % 60 === 0 && max % 60 === 0;
  const factor = useHours ? 60 : 1;
  const unit: "min" | "h" = useHours ? "h" : "min";
  const dispMin = Math.round(min / factor);
  const dispMax = Math.round(max / factor);

  const setUnit = (u: "min" | "h") => {
    const f = u === "h" ? 60 : 1;
    onChange(Math.max(1, dispMin * f), Math.max(dispMin * f, dispMax * f));
  };

  return (
    <div className="mt-2 rounded-xl border border-border bg-background/60 p-3 space-y-3">
      {/* Presets */}
      <div className="flex flex-wrap gap-1.5">
        {SCHEDULE_PRESETS.map((p) => {
          const active = min === p.min && max === p.max;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(p.min, p.max)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors border",
                active
                  ? "border-brand/50 bg-accent text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-brand/30",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Faixa de–até */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">A cada</span>
        <Input
          type="number"
          min={1}
          value={dispMin}
          onChange={(e) => {
            const v = Math.max(1, Number(e.target.value) || 1) * factor;
            onChange(v, Math.max(v, max));
          }}
          className="h-9 w-16 text-center"
        />
        <span className="text-xs text-muted-foreground shrink-0">a</span>
        <Input
          type="number"
          min={1}
          value={dispMax}
          onChange={(e) => {
            const v = Math.max(1, Number(e.target.value) || 1) * factor;
            onChange(Math.min(min, v), v); // máx = v; se v < mín, mín acompanha
          }}
          className="h-9 w-16 text-center"
        />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value as "min" | "h")}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="min">minutos</option>
          <option value="h">horas</option>
        </select>
      </div>

      {/* Frase humana */}
      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground leading-relaxed">
        <Dice5 className="h-3.5 w-3.5 text-brand shrink-0 mt-0.5" strokeWidth={1.75} />
        <span>
          O robô espera um tempo <b className="text-foreground">aleatório entre {humanMinutes(min)} e {humanMinutes(max)}</b> a
          cada ciclo — nunca um valor exato, pra imitar uma pessoa e evitar bloqueio.
        </span>
      </p>
    </div>
  );
}

type AccountLite = { id: string; username: string; display_name?: string | null };

/** Seletor de contas com busca, "selecionar todas" e contador. */
function AccountPicker({
  accounts, selected, onChange,
}: { accounts: AccountLite[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const filtered = accounts.filter(
    (a) =>
      a.username.toLowerCase().includes(q.toLowerCase()) ||
      (a.display_name ?? "").toLowerCase().includes(q.toLowerCase()),
  );
  const allShownSelected = filtered.length > 0 && filtered.every((a) => selected.includes(a.id));

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const toggleAllShown = () => {
    if (allShownSelected) onChange(selected.filter((id) => !filtered.some((a) => a.id === id)));
    else onChange([...new Set([...selected, ...filtered.map((a) => a.id)])]);
  };

  if (accounts.length === 0) {
    return (
      <div className="mt-2 rounded-xl border border-dashed border-border p-4 text-center">
        <p className="text-xs text-muted-foreground">
          Nenhuma conta. <Link to="/accounts" className="text-brand underline">Cadastrar conta</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-border bg-background/60 overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-2 border-b border-border">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar @conta…"
          className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={toggleAllShown}
          className="text-[11px] text-brand hover:underline shrink-0"
        >
          {allShownSelected ? "Limpar" : "Todas"}
        </button>
      </div>
      <div className="max-h-28 overflow-auto p-1.5">
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">Nenhuma conta encontrada.</p>
        ) : (
          filtered.map((a) => {
            const on = selected.includes(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggle(a.id)}
                className={cn(
                  "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                  on ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                <span
                  className={cn(
                    "grid h-4 w-4 shrink-0 place-items-center rounded border",
                    on ? "border-brand bg-brand text-white" : "border-input",
                  )}
                >
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="text-xs text-foreground truncate">@{a.username}</span>
                {a.display_name && (
                  <span className="text-[11px] text-muted-foreground truncate">· {a.display_name}</span>
                )}
              </button>
            );
          })
        )}
      </div>
      <div className="px-2.5 py-1.5 border-t border-border bg-background/40">
        <p className="text-[11px] text-muted-foreground">
          <b className="text-foreground tabular-nums">{selected.length}</b> conta(s) selecionada(s)
        </p>
      </div>
    </div>
  );
}

function PaletteButton({ kind, onAdd }: { kind: NodeKind; onAdd: (k: NodeKind) => void }) {
  const meta = getNodeMeta(kind);
  const Icon = meta.icon;
  return (
    <button
      onClick={() => onAdd(kind)}
      className="w-full text-left flex items-center gap-2.5 px-3 py-2 border border-border rounded-md bg-background hover:bg-accent transition-colors group"
    >
      <div className="h-7 w-7 rounded-md bg-accent flex items-center justify-center group-hover:bg-background">
        <Icon className="h-3.5 w-3.5 text-foreground" strokeWidth={1.5} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground truncate">{meta.label}</p>
        <p className="text-[10px] text-muted-foreground truncate">{meta.description}</p>
      </div>
      <Plus className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
    </button>
  );
}
