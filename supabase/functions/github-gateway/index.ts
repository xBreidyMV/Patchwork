import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type AdminClient = SupabaseClient;
type GithubRepository = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  private?: boolean;
};

const GITHUB_API = "https://api.github.com";
const encoder = new TextEncoder();

function html(message: string, status = 200) {
  return new Response(`<!doctype html><html lang="es"><meta charset="utf-8"><title>Patchwork · GitHub</title><body style="font-family:system-ui,sans-serif;max-width:38rem;margin:12vh auto;padding:0 1.5rem;color:#0f172a"><h1>Patchwork</h1><p>${message}</p><p>Puedes cerrar esta pestaña y volver a Patchwork.</p></body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function returnToApp(origin: string, state: "connected" | "error") {
  const url = new URL(origin);
  url.searchParams.set("github", state);
  return Response.redirect(url.toString(), 302);
}

async function hashState(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomState() {
  return crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
}

async function consumeState(admin: AdminClient, rawState: string, stage: "install" | "oauth") {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("github_connect_states")
    .update({ used_at: now })
    .eq("state_hash", await hashState(rawState))
    .eq("flow_stage", stage)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("state_hash,workspace_id,user_id,return_origin,flow_stage,github_installation_id,expires_at")
    .maybeSingle();
  if (error) throw new Error("No se pudo validar el estado de la conexión.");
  return data;
}

async function githubRequest(url: string, token: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Patchwork-DevTools",
    },
  });
  if (!response.ok) throw new Error(`GitHub API respondió ${response.status}.`);
  return response;
}

async function githubPages<T>(url: string, token: string): Promise<T[]> {
  const rows: T[] = [];
  let next: string | null = url;
  let pages = 0;
  while (next && pages < 50) {
    const response = await githubRequest(next, token);
    const data = await response.json();
    if (Array.isArray(data.repositories)) rows.push(...(data.repositories as T[]));
    else if (Array.isArray(data.installations)) rows.push(...(data.installations as T[]));
    else throw new Error("GitHub devolvió una respuesta inesperada.");
    const link = response.headers.get("Link") ?? "";
    const nextPart = link.split(",").find((part) => part.includes('rel="next"'));
    next = nextPart?.match(/<([^>]+)>/)?.[1] ?? null;
    pages++;
  }
  if (next) throw new Error("El repositorio tiene demasiadas páginas para sincronizar en una sola operación.");
  return rows;
}

async function syncRepositories(admin: AdminClient, workspaceId: string, installationId: string, repos: GithubRepository[]) {
  if (repos.length === 0) return;
  const ids = repos.map((repo) => String(repo.id));
  const names = repos.map((repo) => repo.full_name);
  const [{ data: byId, error: idError }, { data: byName, error: nameError }] = await Promise.all([
    admin.from("repositories").select("id,provider_repository_id,full_name").eq("workspace_id", workspaceId).in("provider_repository_id", ids),
    admin.from("repositories").select("id,provider_repository_id,full_name").eq("workspace_id", workspaceId).in("full_name", names),
  ]);
  if (idError || nameError) throw new Error("No se pudieron revisar los repositorios existentes.");

  const existingRows = [...(byId ?? []), ...(byName ?? [])];
  const updates: Array<{ id: string; values: Record<string, unknown> }> = [];
  const inserts: Array<Record<string, unknown>> = [];
  for (const repo of repos) {
    const existing = existingRows.find((row) => row.provider_repository_id === String(repo.id))
      ?? existingRows.find((row) => row.full_name.toLowerCase() === repo.full_name.toLowerCase());
    const values = {
      name: repo.name,
      full_name: repo.full_name,
      url: repo.html_url,
      provider: "github",
      provider_repository_id: String(repo.id),
      github_installation_id: installationId,
      is_connected: true,
    };
    if (existing) updates.push({ id: existing.id, values });
    else inserts.push({ workspace_id: workspaceId, ...values });
  }

  for (const update of updates) {
    const { error } = await admin.from("repositories").update(update.values).eq("id", update.id);
    if (error) throw new Error("No se pudo actualizar un repositorio conectado.");
  }
  if (inserts.length) {
    const { error } = await admin.from("repositories").upsert(inserts, { onConflict: "workspace_id,full_name" });
    if (error) throw new Error("No se pudieron guardar los repositorios de GitHub.");
  }
}

async function completeOAuth(req: Request, admin: AdminClient) {
  const url = new URL(req.url);
  const rawState = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!rawState || !code) return html("La respuesta de GitHub no contiene los datos necesarios para completar la conexión.", 400);

  const state = await consumeState(admin, rawState, "oauth");
  if (!state || !state.github_installation_id) return html("El enlace de instalación expiró o ya se usó. Vuelve a iniciar la conexión desde Patchwork.", 400);
  const clientId = Deno.env.get("GITHUB_APP_CLIENT_ID");
  const clientSecret = Deno.env.get("GITHUB_APP_CLIENT_SECRET");
  const appId = Deno.env.get("GITHUB_APP_ID");
  if (!clientId || !clientSecret || !appId) return returnToApp(state.return_origin, "error");

  const callbackUrl = `${Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "")}/functions/v1/github-gateway`;
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: callbackUrl }),
  });
  if (!tokenResponse.ok) throw new Error("GitHub no aceptó el intercambio de autorización.");
  const tokenResult = await tokenResponse.json();
  if (typeof tokenResult.access_token !== "string") throw new Error("GitHub no devolvió un token de usuario.");
  const userToken = tokenResult.access_token as string;

  const userResponse = await githubRequest(`${GITHUB_API}/user`, userToken);
  const githubUser = await userResponse.json();
  const installations = await githubPages<Record<string, unknown>>(`${GITHUB_API}/user/installations?per_page=100`, userToken);
  const installation = installations.find((item) =>
    String(item.id) === String(state.github_installation_id) && String(item.app_id) === appId
  );
  if (!installation) {
    return returnToApp(state.return_origin, "error");
  }

  const githubAccount = installation.account as Record<string, unknown> | undefined;
  if (!githubAccount || typeof githubAccount.login !== "string") throw new Error("GitHub no devolvió la cuenta de la instalación.");
  const installationId = String(installation.id);
  const { data: existingInstallation, error: lookupError } = await admin
    .from("github_app_installations")
    .select("workspace_id")
    .eq("github_installation_id", installationId)
    .maybeSingle();
  if (lookupError) throw new Error("No se pudo comprobar la instalación existente.");
  if (existingInstallation && existingInstallation.workspace_id !== state.workspace_id) {
    return returnToApp(state.return_origin, "error");
  }

  const repositories = await githubPages<GithubRepository>(
    `${GITHUB_API}/user/installations/${installationId}/repositories?per_page=100`,
    userToken,
  );

  const { error: installError } = await admin.from("github_app_installations").upsert({
    workspace_id: state.workspace_id,
    github_installation_id: installationId,
    account_login: githubAccount.login,
    account_type: typeof githubAccount.type === "string" ? githubAccount.type : "User",
    connected_by: state.user_id,
    is_active: true,
  }, { onConflict: "github_installation_id" });
  if (installError) throw new Error("No se pudo guardar la instalación de GitHub.");

  await syncRepositories(admin, state.workspace_id, installationId, repositories);
  console.info("GitHub installation connected", { account: githubAccount.login, repositoryCount: repositories.length, user: githubUser.login });
  // The temporary GitHub user access token is deliberately not persisted.
  return returnToApp(state.return_origin, "connected");
}

async function startOAuth(req: Request, admin: AdminClient) {
  const url = new URL(req.url);
  const rawState = url.searchParams.get("state");
  const installationId = url.searchParams.get("installation_id");
  const action = url.searchParams.get("setup_action");
  if (!rawState || !installationId || !/^\d+$/.test(installationId) || action !== "install") {
    return html("La instalación no se completó. Vuelve a iniciar la conexión desde Patchwork.", 400);
  }

  const state = await consumeState(admin, rawState, "install");
  if (!state) return html("El enlace de instalación expiró o ya se usó. Vuelve a iniciar la conexión desde Patchwork.", 400);
  const clientId = Deno.env.get("GITHUB_APP_CLIENT_ID");
  if (!clientId) return returnToApp(state.return_origin, "error");

  const oauthState = randomState();
  const { error } = await admin.from("github_connect_states").insert({
    state_hash: await hashState(oauthState),
    workspace_id: state.workspace_id,
    user_id: state.user_id,
    return_origin: state.return_origin,
    flow_stage: "oauth",
    github_installation_id: installationId,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  if (error) throw new Error("No se pudo continuar la autorización de GitHub.");

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", `${Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "")}/functions/v1/github-gateway`);
  authorizeUrl.searchParams.set("state", oauthState);
  return Response.redirect(authorizeUrl.toString(), 302);
}

function constantTimeEqual(a: string, b: string) {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

async function verifySignature(payload: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(signature, `sha256=${hex}`);
}

async function syncWebhookRepositories(admin: AdminClient, workspaceId: string, installationId: string, repos: GithubRepository[]) {
  await syncRepositories(admin, workspaceId, installationId, repos);
}

async function eventRows(admin: AdminClient, deliveryId: string, eventName: string, action: string | null, payload: Record<string, unknown>, workspaceId: string, installationId: string) {
  const repository = payload.repository as Record<string, unknown> | undefined;
  if (!repository || !repository.id) return false;
  const repoExternalId = String(repository.id);
  const { data: repoRow, error: repoError } = await admin.from("repositories")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("provider_repository_id", repoExternalId)
    .eq("github_installation_id", installationId)
    .eq("is_connected", true)
    .maybeSingle();
  if (repoError || !repoRow) return false;

  const sender = payload.sender as Record<string, unknown> | undefined;
  const actor = typeof sender?.login === "string" ? sender.login : null;
  const rows: Array<Record<string, unknown>> = [];
  const webUrl = typeof repository.html_url === "string" ? repository.html_url : "";

  if (eventName === "push") {
    const commits = Array.isArray(payload.commits) ? payload.commits.slice(0, 30) as Array<Record<string, unknown>> : [];
    for (const commit of commits) {
      const sha = typeof commit.id === "string" ? commit.id : "";
      const message = typeof commit.message === "string" ? commit.message.split("\n")[0].trim().slice(0, 500) : "Commit";
      if (!sha || !message) continue;
      rows.push({
        workspace_id: workspaceId,
        repository_id: repoRow.id,
        github_delivery_id: deliveryId,
        external_id: `commit:${sha}`,
        event_type: "push",
        action: "pushed",
        title: message,
        summary: "Commit enviado a GitHub",
        url: `${webUrl}/commit/${sha}`,
        actor_login: actor,
        occurred_at: (commit.committer as Record<string, unknown> | undefined)?.date ?? new Date().toISOString(),
      });
    }
  } else if (eventName === "pull_request") {
    const pull = payload.pull_request as Record<string, unknown> | undefined;
    if (pull && pull.id && typeof pull.title === "string") rows.push({
      workspace_id: workspaceId,
      repository_id: repoRow.id,
      github_delivery_id: deliveryId,
      external_id: `pull:${pull.id}`,
      event_type: "pull_request",
      action,
      title: pull.title.slice(0, 500),
      summary: `Pull request #${String(pull.number ?? "")} · ${action ?? "actualizado"}`,
      url: typeof pull.html_url === "string" ? pull.html_url : null,
      actor_login: actor,
      occurred_at: typeof pull.updated_at === "string" ? pull.updated_at : new Date().toISOString(),
    });
  } else if (eventName === "issues") {
    const issue = payload.issue as Record<string, unknown> | undefined;
    if (issue && issue.id && typeof issue.title === "string" && issue.pull_request === undefined) rows.push({
      workspace_id: workspaceId,
      repository_id: repoRow.id,
      github_delivery_id: deliveryId,
      external_id: `issue:${issue.id}`,
      event_type: "issues",
      action,
      title: issue.title.slice(0, 500),
      summary: `Issue #${String(issue.number ?? "")} · ${action ?? "actualizado"}`,
      url: typeof issue.html_url === "string" ? issue.html_url : null,
      actor_login: actor,
      occurred_at: typeof issue.updated_at === "string" ? issue.updated_at : new Date().toISOString(),
    });
  }

  if (rows.length) {
    const { error } = await admin.from("repository_events").upsert(rows, { onConflict: "github_delivery_id,external_id", ignoreDuplicates: true });
    if (error) throw new Error("No se pudo guardar un evento de GitHub.");
  }
  return rows.length > 0;
}

