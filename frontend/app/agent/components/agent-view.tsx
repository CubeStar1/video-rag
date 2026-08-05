"use client";

import { UIMessage } from "ai";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { AgentChat } from "./agent-chat";
import { ArtifactPanel } from "./artifact-panel";
import { VideoStudioPanel } from "./video-studio/video-studio-panel";
import { Fragment, useEffect, useState } from "react";
import { useAgentStore } from "../store/agent-store";
import { ConversationScope } from "../hooks/use-conversation-id";
import { createSupabaseBrowser } from "@/lib/supabase/client";

interface AgentViewProps {
  id: string;
  projectId?: string;
  initialMessages?: UIMessage[];
}

export function AgentView({ id, projectId, initialMessages = [] }: AgentViewProps) {
  // The store outlives this view, so the panel only opens for an artifact this
  // conversation opened — otherwise the previous chat's clips reappear here.
  const artifactStateOpen = useAgentStore(
    (state) => state.artifactState.isOpen && state.artifactState.conversationId === id
  );
  const studioOpen = useAgentStore((state) => state.studioState.isOpen);
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

  // Panels are added and removed at runtime, so each one carries a stable id and
  // order. `defaultSize` only applies the first time a panel mounts.
  const chatSize = studioOpen ? (artifactStateOpen ? 24 : 34) : artifactStateOpen ? 25 : 100;

  return (
    <ConversationScope id={id}>
      <div className="h-dvh flex flex-col">
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          {/* Chat — always visible */}
          <ResizablePanel id="chat" order={1} defaultSize={chatSize} minSize={18}>
            <AgentChat
              id={id}
              projectId={resolvedProjectId}
              initialMessages={initialMessages}
            />
          </ResizablePanel>

          {/* Video studio — the persistent player and timeline for the workspace */}
          {studioOpen && (
            <Fragment key="studio">
              <ResizableHandle withHandle />
              <ResizablePanel
                id="studio"
                order={2}
                defaultSize={artifactStateOpen ? 40 : 66}
                minSize={25}
              >
                <VideoStudioPanel projectId={resolvedProjectId} />
              </ResizablePanel>
            </Fragment>
          )}

          {/* Artifact Panel — slides in from the right when open */}
          {artifactStateOpen && (
            <Fragment key="artifact">
              <ResizableHandle withHandle />
              <ResizablePanel
                id="artifact"
                order={3}
                defaultSize={studioOpen ? 36 : 75}
                minSize={22}
              >
                <ArtifactPanel />
              </ResizablePanel>
            </Fragment>
          )}
        </ResizablePanelGroup>
      </div>
    </ConversationScope>
  );
}
