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
import { PropertiesPanel, CronIntervalInput } from "./properties-panel";
import { TestNodeDialog } from "./test-node-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Save, Plus } from "lucide-react";

let nodeIdCounter = 1;
const genId = () => `n${Date.now()}_${nodeIdCounter++}`;

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

          <div className="border-t border-border bg-surface p-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Intervalo</Label>
                <div className="mt-1.5">
                  <CronIntervalInput value={interval || "*/15 * * * *"} onChange={setInterval} />
                </div>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Descrição</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1.5 h-10" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Contas executoras ({accountIds.length})
                </Label>
                <div className="mt-1.5 max-h-24 overflow-auto border border-input rounded-md p-2 bg-background">
                  {(!accounts || accounts.length === 0) && (
                    <p className="text-xs text-muted-foreground">Nenhuma conta. <Link to="/accounts" className="underline">Cadastrar</Link></p>
                  )}
                  {accounts?.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 py-0.5 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={accountIds.includes(a.id)}
                        onChange={(e) =>
                          setAccountIds((prev) =>
                            e.target.checked ? [...prev, a.id] : prev.filter((id) => id !== a.id),
                          )
                        }
                      />
                      <span className="text-foreground">@{a.username}</span>
                      {a.display_name && <span className="text-muted-foreground truncate">· {a.display_name}</span>}
                    </label>
                  ))}
                </div>
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
