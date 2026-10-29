import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function hashState(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function allowedOrigins() {
  return new Set(
    (Deno.env.get("PATCHWORK_ALLOWED_ORIGINS") ?? "http://localhost:5173,http://127.0.0.1:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const userId = ctx.userClaims?.id;
    if (typeof userId !== "string") return json({ error: "Inicia sesión para conectar GitHub." }, 401);

    const origin = req.headers.get("origin");
    if (!origin || !allowedOrigins().has(origin)) {
      return json({ error: "El dominio de esta app no está permitido para iniciar la conexión." }, 403);
    }

    const appSlug = Deno.env.get("GITHUB_APP_SLUG")?.trim();
    if (!appSlug || !/^[a-z0-9-]+$/i.test(appSlug)) {
      return json({ error: "La GitHub App aún no está configurada en Supabase." }, 503);
    }

    let workspaceId = "";
    try {
      const body = await req.json();
      workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
    } catch {
      return json({ error: "Solicitud inválida." }, 400);
    }
    if (!workspaceId) return json({ error: "Falta el espacio de trabajo." }, 400);

    const { data: membership, error: membershipError } = await ctx.supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (membershipError) {
      console.error("Could not verify workspace membership", membershipError.message);
      return json({ error: "No se pudo verificar tu acceso al espacio." }, 500);
    }
    if (membership?.role !== "owner") return json({ error: "Solo el propietario del espacio puede conectar GitHub." }, 403);

    const rawState = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
    const stateHash = await hashState(rawState);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error: cleanupError } = await ctx.supabaseAdmin
      .from("github_connect_states")
      .delete()
      .lt("expires_at", new Date().toISOString());
    if (cleanupError) console.warn("Could not clean expired GitHub connect states", cleanupError.message);

    const { error: insertError } = await ctx.supabaseAdmin.from("github_connect_states").insert({
      state_hash: stateHash,
      workspace_id: workspaceId,
      user_id: userId,
      return_origin: origin,
      flow_stage: "install",
      expires_at: expiresAt,
    });
    if (insertError) {
      console.error("Could not create GitHub connect state", insertError.message);
      return json({ error: "No se pudo iniciar la conexión con GitHub." }, 500);
    }

    const installUrl = new URL(`https://github.com/apps/${appSlug}/installations/new`);
    installUrl.searchParams.set("state", rawState);
    return json({ installUrl: installUrl.toString() });
  }),
};
