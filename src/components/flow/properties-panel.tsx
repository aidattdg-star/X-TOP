import { type Node } from "reactflow";
import { getNodeMeta, type NodeKind } from "./nodes";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface Props {
  node: Node | null;
  onChange: (id: string, data: any) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export function PropertiesPanel({ node, onChange, onClose, onDelete }: Props) {
  if (!node) {
    return (
      <aside className="w-80 border-l border-border bg-surface p-6 flex items-center justify-center">
        <p className="text-xs text-muted-foreground text-center">
          Selecione um nó no canvas<br />para configurar.
        </p>
      </aside>
    );
  }
  const selectedNode = node;
  const kind = selectedNode.data?.kind as NodeKind;
  const meta = getNodeMeta(kind);
  const config = (selectedNode.data?.config ?? {}) as Record<string, any>;

  function setConfig(patch: Record<string, any>) {
    onChange(selectedNode.id, { ...selectedNode.data, config: { ...config, ...patch } });
  }
  function setLabel(label: string) {
    onChange(selectedNode.id, { ...selectedNode.data, label });
  }



  return (
    <aside className="w-80 border-l border-border bg-surface flex flex-col">
      <div className="p-5 border-b border-border flex items-start justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{meta.category}</p>
          <p className="mt-1 text-sm font-medium text-foreground">{meta.label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{meta.description}</p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>

      <div className="p-5 space-y-4 overflow-auto flex-1">
        <Field label="Rótulo">
          <Input value={node.data?.label || ""} placeholder={meta.label} onChange={(e) => setLabel(e.target.value)} />
        </Field>

        {renderConfig(kind, config, setConfig)}
      </div>

      <div className="p-5 border-t border-border">
        <Button variant="outline" className="w-full text-destructive" onClick={() => onDelete(node.id)}>
          Remover nó
        </Button>
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/**
 * Entrada de duração: campo numérico + seletor (s/min/h).
 * Armazena sempre em segundos via `valueSeconds`.
 */
function DurationInput({
  valueSeconds,
  onChange,
  min = 1,
}: {
  valueSeconds: number;
  onChange: (seconds: number) => void;
  min?: number;
}) {
  // Escolhe a unidade que melhor representa o valor atual (sem perder precisão)
  const pickUnit = (s: number): "s" | "m" | "h" => {
    if (s > 0 && s % 3600 === 0) return "h";
    if (s > 0 && s % 60 === 0) return "m";
    return "s";
  };
  const unit = pickUnit(valueSeconds || 0);
  const factor = unit === "h" ? 3600 : unit === "m" ? 60 : 1;
  const display = valueSeconds ? Math.round(valueSeconds / factor) : "";

  return (
    <div className="flex gap-2">
      <Input
        type="number"
        min={min}
        value={display}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return;
          onChange(Math.max(min, n * factor));
        }}
        className="flex-1"
      />
      <select
        className="h-10 rounded-md border border-input bg-background px-2 text-sm"
        value={unit}
        onChange={(e) => {
          const newUnit = e.target.value as "s" | "m" | "h";
          const newFactor = newUnit === "h" ? 3600 : newUnit === "m" ? 60 : 1;
          const current = Number(display) || min;
          onChange(Math.max(min, current * newFactor));
        }}
      >
        <option value="s">segundos</option>
        <option value="m">minutos</option>
        <option value="h">horas</option>
      </select>
    </div>
  );
}

export function CronIntervalInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (cron: string) => void;
}) {
  const parsed = parseCron(value);
  const [n, setN] = [parsed.n, (nv: number) => onChange(buildCron(nv, parsed.unit))];
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Input
          type="number"
          min={1}
          value={n}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v) || v < 1) return;
            setN(v);
          }}
          className="flex-1"
        />
        <select
          className="h-10 rounded-md border border-input bg-background px-2 text-sm"
          value={parsed.unit}
          onChange={(e) => onChange(buildCron(parsed.n, e.target.value as any))}
        >
          <option value="m">minutos</option>
          <option value="h">horas</option>
          <option value="d">dias</option>
        </select>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Executa a cada {parsed.n} {parsed.unit === "m" ? "minuto(s)" : parsed.unit === "h" ? "hora(s)" : "dia(s)"} · <span className="font-mono">{value || buildCron(parsed.n, parsed.unit)}</span>
      </p>
    </div>
  );
}

