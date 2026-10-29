-- Patchwork's first schema. All application tables are private to authenticated
-- users through explicit grants plus row-level security.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (
    display_name is null or char_length(btrim(display_name)) between 1 and 120
  ),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9-]+$'),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (created_by, slug),
  unique (id, created_by)
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.repositories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null default 'github' check (provider = 'github'),
  provider_repository_id text,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 255),
  url text not null check (url ~ '^https://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, provider, provider_repository_id)
);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  repository_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  problem text not null,
  decision text not null,
  rationale text,
  alternatives jsonb not null default '[]'::jsonb check (jsonb_typeof(alternatives) = 'array'),
  consequences text,
  risks text,
  status text not null default 'accepted' check (status in ('draft', 'accepted', 'superseded')),
  author_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (repository_id, workspace_id)
    references public.repositories (id, workspace_id)
    on delete restrict
);

create table public.decision_links (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.decisions (id) on delete cascade,
  provider text not null default 'github' check (provider in ('github', 'external')),
  resource_type text not null check (resource_type in ('commit', 'pull_request', 'issue', 'other')),
  external_id text,
  url text not null check (url ~ '^https?://'),
  label text,
  created_at timestamptz not null default now(),
  unique (decision_id, url)
);

create index workspace_members_user_id_idx on public.workspace_members (user_id);
create index repositories_workspace_id_idx on public.repositories (workspace_id);
create index decisions_workspace_created_at_idx on public.decisions (workspace_id, created_at desc);
create index decisions_repository_id_idx on public.decisions (repository_id) where repository_id is not null;
create index decisions_status_idx on public.decisions (workspace_id, status);
create index decision_links_decision_id_idx on public.decision_links (decision_id);

-- These SECURITY DEFINER helpers stay in the non-exposed private schema. They
-- only return membership booleans, use the request's auth.uid(), and pin an
-- empty search_path so policy checks do not recurse through RLS.
create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.workspace_members as wm
      where wm.workspace_id = p_workspace_id
        and wm.user_id = (select auth.uid())
    );
$$;

create or replace function private.is_workspace_owner(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.workspace_members as wm
      where wm.workspace_id = p_workspace_id
        and wm.user_id = (select auth.uid())
        and wm.role = 'owner'
    );
$$;

create or replace function private.is_workspace_creator(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.workspaces as w
      where w.id = p_workspace_id
        and w.created_by = (select auth.uid())
    );
$$;

revoke all on function private.is_workspace_member(uuid) from public, anon;
revoke all on function private.is_workspace_owner(uuid) from public, anon;
revoke all on function private.is_workspace_creator(uuid) from public, anon;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.is_workspace_owner(uuid) to authenticated;
grant execute on function private.is_workspace_creator(uuid) to authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.add_workspace_owner_membership()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

grant execute on function private.set_updated_at() to authenticated;
grant execute on function private.add_workspace_owner_membership() to authenticated;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function private.set_updated_at();

create trigger repositories_set_updated_at
before update on public.repositories
for each row execute function private.set_updated_at();

create trigger decisions_set_updated_at
before update on public.decisions
for each row execute function private.set_updated_at();

create trigger workspaces_add_owner_membership
after insert on public.workspaces
for each row execute function private.add_workspace_owner_membership();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.repositories enable row level security;
alter table public.decisions enable row level security;
alter table public.decision_links enable row level security;

create policy profiles_select_own
on public.profiles for select to authenticated
using (id = (select auth.uid()));

create policy profiles_insert_own
on public.profiles for insert to authenticated
with check (id = (select auth.uid()));

create policy profiles_update_own
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy workspaces_select_member
on public.workspaces for select to authenticated
using (private.is_workspace_member(id));

create policy workspaces_insert_self
on public.workspaces for insert to authenticated
with check (created_by = (select auth.uid()));

create policy workspaces_update_owner
on public.workspaces for update to authenticated
using (private.is_workspace_owner(id))
with check (private.is_workspace_owner(id) and created_by = (select auth.uid()));

create policy workspace_members_select_member
on public.workspace_members for select to authenticated
using (private.is_workspace_member(workspace_id));

create policy workspace_members_insert_owner_or_creator
on public.workspace_members for insert to authenticated
with check (
  (user_id = (select auth.uid()) and role = 'owner' and private.is_workspace_creator(workspace_id))
  or (role = 'member' and private.is_workspace_owner(workspace_id))
);

create policy workspace_members_delete_member_as_owner
on public.workspace_members for delete to authenticated
using (role = 'member' and private.is_workspace_owner(workspace_id));

create policy repositories_select_member
on public.repositories for select to authenticated
using (private.is_workspace_member(workspace_id));

create policy repositories_insert_member
on public.repositories for insert to authenticated
with check (private.is_workspace_member(workspace_id));

create policy repositories_update_member
on public.repositories for update to authenticated
using (private.is_workspace_member(workspace_id))
with check (private.is_workspace_member(workspace_id));

create policy repositories_delete_member
on public.repositories for delete to authenticated
using (private.is_workspace_member(workspace_id));

create policy decisions_select_member
on public.decisions for select to authenticated
using (private.is_workspace_member(workspace_id));

create policy decisions_insert_author
on public.decisions for insert to authenticated
with check (
  author_id = (select auth.uid())
  and private.is_workspace_member(workspace_id)
);

create policy decisions_update_author
on public.decisions for update to authenticated
using (
  author_id = (select auth.uid())
  and private.is_workspace_member(workspace_id)
)
with check (
  author_id = (select auth.uid())
  and private.is_workspace_member(workspace_id)
);

create policy decisions_delete_author
on public.decisions for delete to authenticated
using (
  author_id = (select auth.uid())
  and private.is_workspace_member(workspace_id)
);

create policy decision_links_select_member
on public.decision_links for select to authenticated
using (
  exists (
    select 1
    from public.decisions as d
    where d.id = decision_id
      and private.is_workspace_member(d.workspace_id)
  )
);

create policy decision_links_insert_member
on public.decision_links for insert to authenticated
with check (
  exists (
    select 1
    from public.decisions as d
    where d.id = decision_id
      and private.is_workspace_member(d.workspace_id)
  )
);

create policy decision_links_update_member
on public.decision_links for update to authenticated
using (
  exists (
    select 1
    from public.decisions as d
    where d.id = decision_id
      and private.is_workspace_member(d.workspace_id)
  )
)
with check (
  exists (
    select 1
    from public.decisions as d
    where d.id = decision_id
      and private.is_workspace_member(d.workspace_id)
  )
);

create policy decision_links_delete_member
on public.decision_links for delete to authenticated
using (
  exists (
    select 1
    from public.decisions as d
    where d.id = decision_id
      and private.is_workspace_member(d.workspace_id)
  )
);

-- New public tables are not implicitly exposed to the Data API; keep grants
-- explicit and rely on the RLS policies above for row-level authorization.
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.workspaces to authenticated;
grant select, insert, delete on public.workspace_members to authenticated;
grant select, insert, update, delete on public.repositories to authenticated;
grant select, insert, update, delete on public.decisions to authenticated;
grant select, insert, update, delete on public.decision_links to authenticated;
