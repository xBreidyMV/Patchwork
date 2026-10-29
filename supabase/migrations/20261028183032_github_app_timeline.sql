-- GitHub App installations and a sanitized, read-only activity timeline.

create table public.github_app_installations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  github_installation_id bigint not null unique,
  account_login text not null,
  account_type text not null check (account_type in ('User', 'Organization', 'Enterprise')),
  connected_by uuid not null references auth.users (id) on delete restrict,
  is_active boolean not null default true,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.github_connect_states (
  state_hash text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  return_origin text not null,
  flow_stage text not null check (flow_stage in ('install', 'oauth')),
  github_installation_id bigint,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.github_webhook_deliveries (
  delivery_id text primary key,
  event_name text not null,
  status text not null default 'processing' check (status in ('processing', 'processed', 'ignored')),
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table public.repository_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  repository_id uuid not null,
  github_delivery_id text not null,
  external_id text not null,
  event_type text not null check (event_type in ('push', 'pull_request', 'issues')),
  action text,
  title text not null check (char_length(btrim(title)) between 1 and 500),
  summary text,
  url text check (url is null or url ~ '^https?://'),
  actor_login text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (repository_id, workspace_id)
    references public.repositories (id, workspace_id)
    on delete cascade,
  unique (github_delivery_id, external_id)
);

alter table public.repositories
  add column github_installation_id bigint references public.github_app_installations (github_installation_id) on delete set null,
  add column is_connected boolean not null default true;

create unique index repositories_workspace_full_name_uidx
  on public.repositories (workspace_id, full_name);
create index github_app_installations_workspace_idx on public.github_app_installations (workspace_id);
create index github_connect_states_expiry_idx on public.github_connect_states (expires_at);
create index repository_events_workspace_time_idx on public.repository_events (workspace_id, occurred_at desc);
create index repository_events_repository_time_idx on public.repository_events (repository_id, occurred_at desc);

create trigger github_app_installations_set_updated_at
before update on public.github_app_installations
for each row execute function private.set_updated_at();

alter table public.github_app_installations enable row level security;
alter table public.github_connect_states enable row level security;
alter table public.github_webhook_deliveries enable row level security;
alter table public.repository_events enable row level security;

create policy github_app_installations_select_member
on public.github_app_installations for select to authenticated
using (private.is_workspace_member(workspace_id));

create policy repository_events_select_member
on public.repository_events for select to authenticated
using (private.is_workspace_member(workspace_id));

revoke all on public.github_app_installations from anon, authenticated;
revoke all on public.github_connect_states from anon, authenticated;
revoke all on public.github_webhook_deliveries from anon, authenticated;
revoke all on public.repository_events from anon, authenticated;
grant select on public.github_app_installations to authenticated;
grant select on public.repository_events to authenticated;
grant all on public.github_app_installations to service_role;
grant all on public.github_connect_states to service_role;
grant all on public.github_webhook_deliveries to service_role;
grant all on public.repository_events to service_role;

grant select, update on public.repositories to authenticated;
grant all on public.repositories to service_role;
