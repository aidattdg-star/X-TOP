import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, PlayCircle, PauseCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/automations/")({
  component: AutomationsPage,
});

function AutomationsPage() {
  const qc = useQueryClient();
  const { data: flows } = useQuery({
    queryKey: ["automation_flows"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_flows")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function toggleStatus(id: string, current: string) {
    const next = current === "active" ? "paused" : "active";
    const { error } = await supabase.from("automation_flows").update({ status: next }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["automation_flows"] });
  }

  async function remove(id: string) {
    if (!confirm("Remover este fluxo?")) return;
    const { error } = await supabase.from("automation_flows").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["automation_flows"] });
  }

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-10 max-w-7xl mx-auto">
      <PageHeader
        eyebrow="Automações"
        title="Fluxos de automação"
        description="Crie e gerencie fluxos visuais executados pelas suas contas do X."
        actions={
          <Button asChild>
            <Link to="/automations/builder"><Plus className="h-4 w-4 mr-2" strokeWidth={1.5} /> Novo fluxo</Link>
          </Button>
        }
      />

      <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(!flows || flows.length === 0) && (
          <div className="col-span-full border border-dashed border-border rounded-lg p-12 text-center">
            <p className="text-sm text-muted-foreground">Nenhum fluxo criado.</p>
            <Button asChild className="mt-4">
              <Link to="/automations/builder">Criar primeiro fluxo</Link>
            </Button>
          </div>
        )}
        {flows?.map((f) => (
          <div key={f.id} className="border border-border bg-surface rounded-lg p-5 flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{f.name}</p>
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{f.description || "Sem descrição"}</p>
              </div>
              <Badge variant="outline" className="font-normal text-[10px] uppercase tracking-wider gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${f.status === "active" ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />
                {f.status}
              </Badge>
            </div>

            <div className="mt-5 pt-4 border-t border-border text-xs text-muted-foreground space-y-1">
              <p>{f.account_ids?.length ?? 0} conta(s) vinculada(s)</p>
              {f.execution_interval && <p>Intervalo: <span className="font-mono text-foreground">{f.execution_interval}</span></p>}
            </div>

            <div className="mt-auto pt-5 flex items-center justify-between">
              <Link to="/automations/builder/$id" params={{ id: f.id }} className="text-xs font-medium text-foreground hover:underline">
                Editar fluxo →
              </Link>
              <div className="flex items-center gap-1">
                <button onClick={() => toggleStatus(f.id, f.status)} className="p-1.5 text-muted-foreground hover:text-foreground">
                  {f.status === "active" ? <PauseCircle className="h-4 w-4" strokeWidth={1.5} /> : <PlayCircle className="h-4 w-4" strokeWidth={1.5} />}
                </button>
                <button onClick={() => remove(f.id)} className="p-1.5 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}