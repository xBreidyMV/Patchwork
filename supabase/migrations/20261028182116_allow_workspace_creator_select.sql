-- A workspace INSERT ... RETURNING is subject to the SELECT policy as well.
-- Allow its creator to read the row in that statement, even if the owner
-- membership trigger has not become visible to a membership lookup yet.
drop policy if exists workspaces_select_member on public.workspaces;

create policy workspaces_select_member
on public.workspaces for select to authenticated
using (
  private.is_workspace_member(id)
  or created_by = (select auth.uid())
);
