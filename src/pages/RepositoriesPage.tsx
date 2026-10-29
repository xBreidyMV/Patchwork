import { Activity, ExternalLink, FileText, GitBranch, Plus, Search, Trash2 } from "lucide-react";
import type { Decision, GithubInstallation, Repository, RepositoryEvent } from "../types";
import { EmptyState, buttonPrimary, buttonSecondary, inputClass, prettyDate } from "../components/AppComponents";

type RepositoryStatusFilter = "all" | "connected" | "manual" | "disconnected";
type Props = {
  filteredRepositories: Repository[];
  repositories: Repository[];
  installations: GithubInstallation[];
  decisions: Decision[];
  repositoryEvents: RepositoryEvent[];
  query: string;
  statusFilter: RepositoryStatusFilter;
  onQuery: (value: string) => void;
  onStatusFilter: (value: RepositoryStatusFilter) => void;
  onAddRepository: () => void;
  onViewActivity: () => void;
  onDeleteRepository: (repository: Repository) => void;
};

export function RepositoriesPage({ filteredRepositories, repositories, installations, decisions, repositoryEvents, query, statusFilter, onQuery, onStatusFilter, onAddRepository, onViewActivity, onDeleteRepository }: Props) {
  const activeInstallations = installations.filter((item) => item.is_active);
  const syncedCount = repositories.filter((repo) => repo.provider_repository_id && repo.is_connected).length;
  return <>
    <div className="mb-6"><p className="text-sm text-slate-500">{filteredRepositories.length} de {repositories.length} repositorios · {syncedCount} sincronizados</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Repositorios</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Conecta GitHub para sincronizar repositorios y recibir su actividad. También puedes añadir repositorios manualmente.</p></div>
    {activeInstallations.length > 0 && <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-sm font-semibold text-emerald-900">GitHub conectado</p><div className="mt-2 flex flex-wrap gap-2">{activeInstallations.map((item) => <span className="rounded-full bg-white px-3 py-1 text-xs text-emerald-800" key={item.id}>{item.account_login} · {item.account_type}</span>)}</div></div>}
    <div className="mb-5 flex flex-wrap items-center gap-3"><label className="relative min-w-56 flex-1"><span className="sr-only">Buscar repositorios</span><Search className="absolute left-3 top-2.5 text-slate-400" size={16} /><input className={`${inputClass} pl-9`} onChange={(event) => onQuery(event.target.value)} placeholder="Buscar repositorios..." value={query} /></label><label><span className="sr-only">Filtrar estado de sincronización</span><select aria-label="Filtrar repositorios por sincronización" className={inputClass} onChange={(event) => onStatusFilter(event.target.value as RepositoryStatusFilter)} value={statusFilter}><option value="all">Todos los estados</option><option value="connected">Sincronizados</option><option value="manual">Añadidos manualmente</option><option value="disconnected">Desconectados</option></select></label><a className={buttonSecondary} download href="/patchwork-pull-request-template.md"><FileText size={16} />Descargar plantilla de PR</a><button className={buttonSecondary} onClick={onViewActivity} type="button"><Activity size={16} />Ver actividad</button></div>
    {filteredRepositories.length ? <div className="grid gap-4 lg:grid-cols-2">{filteredRepositories.map((repository) => { const synced = Boolean(repository.provider_repository_id && repository.is_connected); const disconnected = Boolean(repository.provider_repository_id && !repository.is_connected); return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" key={repository.id}><div className="flex items-start gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700"><GitBranch size={21} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-semibold">{repository.full_name}</h3><span className={`rounded-full px-2 py-1 text-[11px] font-medium ${synced ? "bg-emerald-50 text-emerald-700" : disconnected ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>{synced ? "Sincronizado" : disconnected ? "Desconectado" : "Manual"}</span></div><a className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-indigo-700 hover:underline" href={repository.url} rel="noreferrer" target="_blank">{repository.url}<ExternalLink size={12} /></a><p className="mt-3 text-xs text-slate-500">{decisions.filter((item) => item.repository_id === repository.id).length} decisiones · {repositoryEvents.filter((event) => event.repository_id === repository.id).length} eventos · añadido {prettyDate(repository.created_at)}</p></div><button aria-label={`Eliminar ${repository.full_name}`} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-700" onClick={() => onDeleteRepository(repository)} title="Eliminar repositorio" type="button"><Trash2 size={16} /></button></div></article>; })}</div> : repositories.length ? <EmptyState text="Prueba con otro nombre o estado de sincronización." title="No hay repositorios que coincidan" /> : <EmptyState action={<button className={buttonPrimary} onClick={onAddRepository} type="button"><Plus size={16} />Añadir repositorio</button>} text="Añade un repositorio para asociarlo a las decisiones que tomes sobre ese código." title="No hay repositorios" />}
  </>;
}
