export type Workspace = {
  id: string;
  name: string;
  slug: string;
  created_by: string;
};

export type Repository = {
  id: string;
  workspace_id: string;
  name: string;
  full_name: string;
  url: string;
  created_at: string;
  provider_repository_id: string | null;
  is_connected: boolean;
};

export type DecisionStatus = "draft" | "accepted" | "superseded";

export type Decision = {
  id: string;
  workspace_id: string;
  repository_id: string | null;
  title: string;
  problem: string;
  decision: string;
  rationale: string | null;
  alternatives: string[];
  consequences: string | null;
  risks: string | null;
  status: DecisionStatus;
  author_id: string;
  created_at: string;
  updated_at: string;
  links: DecisionLink[];
};

export type DecisionLink = {
  id: string;
  decision_id: string;
  provider: "github" | "external";
  resource_type: "commit" | "pull_request" | "issue" | "other";
  external_id: string | null;
  url: string;
  label: string | null;
  created_at: string;
};

export type GithubInstallation = {
  id: string;
  workspace_id: string;
  github_installation_id: string;
  account_login: string;
  account_type: string;
  is_active: boolean;
  connected_at: string;
};

export type RepositoryEvent = {
  id: string;
  workspace_id: string;
  repository_id: string;
  event_type: "push" | "pull_request" | "issues";
  action: string | null;
  title: string;
  summary: string | null;
  url: string | null;
  actor_login: string | null;
  occurred_at: string;
};

export type DecisionInput = Omit<Decision, "id" | "created_at" | "updated_at" | "links"> & {
  link_url: string;
  link_label: string;
  link_type: DecisionLink["resource_type"];
};
