import { ChevronDown, LogOut } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import type { GithubInstallation, Workspace } from "../types";
import { buttonSecondary } from "../components/AppComponents";
import type { View } from "../types/navigation";

type Props = {
  userLabel: string;
  session: Session;
  workspace: Workspace;
  memberCount: number;
  installations: GithubInstallation[];
  onSignOut: () => void;
  onSetView: (view: View) => void;
};

export function SettingsPage({ userLabel, session, workspace, memberCount, installations, onSignOut, onSetView }: Props) {
  const activeInstallations = installations.filter((item) => item.is_active);
  return <>
    <div className="mb-6"><p className="text-sm text-slate-500">Tu cuenta y el espacio seleccionado</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Configuración</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Consulta el estado de tu cuenta y las integraciones disponibles para este espacio.</p></div>
    <div className="grid gap-4 xl:grid-cols-2"><section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-semibold">Cuenta</h3><dl className="mt-4 space-y-3 text-sm"><div><dt className="text-xs text-slate-500">Nombre</dt><dd className="mt-1 font-medium">{userLabel}</dd></div><div><dt className="text-xs text-slate-500">Correo electrónico</dt><dd className="mt-1 font-medium">{session.user.email ?? "No disponible"}</dd></div><div><dt className="text-xs text-slate-500">Autenticación</dt><dd className="mt-1">Supabase Auth</dd></div></dl><button className="mt-5 rounded-lg px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50" onClick={onSignOut} type="button"><LogOut className="mr-2 inline" size={15} />Cerrar sesión</button></section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-semibold">Espacio actual</h3><dl className="mt-4 space-y-3 text-sm"><div><dt className="text-xs text-slate-500">Nombre</dt><dd className="mt-1 font-medium">{workspace.name}</dd></div><div><dt className="text-xs text-slate-500">Identificador</dt><dd className="mt-1 break-all font-mono text-xs">{workspace.slug}</dd></div><div><dt className="text-xs text-slate-500">Tu acceso</dt><dd className="mt-1">{workspace.created_by === session.user.id ? "Propietario" : "Miembro"} · {memberCount} {memberCount === 1 ? "miembro" : "miembros"}</dd></div></dl><button className="mt-5 text-sm font-medium text-indigo-700 hover:underline" onClick={() => onSetView("workspaces")} type="button">Administrar espacios</button></section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-2"><div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="font-semibold">Integración con GitHub</h3><p className="mt-1 text-sm text-slate-600">{activeInstallations.length ? `${activeInstallations.length} instalación(es) activa(s) en este espacio.` : "No hay una instalación activa de GitHub en este espacio."}</p><p className="mt-1 text-xs text-slate-500">La conexión sincroniza únicamente los repositorios autorizados durante la instalación.</p></div><button className={buttonSecondary} onClick={() => onSetView("repositories")} type="button">Ver repositorios e integración<ChevronDown className="-rotate-90" size={15} /></button></div></section>
    </div>
  </>;
}
