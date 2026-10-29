import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity, AlertCircle, BookOpenText, Check, ChevronDown, Clock3,
  ExternalLink, FileText, GitBranch, Layers3, Lightbulb, Link2,
  LoaderCircle, Search, ShieldCheck, Trash2, X,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { addRepository, createWorkspace, saveDecision } from "../services/data";
import { supabase } from "../lib/supabase";
import type { Decision, DecisionInput, DecisionStatus, Repository, RepositoryEvent, Workspace } from "../types";

export type Flash = { kind: "success" | "error" | "info"; message: string } | null;
export type GlobalSearchResult =
  | { kind: "decision"; key: string; title: string; detail: string; decision: Decision }
  | { kind: "repository"; key: string; title: string; detail: string; repository: Repository }
  | { kind: "event"; key: string; title: string; detail: string; event: RepositoryEvent };

export function prettyDate(value: string) {
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium" }).format(new Date(value));
}

export function errorText(error: unknown) {
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

export function inferGithubReferenceType(value: string): DecisionInput["link_type"] | null {
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

export function Spinner({ label = "Cargando" }: { label?: string }) {
  return <span className="inline-flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={16} aria-hidden="true" />{label}</span>;
}

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
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

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block space-y-1.5"><span className="block text-sm font-medium text-slate-700">{label}</span>{children}{hint && <span className="block text-xs leading-5 text-slate-500">{hint}</span>}</label>;
}

export const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100";
export const buttonPrimary = "inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-55";
export const buttonSecondary = "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55";

export function FlashMessage({ flash, onClose }: { flash: Flash; onClose: () => void }) {
  if (!flash) return null;
  const success = flash.kind === "success";
  return <div className={`mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${success ? "border-emerald-200 bg-emerald-50 text-emerald-900" : flash.kind === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-indigo-200 bg-indigo-50 text-indigo-900"}`} role="status">
    {success ? <Check className="mt-0.5 shrink-0" size={16} /> : <AlertCircle className="mt-0.5 shrink-0" size={16} />}
    <span className="min-w-0 flex-1">{flash.message}</span>
    <button aria-label="Cerrar aviso" className="shrink-0 opacity-70 hover:opacity-100" onClick={onClose} type="button"><X size={16} /></button>
  </div>;
}

export function AuthScreen({ onMessage }: { onMessage: (flash: Flash) => void }) {
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

export function PasswordRecoveryScreen({ onComplete }: { onComplete: () => void }) {
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

export function WorkspaceForm({ onClose, onCreated }: { onClose: () => void; onCreated: (workspace: Workspace) => void }) {
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

export function WorkspaceSetup({ user, onCreated }: { user: User; onCreated: (workspace: Workspace) => void }) {
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

export function StatusBadge({ status }: { status: DecisionStatus }) {
  const label = status === "accepted" ? "Aceptada" : status === "draft" ? "Borrador" : "Reemplazada";
  const color = status === "accepted" ? "bg-emerald-50 text-emerald-700 ring-emerald-600/15" : status === "draft" ? "bg-amber-50 text-amber-700 ring-amber-600/15" : "bg-slate-100 text-slate-600 ring-slate-500/15";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${color}`}>{label}</span>;
}

export function DecisionForm({ decision, initialEvent, repositories, workspaceId, userId, onClose, onSaved }: { decision?: Decision; initialEvent?: RepositoryEvent; repositories: Repository[]; workspaceId: string; userId: string; onClose: () => void; onSaved: () => void }) {
  const link = decision?.links[0];
  const [title, setTitle] = useState(decision?.title ?? "");
  const [problem, setProblem] = useState(decision?.problem ?? "");
  const [choice, setChoice] = useState(decision?.decision ?? "");
  const [rationale, setRationale] = useState(decision?.rationale ?? "");
  const [alternatives, setAlternatives] = useState(decision?.alternatives.join("\n") ?? "");
  const [consequences, setConsequences] = useState(decision?.consequences ?? "");
  const [risks, setRisks] = useState(decision?.risks ?? "");
  const [status, setStatus] = useState<DecisionStatus>(decision?.status ?? "accepted");
  const [repositoryId, setRepositoryId] = useState(decision?.repository_id ?? initialEvent?.repository_id ?? "");
  const [linkUrl, setLinkUrl] = useState(link?.url ?? initialEvent?.url ?? "");
  const [linkLabel, setLinkLabel] = useState(link?.label ?? initialEvent?.title ?? "");
  const [linkType, setLinkType] = useState<DecisionInput["link_type"]>(link?.resource_type ?? (initialEvent?.url ? inferGithubReferenceType(initialEvent.url) : null) ?? (initialEvent?.event_type === "push" ? "commit" : initialEvent?.event_type === "issues" ? "issue" : "pull_request"));
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

export function RepositoryForm({ workspaceId, onClose, onSaved }: { workspaceId: string; onClose: () => void; onSaved: () => void }) {
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

export function DecisionDetails({ decision, repository, events, currentUserId, onClose, onEdit, onDelete }: { decision: Decision; repository?: Repository; events: RepositoryEvent[]; currentUserId: string; onClose: () => void; onEdit: () => void; onDelete: () => Promise<boolean> }) {
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

export function DetailBlock({ title, text }: { title: string; text: string }) {
  return <div><h4 className="mb-2 text-sm font-semibold text-slate-800">{title}</h4><p className="whitespace-pre-wrap text-sm leading-6 text-slate-600">{text}</p></div>;
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="relative grid min-h-72 place-items-center overflow-hidden rounded-3xl border border-slate-200 bg-white px-6 py-12 text-center shadow-[0_16px_45px_-36px_rgba(37,49,93,.35)]"><div aria-hidden="true" className="absolute -right-12 -top-16 size-52 rounded-full bg-violet-100/60 blur-3xl" /><div className="relative max-w-sm"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-100 to-indigo-50 text-indigo-700 ring-1 ring-indigo-100"><FileText size={23} /></span><h3 className="mt-5 text-base font-semibold tracking-tight text-slate-900">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{text}</p>{action && <div className="mt-6">{action}</div>}</div></div>;
}

export function GlobalSearchBox({ value, results, onChange, onSelect, mobile = false }: { value: string; results: GlobalSearchResult[]; onChange: (value: string) => void; onSelect: (result: GlobalSearchResult) => void; mobile?: boolean }) {
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

export function SummaryCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  const palette = label === "Eventos de GitHub" ? "from-cyan-500 to-teal-500" : label === "Repositorios" ? "from-indigo-500 to-blue-500" : label === "Miembros del espacio" ? "from-amber-500 to-orange-500" : "from-violet-500 to-fuchsia-500";
  return <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_12px_32px_-26px_rgba(15,23,42,.4)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-26px_rgba(79,70,229,.26)]"><div aria-hidden="true" className={`absolute -right-8 -top-10 size-28 rounded-full bg-gradient-to-br ${palette} opacity-[.07] blur-2xl transition group-hover:opacity-[.13]`} /><div className="relative flex items-center justify-between"><span className={`grid size-11 place-items-center rounded-xl bg-gradient-to-br ${palette} text-white shadow-md shadow-indigo-100`}>{icon}</span><span className="text-[2rem] font-semibold leading-none tracking-[-.04em] text-slate-900">{value}</span></div><p className="relative mt-4 text-[13px] font-medium text-slate-500">{label}</p></div>;
}

export function DecisionRow({ decision, repository, onClick, last }: { decision: Decision; repository?: Repository; onClick: () => void; last: boolean }) {
  return <button className={`block w-full px-5 py-4 text-left transition hover:bg-slate-50 sm:px-6 ${last ? "" : "border-b border-slate-100"}`} onClick={onClick} type="button"><div className="flex items-start gap-3"><span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-700"><Lightbulb size={17} /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="font-medium text-slate-900">{decision.title}</span><StatusBadge status={decision.status} /></span><span className="mt-1 block line-clamp-2 text-sm leading-5 text-slate-600">{decision.problem}</span><span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500"><span className="inline-flex items-center gap-1"><Clock3 size={13} />{prettyDate(decision.created_at)}</span>{repository && <span className="inline-flex items-center gap-1"><GitBranch size={13} />{repository.full_name}</span>}{decision.links.length > 0 && <span className="inline-flex items-center gap-1"><Link2 size={13} />{decision.links.length} referencia{decision.links.length === 1 ? "" : "s"}</span>}</span></span><ChevronDown className="mt-1 -rotate-90 shrink-0 text-slate-400" size={16} /></div></button>;
}