function parseCron(expr: string): { n: number; unit: "m" | "h" | "d" } {
  const e = (expr || "").trim();
  let m;
  if ((m = e.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/))) return { n: Math.max(1, +m[1]), unit: "m" };
  if ((m = e.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/))) return { n: Math.max(1, +m[1]), unit: "h" };
  if ((m = e.match(/^0\s+0\s+\*\/(\d+)\s+\*\s+\*$/))) return { n: Math.max(1, +m[1]), unit: "d" };
  if (e === "0 * * * *") return { n: 1, unit: "h" };
  if (e === "0 0 * * *") return { n: 1, unit: "d" };
  return { n: 15, unit: "m" };
}

function buildCron(n: number, unit: "m" | "h" | "d"): string {
  n = Math.max(1, Math.round(n));
  if (unit === "m") return `*/${n} * * * *`;
  if (unit === "h") return `0 */${n} * * *`;
  return `0 0 */${n} * *`;
}

function renderConfig(kind: NodeKind, c: Record<string, any>, set: (p: Record<string, any>) => void) {
  switch (kind) {
    case "trigger.cron":
      return (
        <Field label="Intervalo">
          <CronIntervalInput value={c.cron || "*/15 * * * *"} onChange={(v) => set({ cron: v })} />
        </Field>
      );
    case "trigger.monitor_account":
      return (
        <>
          <Field label="Conta alvo (@)"><Input value={c.account || ""} placeholder="@elonmusk" onChange={(e) => set({ account: e.target.value })} /></Field>
          <Field label="Checar a cada">
            <DurationInput
              valueSeconds={(c.interval_minutes || 10) * 60}
              onChange={(s) => set({ interval_minutes: Math.max(1, Math.round(s / 60)) })}
            />
          </Field>
          <Field label="Tweet a usar no intervalo">
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={c.select_mode || "last"}
              onChange={(e) => set({ select_mode: e.target.value })}
            >
              <option value="last">Último tweet do intervalo</option>
              <option value="most_liked">Mais curtido no intervalo</option>
              <option value="most_viewed">Mais visto no intervalo</option>
            </select>
          </Field>
          <p className="text-[11px] text-muted-foreground">A cada execução, busca tweets novos da conta (não processados) dentro da janela do intervalo e seleciona um conforme o modo acima.</p>
        </>
      );
    case "trigger.monitor_keyword":
      return (
        <>
          <Field label="Palavra-chave"><Input value={c.keyword || ""} placeholder="ex: bitcoin" onChange={(e) => set({ keyword: e.target.value })} /></Field>
          <Field label="Idioma"><Input value={c.lang || ""} placeholder="pt" onChange={(e) => set({ lang: e.target.value })} /></Field>
        </>
      );
    case "action.post_tweet":
      return (
        <>
          <Field label="Texto do tweet">
            <Textarea rows={5} value={c.text || ""} placeholder="Use {{var}} para variáveis" onChange={(e) => set({ text: e.target.value })} />
          </Field>
        </>
      );
    case "action.retweet":
      return <TargetSelector c={c} set={set} />;
    case "action.comment":
      return (
        <>
          <TargetSelector c={c} set={set} />
          <Field label="Comentário"><Textarea rows={4} value={c.text || ""} onChange={(e) => set({ text: e.target.value })} /></Field>
        </>
      );
    case "action.mass_engage":
      return (
        <>
          <Field label="Quantidade de ações"><Input type="number" min={1} value={c.count || 10} onChange={(e) => set({ count: Number(e.target.value) })} /></Field>
          <Field label="Delay entre ações">
            <DurationInput
              valueSeconds={c.delay_seconds || 30}
              onChange={(s) => set({ delay_seconds: s })}
            />
          </Field>
          <Field label="Tipo">
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={c.action_type || "like"} onChange={(e) => set({ action_type: e.target.value })}>
              <option value="like">Curtir</option>
              <option value="follow">Seguir</option>
              <option value="retweet">Retweet</option>
            </select>
          </Field>
        </>
      );
  }
}

