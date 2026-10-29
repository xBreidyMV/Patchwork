import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, BookOpenText, ChevronDown, CircleDot, GitBranch, Layers3, Lightbulb, LogOut, Plus, RefreshCw, Settings } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { ensureDefaultWorkspace, ensureProfile, listWorkspaces, removeDecision, removeRepository, startGithubConnect } from "../services/data";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import type { Decision, DecisionStatus, Repository, Workspace } from "../types";
import { AuthScreen, DecisionDetails, DecisionForm, FlashMessage, GlobalSearchBox, PasswordRecoveryScreen, RepositoryForm, WorkspaceForm, WorkspaceSetup, buttonPrimary, buttonSecondary, errorText, Spinner } from "../components/AppComponents";
import type { Flash, GlobalSearchResult } from "../components/AppComponents";
import { ActivityPage } from "./ActivityPage";
import { DecisionsPage } from "./DecisionsPage";
import { OverviewPage } from "./OverviewPage";
import { RepositoriesPage } from "./RepositoriesPage";
import { SettingsPage } from "./SettingsPage";
import { WorkspacesPage } from "./WorkspacesPage";
import type { DecisionModal, TimelineEntry, View } from "../types/navigation";
import { useWorkspaceData } from "../hooks/useWorkspaceData";

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [view, setView] = useState<View>("overview");
  const [query, setQuery] = useState("");
  const [repositoryQuery, setRepositoryQuery] = useState("");
  const [repositoryStatusFilter, setRepositoryStatusFilter] = useState<"all" | "connected" | "manual" | "disconnected">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | DecisionStatus>("all");
  const [decisionRepositoryFilter, setDecisionRepositoryFilter] = useState("all");
  const [activityQuery, setActivityQuery] = useState("");
  const [activityRepositoryFilter, setActivityRepositoryFilter] = useState("all");
  const [activityTypeFilter, setActivityTypeFilter] = useState("all");
  const [activityRange, setActivityRange] = useState("all");
  const [flash, setFlash] = useState<Flash>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [decisionModal, setDecisionModal] = useState<DecisionModal>(null);
  const [repositoryModal, setRepositoryModal] = useState(false);
  const [workspaceModal, setWorkspaceModal] = useState(false);
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null);
  const [githubConnecting, setGithubConnecting] = useState(false);
  const showLoadError = useCallback((error: unknown) => {
    setFlash({ kind: "error", message: errorText(error) });
  }, []);
  const { repositories, installations, repositoryEvents, memberCount, decisions, dataLoading, refreshData } = useWorkspaceData(
    workspace?.id,
    session?.user.id,
    showLoadError,
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("github");
    if (!result) return;
    setFlash(result === "connected"
      ? { kind: "success", message: "GitHub se conectó y los repositorios ya están sincronizados." }
      : { kind: "error", message: "No se pudo completar la conexión con GitHub. Revisa la configuración e inténtalo de nuevo." });
    url.searchParams.delete("github");
    window.history.replaceState({}, "", url.toString());
  }, []);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    let alive = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
      setSession(nextSession);
      setAuthLoading(false);
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return;
      if (error) setFlash({ kind: "error", message: errorText(error) });
      setSession(data.session);
      setAuthLoading(false);
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setWorkspaces([]); setWorkspace(null); setWorkspaceLoading(false);
      return;
    }
    let alive = true;
    setWorkspaceLoading(true);
    const displayName = typeof session.user.user_metadata?.display_name === "string" ? session.user.user_metadata.display_name : session.user.email?.split("@")[0] ?? null;
    void Promise.all([ensureProfile(session.user.id, displayName), listWorkspaces()]).then(async ([, rows]) => {
      const availableWorkspaces = rows.length > 0 ? rows : [await ensureDefaultWorkspace(session.user.id)];
      if (!alive) return;
      setWorkspaces(availableWorkspaces);
      setWorkspace((current) => availableWorkspaces.find((row) => row.id === current?.id) ?? availableWorkspaces[0] ?? null);
      if (rows.length === 0) setFlash({ kind: "success", message: "Creamos tu espacio personal para que puedas empezar." });
    }).catch((error: unknown) => { if (alive) setFlash({ kind: "error", message: errorText(error) }); })
      .finally(() => { if (alive) setWorkspaceLoading(false); });
    return () => { alive = false; };
  }, [session?.user.id]);

  const filteredDecisions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return decisions.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (decisionRepositoryFilter === "none" ? item.repository_id !== null : decisionRepositoryFilter !== "all" && item.repository_id !== decisionRepositoryFilter) return false;
      if (!needle) return true;
      const repo = repositories.find((row) => row.id === item.repository_id)?.full_name ?? "";
      const haystack = [item.title, item.problem, item.decision, item.rationale ?? "", item.alternatives.join(" "), repo, ...item.links.map((link) => `${link.url} ${link.label ?? ""}`)].join(" ").toLocaleLowerCase();
      return haystack.includes(needle);
    });
  }, [decisions, decisionRepositoryFilter, query, repositories, statusFilter]);

  const filteredRepositories = useMemo(() => {
    const needle = repositoryQuery.trim().toLocaleLowerCase();
    return repositories.filter((repo) => {
      if (repositoryStatusFilter === "connected" && (!repo.provider_repository_id || !repo.is_connected)) return false;
      if (repositoryStatusFilter === "manual" && repo.provider_repository_id !== null) return false;
      if (repositoryStatusFilter === "disconnected" && (!repo.provider_repository_id || repo.is_connected)) return false;
      return !needle || `${repo.full_name} ${repo.url}`.toLocaleLowerCase().includes(needle);
    });
  }, [repositories, repositoryQuery, repositoryStatusFilter]);

  const globalSearchResults = useMemo<GlobalSearchResult[]>(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (needle.length < 2) return [];
    const decisionMatches = decisions.filter((item) => {
      const repo = repositories.find((row) => row.id === item.repository_id)?.full_name ?? "";
      return [item.title, item.problem, item.decision, item.rationale ?? "", repo, ...item.links.map((link) => `${link.url} ${link.label ?? ""}`)].join(" ").toLocaleLowerCase().includes(needle);
    }).slice(0, 3).map((decision) => ({ kind: "decision" as const, key: `decision-${decision.id}`, title: decision.title, detail: `${decision.status === "draft" ? "Borrador" : decision.status === "accepted" ? "Aceptada" : "Reemplazada"}${repositories.find((row) => row.id === decision.repository_id) ? ` · ${repositories.find((row) => row.id === decision.repository_id)?.full_name}` : ""}`, decision }));
    const repositoryMatches = repositories.filter((repo) => `${repo.full_name} ${repo.url}`.toLocaleLowerCase().includes(needle)).slice(0, 3).map((repository) => ({ kind: "repository" as const, key: `repository-${repository.id}`, title: repository.full_name, detail: repository.is_connected && repository.provider_repository_id ? "Sincronizado con GitHub" : "Repositorio del espacio", repository }));
    const eventMatches = repositoryEvents.filter((event) => {
      const repo = repositories.find((row) => row.id === event.repository_id)?.full_name ?? "";
      return [event.title, event.summary ?? "", event.actor_login ?? "", repo].join(" ").toLocaleLowerCase().includes(needle);
    }).slice(0, 3).map((event) => ({ kind: "event" as const, key: `event-${event.id}`, title: event.title, detail: `${event.event_type.replace("_", " ")} · ${repositories.find((row) => row.id === event.repository_id)?.full_name ?? "Repositorio"}`, event }));
    return [...decisionMatches, ...repositoryMatches, ...eventMatches].slice(0, 8);
  }, [decisions, query, repositories, repositoryEvents]);

  const timelineEntries = useMemo<TimelineEntry[]>(() => {
    const needle = activityQuery.trim().toLocaleLowerCase();
    const cutoff = activityRange === "all" ? 0 : Date.now() - Number(activityRange) * 24 * 60 * 60 * 1000;
    const matchesDate = (value: string) => Date.parse(value) >= cutoff;
    const matchesRepository = (id: string | null) => activityRepositoryFilter === "all" || (activityRepositoryFilter === "none" ? id === null : id === activityRepositoryFilter);
    const decisionEntries: TimelineEntry[] = activityTypeFilter === "all" || activityTypeFilter === "decision"
      ? decisions.filter((decision) => matchesRepository(decision.repository_id) && matchesDate(decision.created_at))
        .filter((decision) => {
          if (!needle) return true;
          const repository = repositories.find((item) => item.id === decision.repository_id)?.full_name ?? "";
          return [decision.title, decision.problem, decision.decision, decision.rationale ?? "", repository, ...decision.links.map((link) => link.url)].join(" ").toLocaleLowerCase().includes(needle);
        })
        .map((decision) => ({ kind: "decision", id: decision.id, occurredAt: decision.created_at, decision }))
      : [];
    const githubEntries: TimelineEntry[] = activityTypeFilter === "decision"
      ? []
      : repositoryEvents.filter((event) => (activityTypeFilter === "all" || event.event_type === activityTypeFilter)
        && matchesRepository(event.repository_id) && matchesDate(event.occurred_at))
        .filter((event) => {
          if (!needle) return true;
          const repository = repositories.find((item) => item.id === event.repository_id)?.full_name ?? "";
          return [event.title, event.summary ?? "", event.actor_login ?? "", repository].join(" ").toLocaleLowerCase().includes(needle);
        })
        .map((event) => ({ kind: "github", id: event.id, occurredAt: event.occurred_at, event }));
    return [...decisionEntries, ...githubEntries].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
  }, [activityQuery, activityRange, activityRepositoryFilter, activityTypeFilter, decisions, repositoryEvents, repositories]);

  const recentEntries = useMemo(() => [...decisions.map((decision) => ({ kind: "decision" as const, id: decision.id, occurredAt: decision.created_at, decision })), ...repositoryEvents.map((event) => ({ kind: "github" as const, id: event.id, occurredAt: event.occurred_at, event }))]
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)).slice(0, 6), [decisions, repositoryEvents]);

  const eventsNeedingContext = useMemo(() => repositoryEvents.filter((event) => {
    if (!event.url) return false;
    const eventUrl = event.url.replace(/\/$/, "");
    return !decisions.some((decision) => decision.repository_id === event.repository_id
      && decision.links.some((link) => link.url.replace(/\/$/, "") === eventUrl));
  }).slice(0, 4), [decisions, repositoryEvents]);

  function openSearchResult(result: GlobalSearchResult) {
    setQuery("");
    if (result.kind === "decision") {
      setSelectedDecision(result.decision);
    } else if (result.kind === "repository") {
      setRepositoryQuery(result.repository.full_name);
      setRepositoryStatusFilter("all");
      setView("repositories");
    } else {
      setActivityQuery(result.event.title);
      setActivityRepositoryFilter("all");
      setActivityTypeFilter("all");
      setActivityRange("all");
      setView("timeline");
    }
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) setFlash({ kind: "error", message: errorText(error) });
    else setFlash({ kind: "success", message: "Sesión cerrada." });
  }

  async function handleDeleteDecision(id: string): Promise<boolean> {
    try { await removeDecision(id); setSelectedDecision(null); await refreshData(); setFlash({ kind: "success", message: "Decisión eliminada." }); return true; }
    catch (error) { setFlash({ kind: "error", message: errorText(error) }); return false; }
  }

  async function handleDeleteRepository(repository: Repository) {
    if (!window.confirm(`¿Eliminar el repositorio ${repository.full_name}?`)) return;
    try { await removeRepository(repository.id); await refreshData(); setFlash({ kind: "success", message: "Repositorio eliminado." }); }
    catch (error) { setFlash({ kind: "error", message: errorText(error) }); }
  }

  async function handleConnectGithub() {
    if (!workspace) return;
    setGithubConnecting(true);
    try { await startGithubConnect(workspace.id); }
    catch (error) { setFlash({ kind: "error", message: errorText(error) }); setGithubConnecting(false); }
  }

  if (!isSupabaseConfigured || !supabase) return <main className="grid min-h-screen place-items-center bg-slate-50 p-6"><section className="max-w-lg rounded-2xl border border-amber-200 bg-white p-8 shadow-sm"><CircleDot className="text-amber-500" size={26} /><h1 className="mt-4 text-xl font-semibold">Conecta Supabase</h1><p className="mt-2 text-sm leading-6 text-slate-600">Configura <code className="rounded bg-slate-100 px-1">VITE_SUPABASE_URL</code> y <code className="rounded bg-slate-100 px-1">VITE_SUPABASE_PUBLISHABLE_KEY</code> en el archivo <code className="rounded bg-slate-100 px-1">.env</code>, y reinicia Vite.</p></section></main>;
  if (authLoading) return <main className="grid min-h-screen place-items-center bg-slate-50"><Spinner label="Conectando con Supabase" /></main>;
  if (passwordRecovery && session?.user) return <PasswordRecoveryScreen onComplete={() => { setPasswordRecovery(false); setFlash({ kind: "success", message: "Contraseña actualizada." }); }} />;
  if (!session?.user) return <><AuthScreen onMessage={setFlash} /><div className="fixed bottom-4 left-1/2 z-10 w-[min(92vw,420px)] -translate-x-1/2"><FlashMessage flash={flash} onClose={() => setFlash(null)} /></div></>;
  if (workspaceLoading) return <main className="grid min-h-screen place-items-center bg-slate-50"><Spinner label="Cargando tu espacio" /></main>;
  if (workspaces.length === 0 || !workspace) return <WorkspaceSetup onCreated={(created) => { setWorkspaces([created]); setWorkspace(created); setFlash({ kind: "success", message: "Espacio de trabajo creado." }); }} user={session.user} />;

  const userLabel = session.user.user_metadata?.display_name || session.user.email || "Tu cuenta";
  const viewTitle = view === "overview" ? "Resumen" : view === "decisions" ? "Decisiones" : view === "repositories" ? "Repositorios" : view === "workspaces" ? "Espacios de trabajo" : view === "settings" ? "Configuración" : "Historial de actividad";
  const navItems: { key: View; label: string; icon: typeof Layers3 }[] = [
    { key: "overview", label: "Resumen", icon: Layers3 },
    { key: "decisions", label: "Decisiones", icon: Lightbulb },
    { key: "repositories", label: "Repositorios", icon: GitBranch },
    { key: "timeline", label: "Actividad", icon: Activity },
    { key: "workspaces", label: "Espacios", icon: Layers3 },
    { key: "settings", label: "Configuración", icon: Settings },
  ];
  const openNewDecision = () => setDecisionModal("new");
  const modalDecision = decisionModal && typeof decisionModal === "object" && "id" in decisionModal ? decisionModal : undefined;
  const modalInitialEvent = decisionModal && typeof decisionModal === "object" && "initialEvent" in decisionModal ? decisionModal.initialEvent : undefined;

  return <div className="min-h-screen bg-[#f5f7fc] text-slate-900">
    <div className="mx-auto flex min-h-screen max-w-[1600px]">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200/80 bg-white/85 px-5 py-6 backdrop-blur md:flex">
        <a className="flex items-center gap-3" href="#inicio"><span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-700 text-white shadow-md shadow-indigo-200"><BookOpenText size={21} /></span><span><span className="block text-base font-semibold tracking-tight">Patchwork</span><span className="block text-[10px] font-medium uppercase tracking-[.16em] text-slate-400">Project memory</span></span></a>
        <div className="mt-10"><label className="px-3 text-[11px] font-semibold uppercase tracking-[.16em] text-slate-400" htmlFor="workspace-select">Espacio de trabajo</label><div className="relative mt-2"><select aria-label="Espacio de trabajo" className="w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-3 pr-9 text-sm font-medium text-slate-800 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" id="workspace-select" onChange={(event) => setWorkspace(workspaces.find((row) => row.id === event.target.value) ?? null)} value={workspace.id}>{workspaces.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-3 text-slate-400" size={16} /></div>
          <nav aria-label="Navegación principal" className="mt-5 space-y-1">{navItems.map(({ key, label, icon: Icon }) => <button aria-current={view === key ? "page" : undefined} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${view === key ? "bg-indigo-50 text-indigo-700 shadow-sm shadow-indigo-100/70 ring-1 ring-indigo-100" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`} key={key} onClick={() => setView(key)} type="button"><Icon className={view === key ? "text-indigo-600" : "text-slate-400 group-hover:text-slate-600"} size={18} strokeWidth={1.8} />{label}{key === "decisions" && <span className="ml-auto rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{decisions.length}</span>}</button>)}</nav>
        </div>
        <div className="mt-auto rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center gap-2 text-xs font-semibold text-slate-700"><CircleDot className="text-emerald-600" size={15} />Supabase conectado</div><p className="mt-2 text-xs leading-5 text-slate-500">Tus datos se guardan en la nube con control de acceso por espacio.</p></div>
        <div className="mt-4 flex items-center gap-3 rounded-lg px-2 py-2"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">{String(userLabel).slice(0, 1).toUpperCase()}</span><span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">{userLabel}</span><button aria-label="Cerrar sesión" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900" onClick={() => void signOut()} title="Cerrar sesión" type="button"><LogOut size={16} /></button></div>
      </aside>

      <main className="min-w-0 flex-1" id="inicio">
        <header className="sticky top-0 z-20 flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-xl sm:px-8">
          <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-indigo-600 text-white md:hidden"><BookOpenText size={19} /></span><div><p className="hidden text-xs text-slate-500 sm:block">{workspace.name}</p><h1 className="font-semibold tracking-tight">{viewTitle}</h1></div></div>
          <div className="flex items-center gap-2"><button aria-label="Actualizar datos" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-indigo-700 disabled:opacity-50" disabled={dataLoading} onClick={() => void refreshData()} title="Actualizar datos" type="button"><RefreshCw className={dataLoading ? "animate-spin" : ""} size={17} /></button><GlobalSearchBox onChange={(value) => { setQuery(value); if (value) setView("decisions"); }} onSelect={openSearchResult} results={globalSearchResults} value={query} />{view === "repositories" ? <><button className={buttonSecondary} disabled={githubConnecting || workspace.created_by !== session.user.id} onClick={() => void handleConnectGithub()} title={workspace.created_by !== session.user.id ? "Solo el propietario del espacio puede conectar GitHub." : undefined} type="button"><GitBranch size={16} />{githubConnecting ? "Conectando…" : "Conectar GitHub"}</button><button className={buttonPrimary} onClick={() => setRepositoryModal(true)} type="button"><Plus size={17} />Añadir repositorio</button></> : view === "workspaces" ? <button className={buttonPrimary} onClick={() => setWorkspaceModal(true)} type="button"><Plus size={17} />Nuevo espacio</button> : <button className={buttonPrimary} onClick={openNewDecision} type="button"><Plus size={17} /><span className="hidden sm:inline">Nueva decisión</span><span className="sm:hidden">Nueva</span></button>}<button aria-label="Cerrar sesión" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden" onClick={() => void signOut()} title="Cerrar sesión" type="button"><LogOut size={17} /></button></div>
        </header>
        <div className="border-b border-slate-200 bg-white px-4 py-2.5 md:hidden"><nav aria-label="Navegación principal móvil" className="flex gap-1 overflow-x-auto">{navItems.map(({ key, label, icon: Icon }) => <button aria-current={view === key ? "page" : undefined} className={`flex min-w-max items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${view === key ? "bg-indigo-50 text-indigo-700" : "text-slate-600"}`} key={key} onClick={() => setView(key)} type="button"><Icon size={15} />{label}</button>)}</nav><div className="mt-2 sm:hidden"><GlobalSearchBox mobile onChange={(value) => { setQuery(value); if (value) setView("decisions"); }} onSelect={openSearchResult} results={globalSearchResults} value={query} /></div></div>

        <section className="mx-auto max-w-6xl px-4 py-7 sm:px-8 sm:py-10">
          <FlashMessage flash={flash} onClose={() => setFlash(null)} />
          {dataLoading && <div className="mb-4"><Spinner label="Actualizando datos" /></div>}

          {view === "overview" && <OverviewPage userLabel={String(userLabel)} workspace={workspace} decisions={decisions} repositories={repositories} repositoryEvents={repositoryEvents} memberCount={memberCount} eventsNeedingContext={eventsNeedingContext} recentEntries={recentEntries} onSetView={setView} onSelectDecision={setSelectedDecision} onSetDecisionModal={setDecisionModal} onOpenNewDecision={openNewDecision} onOpenRepositoryForm={() => setRepositoryModal(true)} />}

          {view === "decisions" && <DecisionsPage filteredDecisions={filteredDecisions} decisions={decisions} repositories={repositories} query={query} statusFilter={statusFilter} repositoryFilter={decisionRepositoryFilter} onRepositoryFilter={setDecisionRepositoryFilter} onStatusFilter={setStatusFilter} onSelectDecision={setSelectedDecision} onCreateDecision={openNewDecision} />}

          {view === "timeline" && <ActivityPage timelineEntries={timelineEntries} decisions={decisions} repositoryEvents={repositoryEvents} repositories={repositories} query={activityQuery} repositoryFilter={activityRepositoryFilter} typeFilter={activityTypeFilter} range={activityRange} onQuery={setActivityQuery} onRepositoryFilter={setActivityRepositoryFilter} onTypeFilter={setActivityTypeFilter} onRange={setActivityRange} onSelectDecision={setSelectedDecision} />}

          {view === "workspaces" && <WorkspacesPage workspaces={workspaces} activeWorkspace={workspace} userId={session.user.id} onSelect={(item) => { setWorkspace(item); setView("overview"); }} />}

          {view === "settings" && <SettingsPage userLabel={String(userLabel)} session={session} workspace={workspace} memberCount={memberCount} installations={installations} onSignOut={() => void signOut()} onSetView={setView} />}

          {view === "repositories" && <RepositoriesPage filteredRepositories={filteredRepositories} repositories={repositories} installations={installations} decisions={decisions} repositoryEvents={repositoryEvents} query={repositoryQuery} statusFilter={repositoryStatusFilter} onQuery={setRepositoryQuery} onStatusFilter={setRepositoryStatusFilter} onAddRepository={() => setRepositoryModal(true)} onViewActivity={() => setView("timeline")} onDeleteRepository={(repo) => void handleDeleteRepository(repo)} />}
        </section>
      </main>
    </div>

    {decisionModal !== null && <DecisionForm decision={modalDecision} initialEvent={modalInitialEvent} onClose={() => setDecisionModal(null)} onSaved={() => { void refreshData(); setFlash({ kind: "success", message: modalDecision ? "Cambios guardados." : "Decisión guardada." }); }} repositories={repositories} userId={session.user.id} workspaceId={workspace.id} />}
    {repositoryModal && <RepositoryForm onClose={() => setRepositoryModal(false)} onSaved={() => { void refreshData(); setFlash({ kind: "success", message: "Repositorio añadido." }); }} workspaceId={workspace.id} />}
    {workspaceModal && <WorkspaceForm onClose={() => setWorkspaceModal(false)} onCreated={(created) => { setWorkspaces((current) => [...current, created]); setWorkspace(created); setView("overview"); setFlash({ kind: "success", message: "Espacio de trabajo creado." }); }} />}
    {selectedDecision && <DecisionDetails currentUserId={session.user.id} decision={selectedDecision} events={repositoryEvents} onClose={() => setSelectedDecision(null)} onDelete={() => handleDeleteDecision(selectedDecision.id)} onEdit={() => { setDecisionModal(selectedDecision); setSelectedDecision(null); }} repository={repositories.find((row) => row.id === selectedDecision.repository_id)} />}
  </div>;
}


export default App;
