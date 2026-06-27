import { Handle, Position, type NodeProps } from "reactflow";
import { Clock, AtSign, Search, Send, Repeat, MessageCircle, Zap, Play, type LucideIcon } from "lucide-react";

export type NodeKind =
  | "trigger.cron"
  | "trigger.monitor_account"
  | "trigger.monitor_keyword"
  | "action.post_tweet"
  | "action.retweet"
  | "action.comment"
  | "action.mass_engage";

export interface NodeMeta {
  kind: NodeKind;
  label: string;
  description: string;
  category: "trigger" | "action";
  icon: LucideIcon;
}

export const NODE_LIBRARY: NodeMeta[] = [
  { kind: "trigger.cron", label: "Cron / Tempo", description: "Dispara em um intervalo", category: "trigger", icon: Clock },
  { kind: "trigger.monitor_account", label: "Monitorar conta", description: "Reage a novos tweets de um @", category: "trigger", icon: AtSign },
  { kind: "trigger.monitor_keyword", label: "Monitorar palavra-chave", description: "Pesquisa periódica por termo", category: "trigger", icon: Search },
  { kind: "action.post_tweet", label: "Publicar tweet", description: "Posta com suporte a variáveis", category: "action", icon: Send },
  { kind: "action.retweet", label: "Dar RT", description: "Republica o tweet alvo", category: "action", icon: Repeat },
  { kind: "action.comment", label: "Comentar", description: "Responde ao tweet alvo", category: "action", icon: MessageCircle },
  { kind: "action.mass_engage", label: "Engajar em massa", description: "Curte/segue em lote com delay", category: "action", icon: Zap },
];

export function getNodeMeta(kind: NodeKind): NodeMeta {
  return NODE_LIBRARY.find((n) => n.kind === kind) ?? NODE_LIBRARY[0];
}

export interface FlowNodeData {
  kind: NodeKind;
  label?: string;
  config?: Record<string, unknown>;
  onTest?: (id: string) => void;
}

export function FlowNode({ id, data, selected }: NodeProps<FlowNodeData>) {
  const meta = getNodeMeta(data.kind);
  const Icon = meta.icon;
  const isTrigger = meta.category === "trigger";

  return (
    <div
      className={`group relative bg-surface border rounded-xl w-[230px] transition-all ${
        selected
          ? "border-brand/60 shadow-[0_0_0_3px_oklch(0.66_0.2_285_/_0.25),0_12px_30px_-12px_oklch(0.66_0.2_285_/_0.5)]"
          : "border-border hover:border-brand/30"
      }`}
    >
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Top}
          style={{ width: 10, height: 10, background: "oklch(0.66 0.2 285)", border: "2px solid oklch(0.17 0.022 280)" }}
        />
      )}


      {data.onTest && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            data.onTest?.(id);
          }}
          title="Testar este nó agora"
          className="absolute -top-2 -right-2 h-7 w-7 rounded-full bg-foreground text-background flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:scale-105 z-10"
        >
          <Play className="h-3 w-3" strokeWidth={2} fill="currentColor" />
        </button>
      )}

      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-accent flex items-center justify-center text-brand">
            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
              {isTrigger ? "Trigger" : "Action"}
            </p>
            <p className="text-xs font-medium text-foreground truncate">{data.label || meta.label}</p>
          </div>
        </div>
        {data.config && Object.keys(data.config).length > 0 && (
          <p className="mt-2 pt-2 border-t border-border text-[10px] text-muted-foreground font-mono truncate">
            {Object.entries(data.config).slice(0, 1).map(([k, v]) => `${k}: ${String(v).slice(0, 24)}`).join("")}
          </p>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ width: 10, height: 10, background: "oklch(0.45 0.01 90)", border: "2px solid white" }}
      />

    </div>
  );
}

export const nodeTypes = { flowNode: FlowNode };
