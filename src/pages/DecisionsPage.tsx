import type { Decision, DecisionStatus, Repository } from "../types";
import { DecisionRow, EmptyState, buttonPrimary } from "../components/AppComponents";

type Props = {
  filteredDecisions: Decision[];
  decisions: Decision[];
  repositories: Repository[];
  query: string;
  statusFilter: "all" | DecisionStatus;
  repositoryFilter: string;
  onRepositoryFilter: (value: string) => void;
  onStatusFilter: (value: "all" | DecisionStatus) => void;
  onSelectDecision: (decision: Decision) => void;
  onCreateDecision: () => void;
};

export function DecisionsPage({ filteredDecisions, decisions, repositories, query, statusFilter, repositoryFilter, onRepositoryFilter, onStatusFilter, onSelectDecision, onCreateDecision }: Props) {
  return <>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-slate-500">{filteredDecisions.length} de {decisions.length} decisiones</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Historial técnico</h2></div><div className="flex flex-wrap items-center gap-2"><label className="sr-only" htmlFor="decision-repository-filter">Filtrar por repositorio</label><select className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm outline-none focus:border-indigo-500" id="decision-repository-filter" onChange={(event) => onRepositoryFilter(event.target.value)} value={repositoryFilter}><option value="all">Todos los repositorios</option><option value="none">Sin repositorio</option>{repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.full_name}</option>)}</select><label className="sr-only" htmlFor="status-filter">Filtrar por estado</label><select className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm outline-none focus:border-indigo-500" id="status-filter" onChange={(event) => onStatusFilter(event.target.value as "all" | DecisionStatus)} value={statusFilter}><option value="all">Todos los estados</option><option value="accepted">Aceptadas</option><option value="draft">Borradores</option><option value="superseded">Reemplazadas</option></select></div></div>
    {filteredDecisions.length ? <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">{filteredDecisions.map((decision, index) => <DecisionRow decision={decision} key={decision.id} last={index === filteredDecisions.length - 1} onClick={() => onSelectDecision(decision)} repository={repositories.find((row) => row.id === decision.repository_id)} />)}</div> : <EmptyState action={<button className={buttonPrimary} onClick={onCreateDecision} type="button">Crear decisión</button>} text={query || statusFilter !== "all" ? "Prueba otra búsqueda o cambia el filtro de estado." : "Empieza con el problema, la opción elegida y el motivo detrás de ella."} title={query || statusFilter !== "all" ? "No encontramos coincidencias" : "Tu historial empieza aquí"} />}
  </>;
}
