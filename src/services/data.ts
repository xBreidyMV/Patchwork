import { supabase } from "../lib/supabase";
import type { Decision, DecisionInput, DecisionLink, GithubInstallation, Repository, RepositoryEvent, Workspace } from "../types";

function client() {
  if (!supabase) throw new Error("Falta configurar la conexión con Supabase en .env.");
  return supabase;
}

function raise(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function ensureProfile(userId: string, displayName: string | null) {
  const db = client();
  const { error } = await db.from("profiles").upsert(
    { id: userId, display_name: displayName },
    { onConflict: "id", ignoreDuplicates: false },
  );
  raise(error);
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const { data, error } = await client().from("workspaces").select("id,name,slug,created_by").order("created_at");
  raise(error);
  return (data ?? []) as Workspace[];
}

export async function ensureDefaultWorkspace(userId: string): Promise<Workspace> {
  const db = client();
  const slug = `personal-${userId.replaceAll("-", "").slice(0, 12)}`;
  const findExisting = () => db.from("workspaces")
    .select("id,name,slug,created_by")
    .eq("created_by", userId)
    .eq("slug", slug)
    .maybeSingle();

  const { data: existing, error: lookupError } = await findExisting();
  raise(lookupError);
  if (existing) return existing as Workspace;

  const { data, error } = await db.from("workspaces")
    .insert({ name: "Personal", slug, created_by: userId })
    .select("id,name,slug,created_by")
    .single();
  if (!error) return data as Workspace;

  // React Strict Mode or a second tab can race the first insert. The existing
  // (created_by, slug) constraint makes this lookup safe and idempotent.
  if (error.code === "23505") {
    const { data: createdByOtherRequest, error: retryError } = await findExisting();
    raise(retryError);
    if (createdByOtherRequest) return createdByOtherRequest as Workspace;
  }
  raise(error);
  throw new Error("No se pudo preparar el espacio personal.");
}

export async function countWorkspaceMembers(workspaceId: string): Promise<number> {
  const { count, error } = await client()
    .from("workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  raise(error);
  return count ?? 0;
}

export async function createWorkspace(name: string, userId: string): Promise<Workspace> {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "mi-espacio";
  const { data, error } = await client()
    .from("workspaces")
    .insert({ name: name.trim(), slug: slug + "-" + crypto.randomUUID().slice(0, 6), created_by: userId })
    .select("id,name,slug,created_by")
    .single();
  raise(error);
  return data as Workspace;
}

export async function listRepositories(workspaceId: string): Promise<Repository[]> {
  const { data, error } = await client()
    .from("repositories")
    .select("id,workspace_id,name,full_name,url,created_at,provider_repository_id,is_connected")
    .eq("workspace_id", workspaceId)
    .order("full_name");
  raise(error);
  return (data ?? []) as Repository[];
}

export async function listGithubInstallations(workspaceId: string): Promise<GithubInstallation[]> {
  const { data, error } = await client()
    .from("github_app_installations")
    .select("id,workspace_id,github_installation_id,account_login,account_type,is_active,connected_at")
    .eq("workspace_id", workspaceId)
    .order("connected_at", { ascending: false });
  raise(error);
  return (data ?? []) as GithubInstallation[];
}

export async function listRepositoryEvents(workspaceId: string): Promise<RepositoryEvent[]> {
  const { data, error } = await client()
    .from("repository_events")
    .select("id,workspace_id,repository_id,event_type,action,title,summary,url,actor_login,occurred_at")
    .eq("workspace_id", workspaceId)
    .order("occurred_at", { ascending: false })
    .limit(100);
  raise(error);
  return (data ?? []) as RepositoryEvent[];
}

export async function startGithubConnect(workspaceId: string): Promise<void> {
  const { data, error } = await client().functions.invoke("github-connect-start", { body: { workspace_id: workspaceId } });
  raise(error);
  if (typeof data?.installUrl !== "string") throw new Error("Supabase no devolvió el enlace de instalación de GitHub.");
  window.location.assign(data.installUrl);
}

export async function addRepository(
  workspaceId: string,
  repository: Pick<Repository, "name" | "full_name" | "url">,
): Promise<Repository> {
  const { data, error } = await client()
    .from("repositories")
    .insert({ workspace_id: workspaceId, ...repository })
    .select("id,workspace_id,name,full_name,url,created_at,provider_repository_id,is_connected")
    .single();
  raise(error);
  return data as Repository;
}

export async function removeRepository(id: string): Promise<void> {
  const { error } = await client().from("repositories").delete().eq("id", id);
  raise(error);
}

export async function listDecisions(workspaceId: string): Promise<Decision[]> {
  const db = client();
  const { data, error } = await db
    .from("decisions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  raise(error);
  const rows = (data ?? []) as Omit<Decision, "links">[];
  if (rows.length === 0) return [];
  const { data: linkRows, error: linkError } = await db
    .from("decision_links")
    .select("*")
    .in("decision_id", rows.map((row) => row.id))
    .order("created_at");
  raise(linkError);
  const links = (linkRows ?? []) as DecisionLink[];
  return rows.map((row) => ({ ...row, alternatives: Array.isArray(row.alternatives) ? row.alternatives : [], links: links.filter((link) => link.decision_id === row.id) }));
}

export async function saveDecision(input: DecisionInput, userId: string, id?: string): Promise<Decision> {
  const db = client();
  const payload = {
    workspace_id: input.workspace_id,
    repository_id: input.repository_id,
    title: input.title.trim(),
    problem: input.problem.trim(),
    decision: input.decision.trim(),
    rationale: input.rationale?.trim() || null,
    alternatives: input.alternatives,
    consequences: input.consequences?.trim() || null,
    risks: input.risks?.trim() || null,
    status: input.status,
    author_id: userId,
  };
  const result = id
    ? await db.from("decisions").update(payload).eq("id", id).select("*").single()
    : await db.from("decisions").insert(payload).select("*").single();
  raise(result.error);
  const saved = result.data as Omit<Decision, "links">;
  const { data: existing, error: lookupError } = await db
    .from("decision_links")
    .select("id")
    .eq("decision_id", saved.id);
  raise(lookupError);
  const oldLinks = existing ?? [];
  const url = input.link_url.trim();
  if (url) {
    const linkPayload = {
      decision_id: saved.id,
      provider: new URL(url).hostname === "github.com" ? "github" : "external",
      resource_type: input.link_type,
      url,
      label: input.link_label.trim() || null,
    };
    if (oldLinks[0]) {
      const { error } = await db.from("decision_links").update(linkPayload).eq("id", oldLinks[0].id);
      raise(error);
    } else {
      const { error } = await db.from("decision_links").insert(linkPayload);
      raise(error);
    }
  } else if (oldLinks.length) {
    const { error } = await db.from("decision_links").delete().eq("decision_id", saved.id);
    raise(error);
  }
  return { ...saved, alternatives: Array.isArray(saved.alternatives) ? saved.alternatives : [], links: [] };
}

export async function removeDecision(id: string): Promise<void> {
  const { error } = await client().from("decisions").delete().eq("id", id);
  raise(error);
}