function TargetSelector({ c, set }: { c: Record<string, any>; set: (p: Record<string, any>) => void }) {
  const mode =
    c.target_mode ||
    (c.tweet_url ? "tweet_url" : c.tweet_id ? "by_id" : c.keyword ? "keyword_most_liked" : "from_trigger");

  const needsWindow = [
    "monitor_last",
    "monitor_most_liked",
    "monitor_most_viewed",
    "keyword_most_liked",
    "keyword_most_viewed",
    "top_liked_since_refresh",
  ].includes(mode);
  const needsKeyword = mode === "keyword_most_liked" || mode === "keyword_most_viewed";

  const hints: Record<string, string> = {
    from_trigger: "Responde ao tweet detectado pelo trigger de monitoramento.",
    monitor_last: "Último tweet da conta monitorada dentro da janela.",
    monitor_most_liked: "Tweet com mais curtidas da conta monitorada dentro da janela.",
    monitor_most_viewed: "Tweet com mais views da conta monitorada dentro da janela.",
    tweet_url: "Cole o link do tweet (ex: https://x.com/user/status/123...).",
    by_id: "Usa exatamente o ID informado.",
    keyword_most_liked: "Pesquisa a palavra-chave no X e pega o tweet com mais curtidas na janela.",
    keyword_most_viewed: "Pesquisa a palavra-chave no X e pega o tweet com mais views na janela.",
    last_tweet: "Último tweet da conta monitorada (legado).",
    top_liked_since_refresh: "Mais curtido da conta monitorada na janela (legado).",
  };

  return (
    <>
      <Field label="Tweet alvo">
        <select
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={mode}
          onChange={(e) => set({ target_mode: e.target.value })}
        >
          <optgroup label="A partir do trigger">
            <option value="from_trigger">Tweet do trigger ({"{{tweet_id}}"})</option>
          </optgroup>
          <optgroup label="Conta monitorada (janela)">
            <option value="monitor_last">Último tweet</option>
            <option value="monitor_most_liked">Mais curtido</option>
            <option value="monitor_most_viewed">Mais visto</option>
          </optgroup>
          <optgroup label="Tweet fixo">
            <option value="tweet_url">Link do tweet</option>
            <option value="by_id">ID do tweet</option>
          </optgroup>
          <optgroup label="Por palavra-chave (janela)">
            <option value="keyword_most_liked">Mais curtido da palavra-chave</option>
            <option value="keyword_most_viewed">Mais visto da palavra-chave</option>
          </optgroup>
        </select>
      </Field>

      {mode === "tweet_url" && (
        <Field label="Link do tweet">
          <Input
            value={c.tweet_url || ""}
            placeholder="https://x.com/usuario/status/1234567890"
            onChange={(e) => set({ tweet_url: e.target.value })}
          />
        </Field>
      )}

      {mode === "by_id" && (
        <Field label="ID do tweet">
          <Input
            value={c.tweet_id || ""}
            placeholder="1234567890"
            onChange={(e) => set({ tweet_id: e.target.value })}
          />
        </Field>
      )}

      {needsKeyword && (
        <>
          <Field label="Palavra-chave / query">
            <Input
              value={c.keyword || ""}
              placeholder='ex: "lovable" lang:pt min_faves:5'
              onChange={(e) => set({ keyword: e.target.value })}
            />
          </Field>
          <p className="text-[11px] text-muted-foreground">Aceita operadores do X (lang:, min_faves:, from:, etc).</p>
        </>
      )}

      {needsWindow && (
        <Field label="Janela">
          <DurationInput
            valueSeconds={(c.window_minutes || 30) * 60}
            onChange={(s) => set({ window_minutes: Math.max(1, Math.round(s / 60)) })}
          />
        </Field>
      )}

      <p className="text-[11px] text-muted-foreground">{hints[mode]}</p>
    </>
  );
}
