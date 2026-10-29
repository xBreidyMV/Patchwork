import { useCallback, useEffect, useRef, useState } from "react";
import { countWorkspaceMembers, listDecisions, listGithubInstallations, listRepositoryEvents, listRepositories } from "../services/data";
import type { Decision, GithubInstallation, Repository, RepositoryEvent } from "../types";

export function useWorkspaceData(
  workspaceId: string | undefined,
  userId: string | undefined,
  onError: (error: unknown) => void,
) {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [installations, setInstallations] = useState<GithubInstallation[]>([]);
  const [repositoryEvents, setRepositoryEvents] = useState<RepositoryEvent[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const refreshInFlight = useRef(false);

  const refreshData = useCallback(async (silent = false) => {
    if (!workspaceId || refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (!silent) setDataLoading(true);
    try {
      const [repoRows, decisionRows, installationRows, eventRows, members] = await Promise.all([
        listRepositories(workspaceId),
        listDecisions(workspaceId),
        listGithubInstallations(workspaceId),
        listRepositoryEvents(workspaceId),
        countWorkspaceMembers(workspaceId),
      ]);
      setRepositories(repoRows);
      setDecisions(decisionRows);
      setInstallations(installationRows);
      setRepositoryEvents(eventRows);
      setMemberCount(members);
    } catch (error) {
      if (!silent) onError(error);
    } finally {
      refreshInFlight.current = false;
      if (!silent) setDataLoading(false);
    }
  }, [onError, workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      setRepositories([]);
      setDecisions([]);
      setInstallations([]);
      setRepositoryEvents([]);
      setMemberCount(0);
      setDataLoading(false);
      return;
    }
    void refreshData();
  }, [refreshData, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !userId) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshData(true);
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const interval = window.setInterval(refreshWhenVisible, 60_000);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.clearInterval(interval);
    };
  }, [refreshData, userId, workspaceId]);

  return { repositories, installations, repositoryEvents, memberCount, decisions, dataLoading, refreshData };
}
