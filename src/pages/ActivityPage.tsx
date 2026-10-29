import { CircleDot, ExternalLink, GitBranch, Search } from "lucide-react";
import type { Decision, Repository, RepositoryEvent } from "../types";
import type { TimelineEntry } from "../types/navigation";
import { DecisionRow, EmptyState, inputClass, prettyDate } from "../components/AppComponents";

type Props = {
  timelineEntries: TimelineEntry[];
  decisions: Decision[];
  repositoryEvents: RepositoryEvent[];
  repositories: Repository[];
  query: string;
  repositoryFilter: string;
  typeFilter: string;
  range: string;
  onQuery: (value: string) => void;
  onRepositoryFilter: (value: string) => void;
  onTypeFilter: (value: string) => void;
  onRange: (value: string) => void;
  onSelectDecision: (decision: Decision) => void;
};

export function ActivityPage({ timelineEntries, decisions, repositoryEvents, repositories, query, repositoryFilter, typeFilter, range, onQuery, onRepositoryFilter, onTypeFilter, onRange, onSelectDecision }: Props) {
  return <>
    <div className="mb-5"><p className="text-sm text-slate-500">{timelineEntries.length} elementos en este filtro</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Historial de actividad</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Eventos recibidos de GitHub y decisiones técnicas del espacio, en una sola cronología.</p></div>
    <div className="mb-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-4"><label className="relative"><span className="sr-only">Buscar en actividad</span><Search className="absolute left-3 top-2.5 text-slate-400" size={16} /><input className={`${inputClass} pl-9`} onChange={(event) => onQuery(event.target.value)} placeholder="Buscar eventos y decisiones..." value={query} /></label><label><span className="sr-only">Filtrar por repositorio</span><select aria-label="Filtrar actividad por repositorio" className={inputClass} onChange={(event) => onRepositoryFilter(event.target.value)} value={repositoryFilter}><option value="all">Todos los repositorios</option><option value="none">Sin repositorio</option>{repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.full_name}</option>)}</select></label><label><span className="sr-only">Filtrar por tipo</span><select aria-label="Filtrar actividad por tipo" className={inputClass} onChange={(event) => onTypeFilter(event.target.value)} value={typeFilter}><option value="all">Todos los tipos</option><option value="decision">Decisiones técnicas</option><option value="push">Commits</option><option value="pull_request">Pull requests</option><option value="issues">Issues</option></select></label><label><span className="sr-only">Filtrar por fecha</span><select aria-label="Filtrar actividad por periodo" className={inputClass} onChange={(event) => onRange(event.target.value)} value={range}><option value="all">Todo el historial</option><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option></select></label></div>
    {timelineEntries.length ? <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">{timelineEntries.map((entry, index) => {
      if (entry.kind === "decision") return <DecisionRow decision={entry.decision} key={`decision-${entry.id}`} last={index === timelineEntries.length - 1} onClick={() => onSelectDecision(entry.decision)} repository={repositories.find((row) => row.id === entry.decision.repository_id)} />;
      const event = entry.event;
      const repository = repositories.find((row) => row.id === event.repository_id);
      const Icon = event.event_type === "issues" ? CircleDot : GitBranch;
      const content = <div className="flex items-start gap-3"><span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-700"><Icon size={17} /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="font-medium text-slate-900">{event.title}</span><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium capitalize text-emerald-700">{event.event_type.replace("_", " ")}{event.action ? ` · ${event.action}` : ""}</span></span>{event.summary && <span className="mt-1 block text-sm leading-5 text-slate-600">{event.summary}</span>}<span className="mt-2 flex flex-wrap gap-x-3 text-xs text-slate-500"><span>{repository?.full_name ?? "Repositorio"}</span>{event.actor_login && <span>por {event.actor_login}</span>}<span>{prettyDate(event.occurred_at)}</span></span></span><ExternalLink className="shrink-0 text-slate-400" size={14} /></div>;
      const rowClass = `block border-b border-slate-100 px-5 py-4 transition hover:bg-slate-50 sm:px-6 ${index === timelineEntries.length - 1 ? "border-b-0" : ""}`;
      return event.url ? <a className={rowClass} href={event.url} key={`event-${entry.id}`} rel="noreferrer" target="_blank">{content}</a> : <div className={rowClass} key={`event-${entry.id}`}>{content}</div>;
    })}</div> : <EmptyState text={repositoryEvents.length || decisions.length ? "Prueba quitando algún filtro o cambiando el texto de búsqueda." : "Cuando registres decisiones o recibas actividad de GitHub, aparecerá aquí."} title={repositoryEvents.length || decisions.length ? "No hay resultados" : "Todavía no hay actividad"} />}
  </>;
}