async function handleWebhook(req: Request, admin: AdminClient) {
  const rawBody = await req.text();
  if (rawBody.length > 2_000_000) return new Response("payload too large", { status: 413 });
  const signature = req.headers.get("X-Hub-Signature-256") ?? "";
  const secret = Deno.env.get("GITHUB_WEBHOOK_SECRET");
  if (!secret || !signature || !await verifySignature(rawBody, signature, secret)) return new Response("invalid signature", { status: 401 });

  const deliveryId = req.headers.get("X-GitHub-Delivery") ?? "";
  const eventName = req.headers.get("X-GitHub-Event") ?? "";
  if (!deliveryId || deliveryId.length > 200 || !eventName) return new Response("missing delivery headers", { status: 400 });
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody); }
  catch { return new Response("invalid JSON", { status: 400 }); }

  const { error: insertError } = await admin.from("github_webhook_deliveries").insert({ delivery_id: deliveryId, event_name: eventName, status: "processing" });
  if (insertError && insertError.code !== "23505") {
    console.error("Could not record GitHub webhook", insertError.message);
    return new Response("could not record delivery", { status: 500 });
  }
  if (insertError?.code === "23505") {
    const { data: previous } = await admin.from("github_webhook_deliveries").select("status").eq("delivery_id", deliveryId).maybeSingle();
    if (previous?.status === "processed" || previous?.status === "ignored") return Response.json({ ok: true, duplicate: true }, { status: 202 });
  }

  try {
    const installation = payload.installation as Record<string, unknown> | undefined;
    const installationId = installation?.id ? String(installation.id) : "";
    const { data: connected } = installationId
      ? await admin.from("github_app_installations").select("workspace_id,is_active").eq("github_installation_id", installationId).maybeSingle()
      : { data: null };

    let status: "processed" | "ignored" = "ignored";
    if (connected && eventName === "installation" && ["deleted", "suspend", "unsuspend"].includes(String(payload.action))) {
      const isActive = payload.action === "unsuspend";
      const { error } = await admin.from("github_app_installations").update({ is_active: isActive }).eq("github_installation_id", installationId);
      if (error) throw new Error("No se pudo actualizar el estado de la instalación.");
      const { error: repoError } = await admin.from("repositories").update({ is_connected: isActive }).eq("workspace_id", connected.workspace_id).eq("github_installation_id", installationId);
      if (repoError) throw new Error("No se pudo actualizar el estado de los repositorios.");
      status = "processed";
    } else if (connected && eventName === "installation_repositories") {
      const added = Array.isArray(payload.repositories_added) ? payload.repositories_added as GithubRepository[] : [];
      const removed = Array.isArray(payload.repositories_removed) ? payload.repositories_removed as GithubRepository[] : [];
      await syncWebhookRepositories(admin, connected.workspace_id, installationId, added);
      if (removed.length) {
        const ids = removed.map((repo) => String(repo.id));
        const { error } = await admin.from("repositories").update({ is_connected: false })
          .eq("workspace_id", connected.workspace_id)
          .eq("github_installation_id", installationId)
          .in("provider_repository_id", ids);
        if (error) throw new Error("No se pudo actualizar el acceso a los repositorios.");
      }
      status = "processed";
    } else if (connected?.is_active && ["push", "pull_request", "issues"].includes(eventName)) {
      const stored = await eventRows(admin, deliveryId, eventName, typeof payload.action === "string" ? payload.action : null, payload, connected.workspace_id, installationId);
      status = stored ? "processed" : "ignored";
    }

    const { error } = await admin.from("github_webhook_deliveries").update({ status, processed_at: new Date().toISOString() }).eq("delivery_id", deliveryId);
    if (error) throw new Error("No se pudo completar el registro de la entrega.");
    return Response.json({ ok: true }, { status: 202 });
  } catch (error) {
    console.error("GitHub webhook processing failed", error instanceof Error ? error.message : "unknown error");
    return new Response("webhook processing failed", { status: 500 });
  }
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method === "POST") return handleWebhook(req, ctx.supabaseAdmin);
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });

    const url = new URL(req.url);
    const oauthError = url.searchParams.get("error");
    if (oauthError && url.searchParams.has("state")) {
      const rawState = url.searchParams.get("state")!;
      const state = await consumeState(ctx.supabaseAdmin, rawState, "oauth");
      if (state) return returnToApp(state.return_origin, "error");
      return html("La autorización expiró. Vuelve a iniciar la conexión desde Patchwork.", 400);
    }
    if (url.searchParams.has("installation_id")) return startOAuth(req, ctx.supabaseAdmin);
    if (url.searchParams.has("code")) {
      try { return await completeOAuth(req, ctx.supabaseAdmin); }
      catch (error) {
        console.error("GitHub OAuth callback failed", error instanceof Error ? error.message : "unknown error");
        const rawState = url.searchParams.get("state");
        if (rawState) {
          const { data } = await ctx.supabaseAdmin.from("github_connect_states").select("return_origin").eq("state_hash", await hashState(rawState)).maybeSingle();
          if (data?.return_origin) return returnToApp(data.return_origin, "error");
        }
        return html("No se pudo completar la conexión. Vuelve a intentarlo desde Patchwork.", 400);
      }
    }
    return html("Abre la conexión desde Patchwork para continuar.", 400);
  }),
};
