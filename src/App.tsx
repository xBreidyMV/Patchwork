import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity, AlertCircle, BookOpenText, Check, ChevronDown, CircleDot, Clock3,
  ExternalLink, FileText, GitBranch, Layers3, Lightbulb, Link2,
  LoaderCircle, LogOut, Plus, RefreshCw, Search, Settings, ShieldCheck, Trash2, X,
} from "lucide-react";
import type { Session, User } from "@supabase/supabase-js";
import { addRepository, countWorkspaceMembers, createWorkspace, ensureDefaultWorkspace, ensureProfile, listDecisions, listGithubInstallations, listRepositoryEvents, listRepositories, listWorkspaces, removeDecision, removeRepository, saveDecision, startGithubConnect } from "./services/data";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import type { Decision, DecisionInput, DecisionStatus, GithubInstallation, Repository, RepositoryEvent, Workspace } from "./types";

type View = "overview" | "decisions" | "repositories" | "timeline" | "workspaces" | "settings";
type Flash = { kind: "success" | "error" | "info"; message: string } | null;
type TimelineEntry =
  | { kind: "decision"; id: string; occurredAt: string; decision: Decision }
  | { kind: "github"; id: string; occurredAt: string; event: RepositoryEvent };
type GlobalSearchResult =
  | { kind: "decision"; key: string; title: string; detail: string; decision: Decision }
  | { kind: "repository"; key: string; title: string; detail: string; repository: Repository }
  | { kind: "event"; key: string; title: string; detail: string; event: RepositoryEvent };

function prettyDate(value: string) {
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium" }).format(new Date(value));
}

function errorText(error: unknown) {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("invalid login credentials")) return "El correo o la contraseña no son correctos.";
    if (message.includes("user already registered")) return "Ya existe una cuenta con ese correo.";
    if (message.includes("password should be at least")) return "La contraseña debe tener al menos 6 caracteres.";
    if (message.includes("duplicate key")) return "Ya existe un registro con esos datos.";
    if (message.includes("foreign key constraint")) return "No puedes eliminar este repositorio porque tiene decisiones asociadas.";
    return error.message;
  }
  return "Ocurrió un error inesperado. Inténtalo de nuevo.";
}

