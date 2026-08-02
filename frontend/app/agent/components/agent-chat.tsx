"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, UIMessage } from "ai";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Messages } from "@/app/agent/components/messages";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  PromptInputHeader,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { FilmIcon, PanelLeftIcon } from "lucide-react";
import { toast } from "sonner";
import { generateUUID } from "@/app/agent/lib/utils/generate-uuid";
import { useModelSelection } from "@/app/agent/hooks/use-model-selection";
import { ModelSelector } from "@/app/agent/components/model-selector";
import { VideoPicker, VideoChips } from "@/app/agent/components/video-picker";
import { useProjectVideos } from "@/hooks/use-project-videos";
import { useSidebar } from "@/components/ui/sidebar";
import { ModeToggle } from "@/components/global/theme-switcher";
import { useAgentStore } from "@/app/agent/store/agent-store";
import { cn } from "@/lib/utils";

interface AgentChatProps {
  id: string;
  projectId?: string;
  initialMessages?: UIMessage[];
}

export function AgentChat({
  id,
  projectId,
  initialMessages = [],
}: AgentChatProps) {
  const [input, setInput] = useState("");
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);
  const { selectedModel, handleModelChange } = useModelSelection();
  const { toggleSidebar } = useSidebar();
  const studioOpen = useAgentStore((state) => state.studioState.isOpen);
  const toggleStudio = useAgentStore((state) => state.toggleStudio);
  const router = useRouter();
  const searchParams = useSearchParams();

  const { videos, readyVideos } = useProjectVideos(projectId ?? "");

  const { messages, status, sendMessage } = useChat({
    messages: initialMessages,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: "/api/agent",
    }),
    onError: (error) => {
      console.error("Agent error:", error);
      toast.error("Agent error", { description: error.message });
    },
  });

  const isBusy = status === "streaming" || status === "submitted";

  const submit = useCallback(
    (text: string, videoIds: string[]) => {
      const content = text.trim();
      if (!content) return;

      sendMessage(
        { parts: [{ type: "text", text: content }] },
        {
          body: {
            model: selectedModel,
            conversationID: id,
            projectID: projectId,
            selectedVideoIds: videoIds,
          },
        }
      );
      setInput("");
    },
    [id, projectId, selectedModel, sendMessage]
  );

  // The workspace launches a chat by passing the first prompt (and the videos to
  // scope it to) through the URL. Fire it once, then strip the params.
  const hasAutoSent = useRef(false);
  useEffect(() => {
    if (hasAutoSent.current || messages.length > 0) return;

    const prompt = searchParams.get("q");
    if (!prompt) return;

    hasAutoSent.current = true;
    const videoIds = searchParams.get("videos")?.split(",").filter(Boolean) ?? [];
    setSelectedVideoIds(videoIds);
    submit(prompt, videoIds);
    router.replace(
      projectId ? `/projects/${projectId}/conversations/${id}` : `/agent/${id}`
    );
  }, [searchParams, messages.length, submit, router, projectId, id]);

  const handleSubmit = useCallback(
    (_promptMessage: PromptInputMessage) => {
      submit(input, selectedVideoIds);
    },
    [input, selectedVideoIds, submit]
  );

  const toggleVideo = useCallback((videoId: string) => {
    setSelectedVideoIds((current) =>
      current.includes(videoId)
        ? current.filter((item) => item !== videoId)
        : [...current, videoId]
    );
  }, []);

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      {/* Header */}
      <div className="flex h-[57px] items-center gap-2 border-b px-4 py-2">
        <button
          onClick={() => toggleSidebar()}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          title="Toggle sidebar"
        >
          <PanelLeftIcon className="size-4" />
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={toggleStudio}
            title={studioOpen ? "Hide the video panel" : "Show the video panel"}
            className={cn(
              "rounded-md p-2 transition-colors hover:bg-muted active:scale-95",
              studioOpen
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <FilmIcon className="size-4" />
          </button>
          <ModeToggle />
        </div>
      </div>

      {/* Messages */}
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto flex min-w-0 max-w-3xl flex-col gap-4 px-2 py-4 md:gap-6 md:px-4">
          {messages.length === 0 && !isBusy && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 pt-20">
              <div className="rounded-full bg-muted p-4">
                <FilmIcon className="size-8 text-muted-foreground" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-semibold">Ask about your videos</h3>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  {readyVideos.length > 0
                    ? "Tag the videos you want to search, then ask a question, look for a moment, or request clips."
                    : "No videos are indexed in this project yet. Upload one from the project page first."}
                </p>
              </div>
            </div>
          )}
          <Messages isLoading={isBusy} messages={messages} />
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Input */}
      <div className="sticky bottom-0 z-10 mx-auto flex w-full max-w-3xl flex-col gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
        <PromptInput onSubmit={handleSubmit} className="w-full border-border">
          <PromptInputHeader className="p-0">
            <VideoChips
              videos={videos}
              selectedIds={selectedVideoIds}
              onRemove={toggleVideo}
            />
          </PromptInputHeader>
          <PromptInputBody>
            <PromptInputTextarea
              onChange={(event) => setInput(event.target.value)}
              value={input}
              placeholder="Ask about your videos — find a moment, summarize, or pull clips…"
              name="message"
              disabled={isBusy}
              autoFocus
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <VideoPicker
                videos={videos}
                selectedIds={selectedVideoIds}
                onToggle={toggleVideo}
                onClear={() => setSelectedVideoIds([])}
                disabled={isBusy}
              />

              <ModelSelector
                key={selectedModel}
                selectedModelId={selectedModel}
                onModelChange={handleModelChange}
              />
            </PromptInputTools>
            <PromptInputSubmit
              disabled={!input.trim() && !isBusy}
              status={isBusy ? "streaming" : "ready"}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
