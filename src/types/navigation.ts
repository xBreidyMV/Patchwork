import type { Decision, RepositoryEvent } from "./index";

export type View = "overview" | "decisions" | "repositories" | "timeline" | "workspaces" | "settings";
export type DecisionModal = Decision | null | "new" | { initialEvent: RepositoryEvent };
export type TimelineEntry =
  | { kind: "decision"; id: string; occurredAt: string; decision: Decision }
  | { kind: "github"; id: string; occurredAt: string; event: RepositoryEvent };
export type RecentEntry =
  | { kind: "decision"; id: string; occurredAt: string; decision: Decision }
  | { kind: "github"; id: string; occurredAt: string; event: RepositoryEvent };