function inferGithubReferenceType(value: string): DecisionInput["link_type"] | null {
  try {
    const url = new URL(value);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;
    if (/\/commit\//i.test(url.pathname)) return "commit";
    if (/\/(pull|pulls)\//i.test(url.pathname)) return "pull_request";
    if (/\/issues\//i.test(url.pathname)) return "issue";
  } catch {
    return null;
  }
  return null;
}

function Spinner({ label = "Cargando" }: { label?: string }) {
  return <span className="inline-flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={16} aria-hidden="true" />{label}</span>;
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="modal-title" aria-modal="true" className={`my-auto max-h-[min(92vh,900px)] w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl ${wide ? "max-w-3xl" : "max-w-xl"}`} role="dialog">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-6 py-4 backdrop-blur">
          <h2 className="font-semibold tracking-tight text-slate-950" id="modal-title">{title}</h2>
          <button aria-label="Cerrar" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="p-6">{children}</div>
      </section>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block space-y-1.5"><span className="block text-sm font-medium text-slate-700">{label}</span>{children}{hint && <span className="block text-xs leading-5 text-slate-500">{hint}</span>}</label>;
}

const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100";
const buttonPrimary = "inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-55";
const buttonSecondary = "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55";

function FlashMessage({ flash, onClose }: { flash: Flash; onClose: () => void }) {
  if (!flash) return null;
  const success = flash.kind === "success";
  return <div className={`mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${success ? "border-emerald-200 bg-emerald-50 text-emerald-900" : flash.kind === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-indigo-200 bg-indigo-50 text-indigo-900"}`} role="status">
    {success ? <Check className="mt-0.5 shrink-0" size={16} /> : <AlertCircle className="mt-0.5 shrink-0" size={16} />}
    <span className="min-w-0 flex-1">{flash.message}</span>
    <button aria-label="Cerrar aviso" className="shrink-0 opacity-70 hover:opacity-100" onClick={onClose} type="button"><X size={16} /></button>
  </div>;
}

function AuthScreen({ onMessage }: { onMessage: (flash: Flash) => void }) {
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState("");
  const [resendBusy, setResendBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    onMessage(null);
    try {
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (error) throw error;
        onMessage({ kind: "success", message: "Si el correo está registrado, recibirás un enlace para cambiar la contraseña." });
        return;
      }
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { display_name: name.trim() } } });
        if (error) throw error;
        if (!data.session) {
          setPendingVerificationEmail(email.trim());
          onMessage({ kind: "info", message: "Cuenta creada. Revisa tu correo para confirmar la dirección y luego inicia sesión." });
        } else {
          setPendingVerificationEmail("");
          onMessage({ kind: "success", message: "Tu cuenta está lista." });
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        onMessage({ kind: "success", message: "Sesión iniciada." });
      }
    } catch (error) {
      onMessage({ kind: "error", message: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  async function resendVerificationEmail() {
    if (!supabase || !pendingVerificationEmail || resendBusy) return;
    setResendBusy(true);
    onMessage(null);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: pendingVerificationEmail,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      onMessage({ kind: "success", message: "Enviamos otro correo de confirmación. Revisa también la carpeta de spam." });
    } catch (error) {
      onMessage({ kind: "error", message: errorText(error) });
    } finally {
      setResendBusy(false);
    }
  }

  return <main className="min-h-screen bg-[#f3f5fb] lg:grid lg:grid-cols-[1.05fr_.95fr]">
    <section className="relative hidden min-h-screen isolate overflow-hidden bg-[#101124] px-12 py-11 text-white lg:flex lg:flex-col lg:justify-between xl:px-16 xl:py-12">
      <div aria-hidden="true" className="absolute inset-0 -z-10 opacity-70" style={{ backgroundImage: "radial-gradient(circle at 18% 25%, rgba(105,81,255,.24), transparent 32%), radial-gradient(circle at 82% 74%, rgba(52,211,193,.12), transparent 30%), linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)", backgroundSize: "auto, auto, 44px 44px, 44px 44px" }} />
      <div aria-hidden="true" className="absolute -right-28 top-24 size-[28rem] rounded-full border border-indigo-300/10" /><div aria-hidden="true" className="absolute -right-12 top-40 size-80 rounded-full border border-indigo-300/10" />
      <a className="relative flex w-fit items-center gap-3" href="#inicio"><span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-400 to-indigo-600 shadow-lg shadow-indigo-950/60 ring-1 ring-white/20"><BookOpenText size={21} /></span><span><span className="block text-lg font-semibold tracking-tight">Patchwork</span><span className="block text-[11px] tracking-wide text-slate-400">MEMORIA DE PROYECTO</span></span></a>
      <div className="relative z-10 my-auto max-w-xl py-14">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.24em] text-violet-300"><span className="size-1.5 rounded-full bg-violet-300 shadow-[0_0_12px_3px_rgba(167,139,250,.55)]" />Decisiones · Código · Contexto</p>
        <h1 className="mt-6 text-[2.7rem] font-semibold leading-[1.1] tracking-[-.04em] xl:text-[3.55rem]">Que las decisiones importantes <span className="bg-gradient-to-r from-violet-300 via-indigo-200 to-cyan-200 bg-clip-text text-transparent">no se pierdan</span> entre commits.</h1>
        <p className="mt-6 max-w-lg text-[15px] leading-7 text-slate-300">Conserva problemas, razonamientos, alternativas y referencias junto al repositorio donde nacieron.</p>
        <div aria-hidden="true" className="relative mt-12 max-w-lg rounded-2xl border border-white/10 bg-white/[.045] p-5 shadow-2xl shadow-black/20 backdrop-blur-sm">
          <div className="absolute left-[15%] right-[15%] top-1/2 h-px bg-gradient-to-r from-transparent via-violet-300/40 to-transparent" />
          <div className="relative grid grid-cols-3 gap-3">
            {[[GitBranch,"Código"],[Lightbulb,"Decisión"],[Activity,"Contexto"]].map(([Icon,label],index) => { const Glyph = Icon as typeof GitBranch; return <div className="flex flex-col items-center gap-3 rounded-xl border border-white/[.08] bg-[#18192f]/90 px-2 py-4 text-center" key={String(label)}><span className={`grid size-11 place-items-center rounded-xl ${index===1 ? "bg-violet-400/15 text-violet-200 ring-1 ring-violet-300/20" : "bg-white/[.06] text-slate-200"}`}><Glyph size={20} strokeWidth={1.7} /></span><span className="text-xs font-medium text-slate-200">{String(label)}</span></div>; })}
          </div>
          <div className="mt-4 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[.18em] text-slate-500"><span className="h-px w-8 bg-slate-700" />El contexto detrás del software<span className="h-px w-8 bg-slate-700" /></div>
        </div>
        <div className="mt-8 flex items-center gap-2.5 text-xs text-slate-400"><ShieldCheck className="text-emerald-300" size={16} />Acceso protegido por espacio de trabajo</div>
      </div>
      <div className="relative flex items-center justify-between border-t border-white/10 pt-5 text-[11px] text-slate-500"><span>© Patchwork</span><span>Memoria técnica para equipos de software</span></div>
    </section>
    <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10 lg:px-12">
      <div className="w-full max-w-[440px]">
        <a className="mb-8 flex items-center gap-3 lg:hidden" href="#inicio"><span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-700 text-white shadow-md shadow-indigo-200"><BookOpenText size={20} /></span><span className="font-semibold tracking-tight">Patchwork</span></a>
        <FlashMessage flash={null} onClose={() => undefined} />
        <div className="rounded-[1.75rem] border border-white bg-white p-7 shadow-[0_28px_80px_-36px_rgba(32,42,87,.28)] ring-1 ring-slate-900/[.035] sm:p-10">
        <div className="mb-8"><p className="text-[11px] font-semibold uppercase tracking-[.2em] text-indigo-600">Tu espacio de trabajo</p><h2 className="mt-3 text-[1.9rem] font-semibold tracking-[-.035em] text-slate-950">{mode === "signin" ? "Bienvenido de nuevo" : mode === "signup" ? "Crea tu cuenta" : "Recupera tu contraseña"}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{mode === "signin" ? "Inicia sesión para continuar con tus decisiones técnicas." : mode === "signup" ? "Empieza a guardar el contexto detrás de tu código." : "Te enviaremos un enlace para cambiarla."}</p></div>
        <form className="space-y-5" onSubmit={submit}>
          {mode === "signup" && <Field label="Nombre"><input autoComplete="name" className={inputClass} maxLength={120} onChange={(event) => setName(event.target.value)} required value={name} /></Field>}
          <Field label="Correo electrónico"><input autoComplete="email" className={inputClass} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></Field>
          {mode !== "reset" && <Field hint="Mínimo 6 caracteres." label="Contraseña"><input autoComplete={mode === "signin" ? "current-password" : "new-password"} className={inputClass} minLength={6} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></Field>}
          {mode === "signin" && <div className="-mt-2 text-right"><button className="text-xs font-medium text-indigo-700 hover:underline" onClick={() => { setMode("reset"); onMessage(null); }} type="button">¿Olvidaste tu contraseña?</button></div>}
          <button className={`${buttonPrimary} w-full`} disabled={busy} type="submit">{busy ? <LoaderCircle className="animate-spin" size={17} /> : null}{mode === "signin" ? "Iniciar sesión" : mode === "signup" ? "Crear cuenta" : "Enviar enlace de recuperación"}</button>
        </form>
        {mode === "signup" && pendingVerificationEmail === email.trim() && <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4"><p className="text-sm text-indigo-950">¿No te llegó el correo de confirmación?</p><button className="mt-2 text-sm font-semibold text-indigo-700 hover:underline disabled:opacity-50" disabled={resendBusy} onClick={() => void resendVerificationEmail()} type="button">{resendBusy ? "Enviando…" : "Reenviar correo"}</button></div>}
        <p className="mt-6 text-center text-sm text-slate-600">{mode === "signup" ? "¿Ya tienes cuenta?" : mode === "reset" ? "¿Recordaste la contraseña?" : "¿Aún no tienes cuenta?"}{" "}<button className="font-semibold text-indigo-700 hover:text-indigo-900" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); onMessage(null); }} type="button">{mode === "signin" ? "Regístrate" : "Inicia sesión"}</button></p>
        <p className="mt-8 flex items-center justify-center gap-2 text-center text-[11px] leading-5 text-slate-400"><ShieldCheck className="shrink-0 text-emerald-600" size={14} />Conexión segura · Tus datos se guardan en tu espacio privado.</p>
        </div>
      </div>
    </section>
  </main>;
}

