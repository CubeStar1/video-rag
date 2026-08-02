"use client";

import { UIMessage } from "ai";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { AgentChat } from "./agent-chat";
import { ArtifactPanel } from "./artifact-panel";
import { useEffect, useState } from "react";
import { useAgentStore } from "../store/agent-store";
import { createSupabaseBrowser } from "@/lib/supabase/client";

interface AgentViewProps {
  id: string;
  projectId?: string;
  initialMessages?: UIMessage[];
}

export function AgentView({ id, projectId, initialMessages = [] }: AgentViewProps) {
  const artifactStateOpen = useAgentStore((state) => state.artifactState.isOpen);
  const [resolvedProjectId, setResolvedProjectId] = useState(projectId);

  useEffect(() => {
    setResolvedProjectId(projectId);
  }, [projectId]);

  useEffect(() => {
    const supabase = createSupabaseBrowser();

    const bootstrap = async () => {
      const { data } = await supabase
        .from("conversations")
        .select("project_id")
        .eq("id", id)
        .single();

      if (data?.project_id) {
        setResolvedProjectId(data.project_id);
      }
    };

    void bootstrap();

    const channel = supabase
      .channel(`conversation-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `id=eq.${id}` },
        (payload) => {
          const nextProjectId = (payload.new as { project_id?: string | null })?.project_id;
          if (nextProjectId) {
            setResolvedProjectId(nextProjectId);
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id]);

  return (
    <div className="h-dvh flex flex-col">
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Chat Panel — always visible, takes full width when artifact is closed */}
        <ResizablePanel defaultSize={artifactStateOpen ? 25 : 100} minSize={20}>
          <AgentChat
            id={id}
            projectId={resolvedProjectId}
            initialMessages={initialMessages}
          />
        </ResizablePanel>

        {/* Artifact Panel — slides in from the right when open */}
        {artifactStateOpen && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={75} minSize={45}>
              <ArtifactPanel />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
