import { Layers3 } from "lucide-react";
import type { Workspace } from "../types";

type Props = {
  workspaces: Workspace[];
  activeWorkspace: Workspace;
  userId: string;
  onSelect: (workspace: Workspace) => void;
};

export function WorkspacesPage({ workspaces, activeWorkspace, userId, onSelect }: Props) {
  return <>
    <div className="mb-6"><p className="text-sm text-slate-500">{workspaces.length} espacios disponibles</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Espacios de trabajo</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Separa el contexto técnico de cada proyecto y cambia de espacio cuando lo necesites.</p></div>
    <div className="grid gap-4 lg:grid-cols-2">{workspaces.map((workspace) => <button className={`rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:border-indigo-300 hover:shadow ${workspace.id === activeWorkspace.id ? "border-indigo-300 ring-2 ring-indigo-100" : "border-slate-200"}`} key={workspace.id} onClick={() => onSelect(workspace)} type="button"><span className="flex items-start gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><Layers3 size={20} /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-900">{workspace.name}</span>{workspace.id === activeWorkspace.id && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">Activo</span>}</span><span className="mt-1 block truncate text-xs text-slate-500">{workspace.created_by === userId ? "Creado por ti" : "Espacio compartido"} · {workspace.slug}</span></span></span></button>)}</div>
    <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm leading-6 text-slate-600">La gestión de miembros e invitaciones todavía no está disponible. Los datos siguen protegidos por las políticas RLS del espacio.</div>
  </>;
}