function PasswordRecoveryScreen({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) { setError("Las contraseñas no coinciden."); return; }
    if (!supabase) return;
    setBusy(true);
    setError("");
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      onComplete();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  return <main className="grid min-h-screen place-items-center bg-slate-50 p-5"><section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9"><span className="grid size-11 place-items-center rounded-xl bg-indigo-600 text-white"><ShieldCheck size={21} /></span><h1 className="mt-6 text-2xl font-semibold tracking-tight">Crea una contraseña nueva</h1><p className="mt-2 text-sm leading-6 text-slate-600">Elige una contraseña de al menos seis caracteres para tu cuenta.</p>{error && <p className="mt-5 rounded-lg bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}<form className="mt-6 space-y-4" onSubmit={submit}><Field label="Nueva contraseña"><input autoComplete="new-password" className={inputClass} minLength={6} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></Field><Field label="Repite la contraseña"><input autoComplete="new-password" className={inputClass} minLength={6} onChange={(event) => setConfirmation(event.target.value)} required type="password" value={confirmation} /></Field><button className={`${buttonPrimary} w-full`} disabled={busy} type="submit">{busy && <LoaderCircle className="animate-spin" size={16} />}Guardar contraseña</button></form></section></main>;
}

function WorkspaceForm({ onClose, onCreated }: { onClose: () => void; onCreated: (workspace: Workspace) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const userId = (await supabase?.auth.getUser())?.data.user?.id;
      if (!userId) throw new Error("Tu sesión expiró. Inicia sesión de nuevo.");
      onCreated(await createWorkspace(name, userId));
      onClose();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  return <Modal onClose={onClose} title="Crear espacio de trabajo">
    <form className="space-y-5" onSubmit={submit}>
      {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}
      <Field hint="Cada espacio mantiene sus decisiones y repositorios separados." label="Nombre del espacio"><input autoFocus className={inputClass} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Ej. Mi producto" required value={name} /></Field>
      <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end"><button className={buttonSecondary} onClick={onClose} type="button">Cancelar</button><button className={buttonPrimary} disabled={busy || !name.trim()} type="submit">{busy && <LoaderCircle className="animate-spin" size={16} />}Crear espacio</button></div>
    </form>
  </Modal>;
}

function WorkspaceSetup({ user, onCreated }: { user: User; onCreated: (workspace: Workspace) => void }) {
  const [name, setName] = useState("Mi espacio");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try { onCreated(await createWorkspace(name, user.id)); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }
  return <main className="grid min-h-screen place-items-center bg-slate-50 p-5"><section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
    <span className="grid size-11 place-items-center rounded-xl bg-indigo-600 text-white"><Layers3 size={21} /></span><p className="mt-6 text-sm font-medium text-indigo-700">Un espacio para empezar</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">Crea tu espacio de trabajo</h1><p className="mt-2 text-sm leading-6 text-slate-600">Las decisiones y repositorios se organizarán aquí. Podrás cambiarle el nombre más adelante.</p>
    {error && <p className="mt-5 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    <form className="mt-6 space-y-4" onSubmit={submit}><Field label="Nombre del espacio"><input autoFocus className={inputClass} maxLength={120} onChange={(event) => setName(event.target.value)} required value={name} /></Field><button className={`${buttonPrimary} w-full`} disabled={busy || !name.trim()} type="submit">{busy && <LoaderCircle className="animate-spin" size={16} />}Crear espacio</button></form>
  </section></main>;
}

function StatusBadge({ status }: { status: DecisionStatus }) {
  const label = status === "accepted" ? "Aceptada" : status === "draft" ? "Borrador" : "Reemplazada";
  const color = status === "accepted" ? "bg-emerald-50 text-emerald-700 ring-emerald-600/15" : status === "draft" ? "bg-amber-50 text-amber-700 ring-amber-600/15" : "bg-slate-100 text-slate-600 ring-slate-500/15";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${color}`}>{label}</span>;
}

function DecisionForm({ decision, repositories, workspaceId, userId, onClose, onSaved }: { decision?: Decision; repositories: Repository[]; workspaceId: string; userId: string; onClose: () => void; onSaved: () => void }) {
  const link = decision?.links[0];
  const [title, setTitle] = useState(decision?.title ?? "");
  const [problem, setProblem] = useState(decision?.problem ?? "");
  const [choice, setChoice] = useState(decision?.decision ?? "");
  const [rationale, setRationale] = useState(decision?.rationale ?? "");
  const [alternatives, setAlternatives] = useState(decision?.alternatives.join("\n") ?? "");
  const [consequences, setConsequences] = useState(decision?.consequences ?? "");
  const [risks, setRisks] = useState(decision?.risks ?? "");
  const [status, setStatus] = useState<DecisionStatus>(decision?.status ?? "accepted");
  const [repositoryId, setRepositoryId] = useState(decision?.repository_id ?? "");
  const [linkUrl, setLinkUrl] = useState(link?.url ?? "");
  const [linkLabel, setLinkLabel] = useState(link?.label ?? "");
  const [linkType, setLinkType] = useState<DecisionInput["link_type"]>(link?.resource_type ?? "pull_request");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await saveDecision({ workspace_id: workspaceId, repository_id: repositoryId || null, title, problem, decision: choice, rationale, alternatives: alternatives.split("\n").map((item) => item.trim()).filter(Boolean), consequences, risks, status, author_id: userId, link_url: linkUrl, link_label: linkLabel, link_type: linkType }, userId, decision?.id);
      onSaved(); onClose();
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }
  return <Modal onClose={onClose} title={decision ? "Editar decisión" : "Nueva decisión"} wide>
    <form className="space-y-5" onSubmit={submit}>
      {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-[1fr_220px]"><Field label="Título"><input autoFocus className={inputClass} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="Ej. Adoptar PostgreSQL para el módulo de reportes" required value={title} /></Field><Field label="Estado"><select className={inputClass} onChange={(event) => setStatus(event.target.value as DecisionStatus)} value={status}><option value="accepted">Aceptada</option><option value="draft">Borrador</option><option value="superseded">Reemplazada</option></select></Field></div>
      <Field label="Problema o contexto"><textarea className={`${inputClass} min-h-24 resize-y`} onChange={(event) => setProblem(event.target.value)} placeholder="¿Qué situación o necesidad originó esta decisión?" required value={problem} /></Field>
      <Field label="Decisión tomada"><textarea className={`${inputClass} min-h-24 resize-y`} onChange={(event) => setChoice(event.target.value)} placeholder="¿Qué se decidió hacer?" required value={choice} /></Field>
      <Field label="Justificación"><textarea className={`${inputClass} min-h-20 resize-y`} onChange={(event) => setRationale(event.target.value)} placeholder="¿Por qué esta opción?" value={rationale} /></Field>
      <Field hint="Una alternativa por línea." label="Alternativas consideradas"><textarea className={`${inputClass} min-h-20 resize-y`} onChange={(event) => setAlternatives(event.target.value)} placeholder={"Mantener la solución actual\nUsar otra tecnología"} value={alternatives} /></Field>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Consecuencias y compromisos"><textarea className={`${inputClass} min-h-20 resize-y`} onChange={(event) => setConsequences(event.target.value)} placeholder="Efectos esperados y compromisos asumidos" value={consequences} /></Field><Field label="Riesgos conocidos"><textarea className={`${inputClass} min-h-20 resize-y`} onChange={(event) => setRisks(event.target.value)} placeholder="Riesgos y mitigaciones" value={risks} /></Field></div>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Repositorio"><select className={inputClass} onChange={(event) => setRepositoryId(event.target.value)} value={repositoryId}><option value="">Sin repositorio asociado</option>{repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.full_name}</option>)}</select></Field><Field label="Tipo de referencia"><select className={inputClass} onChange={(event) => setLinkType(event.target.value as DecisionInput["link_type"])} value={linkType}><option value="pull_request">Pull request</option><option value="commit">Commit</option><option value="issue">Issue</option><option value="other">Otra referencia</option></select></Field></div>
      <div className="grid gap-4 sm:grid-cols-2"><Field hint="Detectamos automáticamente si es un commit, pull request o issue de GitHub." label="URL de commit, PR o issue"><input className={inputClass} onChange={(event) => { const value = event.target.value; setLinkUrl(value); const inferredType = inferGithubReferenceType(value); if (inferredType) setLinkType(inferredType); }} placeholder="https://github.com/organizacion/repositorio/pull/42" type="url" value={linkUrl} /></Field><Field label="Etiqueta de la referencia"><input className={inputClass} maxLength={200} onChange={(event) => setLinkLabel(event.target.value)} placeholder="Implementación de la decisión" value={linkLabel} /></Field></div>
      <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end"><button className={buttonSecondary} onClick={onClose} type="button">Cancelar</button><button className={buttonPrimary} disabled={busy} type="submit">{busy && <LoaderCircle className="animate-spin" size={16} />}{decision ? "Guardar cambios" : "Guardar decisión"}</button></div>
    </form>
  </Modal>;
}

function RepositoryForm({ workspaceId, onClose, onSaved }: { workspaceId: string; onClose: () => void; onSaved: () => void }) {
  const [fullName, setFullName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const clean = fullName.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/$/, "");
    const pieces = clean.split("/").filter(Boolean);
    if (pieces.length !== 2) { setError("Escribe el repositorio como organizacion/nombre."); setBusy(false); return; }
    try {
      await addRepository(workspaceId, { full_name: pieces.join("/"), name: pieces[1], url: url.trim() || `https://github.com/${pieces.join("/")}` });
      onSaved(); onClose();
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }
  return <Modal onClose={onClose} title="Añadir repositorio">
    <form className="space-y-5" onSubmit={submit}>
      {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}
      <Field hint="Escribe propietario/repositorio, por ejemplo octocat/hello-world." label="Repositorio de GitHub"><input autoFocus className={inputClass} onChange={(event) => setFullName(event.target.value)} placeholder="organizacion/proyecto" required value={fullName} /></Field>
      <Field hint="Si se deja vacío, se usará la URL pública de GitHub." label="URL"><input className={inputClass} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/organizacion/proyecto" type="url" value={url} /></Field>
      <p className="rounded-lg bg-indigo-50 p-3 text-xs leading-5 text-indigo-900">El registro manual solo guarda el nombre y el enlace. Para sincronizar repositorios y actividad, conecta la GitHub App desde la sección Repositorios.</p>
      <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end"><button className={buttonSecondary} onClick={onClose} type="button">Cancelar</button><button className={buttonPrimary} disabled={busy} type="submit">{busy && <LoaderCircle className="animate-spin" size={16} />}Añadir repositorio</button></div>
    </form>
  </Modal>;
}

function DecisionDetails({ decision, repository, events, currentUserId, onClose, onEdit, onDelete }: { decision: Decision; repository?: Repository; events: RepositoryEvent[]; currentUserId: string; onClose: () => void; onEdit: () => void; onDelete: () => Promise<boolean> }) {
  const [deleting, setDeleting] = useState(false);
  const referenceUrls = new Set(decision.links.map((link) => link.url.replace(/\/$/, "")));
  const relatedEvents = events.filter((event) => event.repository_id === decision.repository_id && event.url && referenceUrls.has(event.url.replace(/\/$/, "")));
  return <Modal onClose={onClose} title="Detalle de decisión" wide>
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2"><StatusBadge status={decision.status} /><span className="text-xs text-slate-500">Creada {prettyDate(decision.created_at)}</span>{decision.updated_at !== decision.created_at && <span className="text-xs text-slate-500">· Actualizada {prettyDate(decision.updated_at)}</span>}</div>
      <div><h3 className="text-2xl font-semibold tracking-tight text-slate-950">{decision.title}</h3>{repository && <a className="mt-2 inline-flex items-center gap-1.5 text-sm text-indigo-700 hover:text-indigo-900" href={repository.url} rel="noreferrer" target="_blank"><GitBranch size={15} />{repository.full_name}<ExternalLink size={13} /></a>}</div>
      <DetailBlock title="Problema o contexto" text={decision.problem} /><DetailBlock title="Decisión tomada" text={decision.decision} />
      {decision.rationale && <DetailBlock title="Justificación" text={decision.rationale} />}
      {decision.alternatives.length > 0 && <div><h4 className="mb-2 text-sm font-semibold text-slate-800">Alternativas consideradas</h4><ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600">{decision.alternatives.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>}
      <div className="grid gap-5 sm:grid-cols-2">{decision.consequences && <DetailBlock title="Consecuencias y compromisos" text={decision.consequences} />}{decision.risks && <DetailBlock title="Riesgos conocidos" text={decision.risks} />}</div>
      {decision.links.length > 0 && <div><h4 className="mb-2 text-sm font-semibold text-slate-800">Referencias</h4><div className="space-y-2">{decision.links.map((item) => <a className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm text-indigo-700 hover:bg-slate-50" href={item.url} key={item.id} rel="noreferrer" target="_blank"><Link2 size={16} /><span className="min-w-0 flex-1 truncate">{item.label || item.url}</span><ExternalLink size={14} /></a>)}</div></div>}
      {relatedEvents.length > 0 && <div><h4 className="mb-2 text-sm font-semibold text-slate-800">Eventos relacionados</h4><div className="space-y-2">{relatedEvents.map((event) => <a className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm hover:bg-slate-50" href={event.url ?? undefined} key={event.id} rel="noreferrer" target="_blank"><Activity className="shrink-0 text-indigo-600" size={16} /><span className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-900">{event.title}</span><span className="text-xs text-slate-500">{event.event_type.replace("_", " ")} · {prettyDate(event.occurred_at)}</span></span><ExternalLink className="shrink-0 text-slate-400" size={14} /></a>)}</div></div>}
      <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-between">{decision.author_id === currentUserId ? <button className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50" disabled={deleting} onClick={async () => { if (!window.confirm("¿Eliminar esta decisión y sus referencias? Esta acción no se puede deshacer.")) return; setDeleting(true); const removed = await onDelete(); if (!removed) setDeleting(false); }} type="button"><Trash2 size={16} />Eliminar</button> : <span /> }<div className="flex flex-col-reverse gap-3 sm:flex-row"><button className={buttonSecondary} onClick={onClose} type="button">Cerrar</button>{decision.author_id === currentUserId && <button className={buttonPrimary} onClick={onEdit} type="button">Editar decisión</button>}</div></div>
    </div>
  </Modal>;
}

function DetailBlock({ title, text }: { title: string; text: string }) {
  return <div><h4 className="mb-2 text-sm font-semibold text-slate-800">{title}</h4><p className="whitespace-pre-wrap text-sm leading-6 text-slate-600">{text}</p></div>;
}

function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="relative grid min-h-72 place-items-center overflow-hidden rounded-3xl border border-slate-200 bg-white px-6 py-12 text-center shadow-[0_16px_45px_-36px_rgba(37,49,93,.35)]"><div aria-hidden="true" className="absolute -right-12 -top-16 size-52 rounded-full bg-violet-100/60 blur-3xl" /><div className="relative max-w-sm"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-100 to-indigo-50 text-indigo-700 ring-1 ring-indigo-100"><FileText size={23} /></span><h3 className="mt-5 text-base font-semibold tracking-tight text-slate-900">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{text}</p>{action && <div className="mt-6">{action}</div>}</div></div>;
}

function GlobalSearchBox({ value, results, onChange, onSelect, mobile = false }: { value: string; results: GlobalSearchResult[]; onChange: (value: string) => void; onSelect: (result: GlobalSearchResult) => void; mobile?: boolean }) {
  const [open, setOpen] = useState(false);
  return <div className={`relative ${mobile ? "w-full" : "hidden w-48 sm:block lg:w-64"}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <Search className="absolute left-3 top-2.5 z-10 text-slate-400" size={16} />
    <input aria-label="Buscar decisiones, repositorios y actividad" aria-expanded={open && value.trim().length >= 2} aria-haspopup="listbox" autoComplete="off" className={`w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100 ${mobile ? "" : "lg:w-64"}`} onChange={(event) => onChange(event.target.value)} onFocus={() => setOpen(true)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} placeholder="Buscar en Patchwork..." value={value} />
    {open && value.trim().length >= 2 && <div className="absolute left-0 right-0 top-full z-40 mt-2 max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10" role="listbox">
      {results.length ? results.map((result) => {
        const Icon = result.kind === "decision" ? Lightbulb : result.kind === "repository" ? GitBranch : Activity;
        const typeLabel = result.kind === "decision" ? "Decisión" : result.kind === "repository" ? "Repositorio" : "Actividad";
        return <button aria-label={`${typeLabel}: ${result.title}`} className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-indigo-50 focus:bg-indigo-50 focus:outline-none" key={result.key} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(result)} role="option" type="button"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-700"><Icon size={16} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-900">{result.title}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{result.detail}</span></span><span className="shrink-0 pt-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">{typeLabel}</span></button>;
      }) : <p className="px-3 py-4 text-center text-sm text-slate-500">No hay coincidencias con “{value.trim()}”.</p>}
      <div className="border-t border-slate-100 px-3 py-2 text-[10px] text-slate-400">Decisiones · repositorios · actividad de GitHub</div>
    </div>}
  </div>;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [installations, setInstallations] = useState<GithubInstallation[]>([]);
  const [repositoryEvents, setRepositoryEvents] = useState<RepositoryEvent[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [decisions, setDecisions] = useState<Decision[]>([]);
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
  const [dataLoading, setDataLoading] = useState(false);
  const [decisionModal, setDecisionModal] = useState<Decision | null | "new">(null);
  const [repositoryModal, setRepositoryModal] = useState(false);
  const [workspaceModal, setWorkspaceModal] = useState(false);
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null);
  const [githubConnecting, setGithubConnecting] = useState(false);
  const refreshInFlight = useRef(false);

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
      setWorkspaces([]); setWorkspace(null); setRepositories([]); setInstallations([]); setRepositoryEvents([]); setMemberCount(0); setDecisions([]); setWorkspaceLoading(false);
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

  const refreshData = useCallback(async (silent = false) => {
    if (!workspace || refreshInFlight.current) { if (!workspace) { setRepositories([]); setDecisions([]); } return; }
    refreshInFlight.current = true;
    if (!silent) setDataLoading(true);
    try {
      const [repoRows, decisionRows, installationRows, eventRows, members] = await Promise.all([listRepositories(workspace.id), listDecisions(workspace.id), listGithubInstallations(workspace.id), listRepositoryEvents(workspace.id), countWorkspaceMembers(workspace.id)]);
      setRepositories(repoRows); setDecisions(decisionRows); setInstallations(installationRows); setRepositoryEvents(eventRows); setMemberCount(members);
    } catch (error) { if (!silent) setFlash({ kind: "error", message: errorText(error) }); }
    finally { refreshInFlight.current = false; if (!silent) setDataLoading(false); }
  }, [workspace?.id]);

  useEffect(() => { void refreshData(); }, [refreshData]);

  useEffect(() => {
    if (!workspace) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshData(true);
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshData, workspace?.id]);

  useEffect(() => {
    if (!session?.user || !workspace) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshData(true);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [refreshData, session?.user.id, workspace?.id]);

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

          {view === "overview" && <>
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-indigo-700">El contexto detrás del código</p><h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Hola, {String(userLabel).split(" ")[0]}</h2><p className="mt-2 text-sm text-slate-600">Este es el historial técnico de {workspace.name}.</p></div><button className={buttonSecondary} onClick={() => setView("decisions")} type="button">Ver decisiones<ChevronDown className="-rotate-90" size={16} /></button></div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><SummaryCard icon={<Lightbulb size={18} />} label="Decisiones" value={String(decisions.length)} /><SummaryCard icon={<Activity size={18} />} label="Eventos de GitHub" value={String(repositoryEvents.length)} /><SummaryCard icon={<GitBranch size={18} />} label="Repositorios" value={String(repositories.length)} /><SummaryCard icon={<Layers3 size={18} />} label="Miembros del espacio" value={String(memberCount)} /></div>
            <div className="mt-8 grid gap-6 xl:grid-cols-[1.5fr_1fr]"><section><div className="mb-4 flex items-center justify-between"><div><h3 className="font-semibold">Actividad reciente</h3><p className="mt-1 text-xs text-slate-500">Decisiones y cambios del repositorio en orden cronológico.</p></div><button className="text-sm font-medium text-indigo-700 hover:text-indigo-900" onClick={() => setView("timeline")} type="button">Ver toda la actividad</button></div>{recentEntries.length ? <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">{recentEntries.map((entry, index) => entry.kind === "decision" ? <DecisionRow decision={entry.decision} key={`decision-${entry.id}`} last={index === recentEntries.length - 1} onClick={() => setSelectedDecision(entry.decision)} repository={repositories.find((row) => row.id === entry.decision.repository_id)} /> : <a className={`block px-5 py-4 transition hover:bg-slate-50 sm:px-6 ${index < recentEntries.length - 1 ? "border-b border-slate-100" : ""}`} href={entry.event.url ?? undefined} key={`event-${entry.id}`} rel="noreferrer" target="_blank"><span className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-700"><Activity size={17} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{entry.event.title}</span><span className="mt-1 block text-xs text-slate-500">{repositories.find((repo) => repo.id === entry.event.repository_id)?.full_name ?? "Repositorio"} · {prettyDate(entry.event.occurred_at)}</span></span><ExternalLink className="text-slate-400" size={14} /></span></a>)}</div> : <EmptyState action={<button className={buttonPrimary} onClick={openNewDecision} type="button"><Plus size={16} />Registrar primera decisión</button>} text="Las decisiones y eventos vinculados aparecerán aquí." title="Todavía no hay actividad" />}</section>
            <section><div className="mb-4"><h3 className="font-semibold">Repositorios</h3><p className="mt-1 text-xs text-slate-500">Proyectos relacionados con el espacio.</p></div><div className="rounded-2xl border border-slate-200 bg-white p-5">{repositories.length ? <div className="space-y-4">{repositories.slice(0, 4).map((repo) => <a className="flex items-center gap-3 rounded-lg p-2 transition hover:bg-slate-50" href={repo.url} key={repo.id} rel="noreferrer" target="_blank"><span className="grid size-9 place-items-center rounded-lg bg-slate-100 text-slate-600"><GitBranch size={18} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{repo.full_name}</span><span className="text-xs text-slate-500">{decisions.filter((item) => item.repository_id === repo.id).length} decisiones</span></span><ExternalLink className="text-slate-400" size={14} /></a>)}<button className="mt-1 w-full rounded-lg border border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50" onClick={() => setView("repositories")} type="button">Administrar repositorios</button></div> : <div className="py-5 text-center"><span className="mx-auto grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-500"><GitBranch size={18} /></span><p className="mt-3 text-sm font-medium">Sin repositorios todavía</p><p className="mt-1 text-xs text-slate-500">Puedes asociar decisiones a GitHub cuando añadas uno.</p><button className="mt-4 text-sm font-semibold text-indigo-700" onClick={() => setRepositoryModal(true)} type="button">Añadir repositorio</button></div>}</div></section>
            </div>
          </>}

          {view === "decisions" && <>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-slate-500">{filteredDecisions.length} de {decisions.length} decisiones</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Historial técnico</h2></div><div className="flex flex-wrap items-center gap-2"><label className="sr-only" htmlFor="decision-repository-filter">Filtrar por repositorio</label><select className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm outline-none focus:border-indigo-500" id="decision-repository-filter" onChange={(event) => setDecisionRepositoryFilter(event.target.value)} value={decisionRepositoryFilter}><option value="all">Todos los repositorios</option><option value="none">Sin repositorio</option>{repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.full_name}</option>)}</select><label className="sr-only" htmlFor="status-filter">Filtrar por estado</label><select className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm outline-none focus:border-indigo-500" id="status-filter" onChange={(event) => setStatusFilter(event.target.value as "all" | DecisionStatus)} value={statusFilter}><option value="all">Todos los estados</option><option value="accepted">Aceptadas</option><option value="draft">Borradores</option><option value="superseded">Reemplazadas</option></select></div></div>
            {filteredDecisions.length ? <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">{filteredDecisions.map((item, index) => <DecisionRow decision={item} key={item.id} last={index === filteredDecisions.length - 1} onClick={() => setSelectedDecision(item)} repository={repositories.find((row) => row.id === item.repository_id)} />)}</div> : <EmptyState action={<button className={buttonPrimary} onClick={openNewDecision} type="button"><Plus size={16} />Crear decisión</button>} text={query || statusFilter !== "all" ? "Prueba otra búsqueda o cambia el filtro de estado." : "Empieza con el problema, la opción elegida y el motivo detrás de ella."} title={query || statusFilter !== "all" ? "No encontramos coincidencias" : "Tu historial empieza aquí"} />}
          </>}

          {view === "timeline" && <>
            <div className="mb-5"><p className="text-sm text-slate-500">{timelineEntries.length} elementos en este filtro</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Historial de actividad</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Eventos recibidos de GitHub y decisiones técnicas del espacio, en una sola cronología.</p></div>
            <div className="mb-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-4"><label className="relative"><span className="sr-only">Buscar en actividad</span><Search className="absolute left-3 top-2.5 text-slate-400" size={16} /><input className={`${inputClass} pl-9`} onChange={(event) => setActivityQuery(event.target.value)} placeholder="Buscar eventos y decisiones..." value={activityQuery} /></label><label><span className="sr-only">Filtrar por repositorio</span><select aria-label="Filtrar actividad por repositorio" className={inputClass} onChange={(event) => setActivityRepositoryFilter(event.target.value)} value={activityRepositoryFilter}><option value="all">Todos los repositorios</option><option value="none">Sin repositorio</option>{repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.full_name}</option>)}</select></label><label><span className="sr-only">Filtrar por tipo</span><select aria-label="Filtrar actividad por tipo" className={inputClass} onChange={(event) => setActivityTypeFilter(event.target.value)} value={activityTypeFilter}><option value="all">Todos los tipos</option><option value="decision">Decisiones técnicas</option><option value="push">Commits</option><option value="pull_request">Pull requests</option><option value="issues">Issues</option></select></label><label><span className="sr-only">Filtrar por fecha</span><select aria-label="Filtrar actividad por periodo" className={inputClass} onChange={(event) => setActivityRange(event.target.value)} value={activityRange}><option value="all">Todo el historial</option><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option></select></label></div>
            {timelineEntries.length ? <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">{timelineEntries.map((entry, index) => {
              if (entry.kind === "decision") return <DecisionRow decision={entry.decision} key={`decision-${entry.id}`} last={index === timelineEntries.length - 1} onClick={() => setSelectedDecision(entry.decision)} repository={repositories.find((row) => row.id === entry.decision.repository_id)} />;
              const event = entry.event;
              const repo = repositories.find((row) => row.id === event.repository_id);
              const Icon = event.event_type === "issues" ? CircleDot : GitBranch;
              const content = <div className="flex items-start gap-3"><span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-700"><Icon size={17} /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="font-medium text-slate-900">{event.title}</span><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium capitalize text-emerald-700">{event.event_type.replace("_", " ")}{event.action ? ` · ${event.action}` : ""}</span></span>{event.summary && <span className="mt-1 block text-sm leading-5 text-slate-600">{event.summary}</span>}<span className="mt-2 flex flex-wrap gap-x-3 text-xs text-slate-500"><span>{repo?.full_name ?? "Repositorio"}</span>{event.actor_login && <span>por {event.actor_login}</span>}<span>{prettyDate(event.occurred_at)}</span></span></span><ExternalLink className="shrink-0 text-slate-400" size={14} /></div>;
              const rowClass = `block border-b border-slate-100 px-5 py-4 transition hover:bg-slate-50 sm:px-6 ${index === timelineEntries.length - 1 ? "border-b-0" : ""}`;
              return event.url ? <a className={rowClass} href={event.url} key={`event-${entry.id}`} rel="noreferrer" target="_blank">{content}</a> : <div className={rowClass} key={`event-${entry.id}`}>{content}</div>;
            })}</div> : <EmptyState text={repositoryEvents.length || decisions.length ? "Prueba quitando algún filtro o cambiando el texto de búsqueda." : "Cuando registres decisiones o recibas actividad de GitHub, aparecerá aquí."} title={repositoryEvents.length || decisions.length ? "No hay resultados" : "Todavía no hay actividad"} />}
          </>}

          {view === "workspaces" && <>
            <div className="mb-6"><p className="text-sm text-slate-500">{workspaces.length} espacios disponibles</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Espacios de trabajo</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Separa el contexto técnico de cada proyecto y cambia de espacio cuando lo necesites.</p></div>
            <div className="grid gap-4 lg:grid-cols-2">{workspaces.map((item) => <button className={`rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:border-indigo-300 hover:shadow ${item.id === workspace.id ? "border-indigo-300 ring-2 ring-indigo-100" : "border-slate-200"}`} key={item.id} onClick={() => { setWorkspace(item); setView("overview"); }} type="button"><span className="flex items-start gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><Layers3 size={20} /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-900">{item.name}</span>{item.id === workspace.id && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">Activo</span>}</span><span className="mt-1 block truncate text-xs text-slate-500">{item.created_by === session.user.id ? "Creado por ti" : "Espacio compartido"} · {item.slug}</span></span></span></button>)}</div>
            <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm leading-6 text-slate-600">La gestión de miembros e invitaciones todavía no está disponible. Los datos siguen protegidos por las políticas RLS del espacio.</div>
          </>}

          {view === "settings" && <>
            <div className="mb-6"><p className="text-sm text-slate-500">Tu cuenta y el espacio seleccionado</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Configuración</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Consulta el estado de tu cuenta y las integraciones disponibles para este espacio.</p></div>
            <div className="grid gap-4 xl:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-semibold">Cuenta</h3><dl className="mt-4 space-y-3 text-sm"><div><dt className="text-xs text-slate-500">Nombre</dt><dd className="mt-1 font-medium">{String(userLabel)}</dd></div><div><dt className="text-xs text-slate-500">Correo electrónico</dt><dd className="mt-1 font-medium">{session.user.email ?? "No disponible"}</dd></div><div><dt className="text-xs text-slate-500">Autenticación</dt><dd className="mt-1">Supabase Auth</dd></div></dl><button className="mt-5 rounded-lg px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50" onClick={() => void signOut()} type="button"><LogOut className="mr-2 inline" size={15} />Cerrar sesión</button></section>
              <section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-semibold">Espacio actual</h3><dl className="mt-4 space-y-3 text-sm"><div><dt className="text-xs text-slate-500">Nombre</dt><dd className="mt-1 font-medium">{workspace.name}</dd></div><div><dt className="text-xs text-slate-500">Identificador</dt><dd className="mt-1 break-all font-mono text-xs">{workspace.slug}</dd></div><div><dt className="text-xs text-slate-500">Tu acceso</dt><dd className="mt-1">{workspace.created_by === session.user.id ? "Propietario" : "Miembro"} · {memberCount} {memberCount === 1 ? "miembro" : "miembros"}</dd></div></dl><button className="mt-5 text-sm font-medium text-indigo-700 hover:underline" onClick={() => setView("workspaces")} type="button">Administrar espacios</button></section>
              <section className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-2"><div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="font-semibold">Integración con GitHub</h3><p className="mt-1 text-sm text-slate-600">{installations.filter((item) => item.is_active).length ? `${installations.filter((item) => item.is_active).length} instalación(es) activa(s) en este espacio.` : "No hay una instalación activa de GitHub en este espacio."}</p><p className="mt-1 text-xs text-slate-500">La conexión sincroniza únicamente los repositorios autorizados durante la instalación.</p></div><button className={buttonSecondary} onClick={() => setView("repositories")} type="button">Ver repositorios e integración<ChevronDown className="-rotate-90" size={15} /></button></div></section>
            </div>
          </>}

          {view === "repositories" && <><div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-slate-500">{filteredRepositories.length} de {repositories.length} repositorios · {repositories.filter((repo) => repo.provider_repository_id && repo.is_connected).length} sincronizados</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Repositorios</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Conecta GitHub para sincronizar repositorios y recibir su actividad. También puedes añadir repositorios manualmente.</p></div></div>
            {installations.filter((item) => item.is_active).length > 0 && <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-sm font-semibold text-emerald-900">GitHub conectado</p><div className="mt-2 flex flex-wrap gap-2">{installations.filter((item) => item.is_active).map((item) => <span className="rounded-full bg-white px-3 py-1 text-xs text-emerald-800" key={item.id}>{item.account_login} · {item.account_type}</span>)}</div></div>}
            <div className="mb-5 flex flex-wrap items-center gap-3"><label className="relative min-w-56 flex-1"><span className="sr-only">Buscar repositorios</span><Search className="absolute left-3 top-2.5 text-slate-400" size={16} /><input className={`${inputClass} pl-9`} onChange={(event) => setRepositoryQuery(event.target.value)} placeholder="Buscar repositorios..." value={repositoryQuery} /></label><label><span className="sr-only">Filtrar estado de sincronización</span><select aria-label="Filtrar repositorios por sincronización" className={inputClass} onChange={(event) => setRepositoryStatusFilter(event.target.value as typeof repositoryStatusFilter)} value={repositoryStatusFilter}><option value="all">Todos los estados</option><option value="connected">Sincronizados</option><option value="manual">Añadidos manualmente</option><option value="disconnected">Desconectados</option></select></label><a className={buttonSecondary} download href="/patchwork-pull-request-template.md"><FileText size={16} />Descargar plantilla de PR</a><button className={buttonSecondary} onClick={() => setView("timeline")} type="button"><Activity size={16} />Ver actividad</button></div>
            {filteredRepositories.length ? <div className="grid gap-4 lg:grid-cols-2">{filteredRepositories.map((repo) => { const synced = Boolean(repo.provider_repository_id && repo.is_connected); const disconnected = Boolean(repo.provider_repository_id && !repo.is_connected); return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" key={repo.id}><div className="flex items-start gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700"><GitBranch size={21} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-semibold">{repo.full_name}</h3><span className={`rounded-full px-2 py-1 text-[11px] font-medium ${synced ? "bg-emerald-50 text-emerald-700" : disconnected ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>{synced ? "Sincronizado" : disconnected ? "Desconectado" : "Manual"}</span></div><a className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-indigo-700 hover:underline" href={repo.url} rel="noreferrer" target="_blank">{repo.url}<ExternalLink size={12} /></a><p className="mt-3 text-xs text-slate-500">{decisions.filter((item) => item.repository_id === repo.id).length} decisiones · {repositoryEvents.filter((event) => event.repository_id === repo.id).length} eventos · añadido {prettyDate(repo.created_at)}</p></div><button aria-label={`Eliminar ${repo.full_name}`} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-700" onClick={() => void handleDeleteRepository(repo)} title="Eliminar repositorio" type="button"><Trash2 size={16} /></button></div></article>; })}</div> : repositories.length ? <EmptyState text="Prueba con otro nombre o estado de sincronización." title="No hay repositorios que coincidan" /> : <EmptyState action={<button className={buttonPrimary} onClick={() => setRepositoryModal(true)} type="button"><Plus size={16} />Añadir repositorio</button>} text="Añade un repositorio para asociarlo a las decisiones que tomes sobre ese código." title="No hay repositorios" />}</>}
        </section>
      </main>
    </div>

    {decisionModal !== null && <DecisionForm decision={decisionModal === "new" ? undefined : decisionModal} onClose={() => setDecisionModal(null)} onSaved={() => { void refreshData(); setFlash({ kind: "success", message: decisionModal === "new" ? "Decisión guardada." : "Cambios guardados." }); }} repositories={repositories} userId={session.user.id} workspaceId={workspace.id} />}
    {repositoryModal && <RepositoryForm onClose={() => setRepositoryModal(false)} onSaved={() => { void refreshData(); setFlash({ kind: "success", message: "Repositorio añadido." }); }} workspaceId={workspace.id} />}
    {workspaceModal && <WorkspaceForm onClose={() => setWorkspaceModal(false)} onCreated={(created) => { setWorkspaces((current) => [...current, created]); setWorkspace(created); setView("overview"); setFlash({ kind: "success", message: "Espacio de trabajo creado." }); }} />}
    {selectedDecision && <DecisionDetails currentUserId={session.user.id} decision={selectedDecision} events={repositoryEvents} onClose={() => setSelectedDecision(null)} onDelete={() => handleDeleteDecision(selectedDecision.id)} onEdit={() => { setDecisionModal(selectedDecision); setSelectedDecision(null); }} repository={repositories.find((row) => row.id === selectedDecision.repository_id)} />}
  </div>;
}

function SummaryCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  const palette = label === "Eventos de GitHub" ? "from-cyan-500 to-teal-500" : label === "Repositorios" ? "from-indigo-500 to-blue-500" : label === "Miembros del espacio" ? "from-amber-500 to-orange-500" : "from-violet-500 to-fuchsia-500";
  return <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_12px_32px_-26px_rgba(15,23,42,.4)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-26px_rgba(79,70,229,.26)]"><div aria-hidden="true" className={`absolute -right-8 -top-10 size-28 rounded-full bg-gradient-to-br ${palette} opacity-[.07] blur-2xl transition group-hover:opacity-[.13]`} /><div className="relative flex items-center justify-between"><span className={`grid size-11 place-items-center rounded-xl bg-gradient-to-br ${palette} text-white shadow-md shadow-indigo-100`}>{icon}</span><span className="text-[2rem] font-semibold leading-none tracking-[-.04em] text-slate-900">{value}</span></div><p className="relative mt-4 text-[13px] font-medium text-slate-500">{label}</p></div>;
}

function DecisionRow({ decision, repository, onClick, last }: { decision: Decision; repository?: Repository; onClick: () => void; last: boolean }) {
  return <button className={`block w-full px-5 py-4 text-left transition hover:bg-slate-50 sm:px-6 ${last ? "" : "border-b border-slate-100"}`} onClick={onClick} type="button"><div className="flex items-start gap-3"><span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-700"><Lightbulb size={17} /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="font-medium text-slate-900">{decision.title}</span><StatusBadge status={decision.status} /></span><span className="mt-1 block line-clamp-2 text-sm leading-5 text-slate-600">{decision.problem}</span><span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500"><span className="inline-flex items-center gap-1"><Clock3 size={13} />{prettyDate(decision.created_at)}</span>{repository && <span className="inline-flex items-center gap-1"><GitBranch size={13} />{repository.full_name}</span>}{decision.links.length > 0 && <span className="inline-flex items-center gap-1"><Link2 size={13} />{decision.links.length} referencia{decision.links.length === 1 ? "" : "s"}</span>}</span></span><ChevronDown className="mt-1 -rotate-90 shrink-0 text-slate-400" size={16} /></div></button>;
}

export default App;
