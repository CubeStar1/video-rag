"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, UIMessage } from "ai";
import { useState, useEffect, useCallback } from "react";
import { Messages } from "@/app/agent/components/messages";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  PromptInputHeader,
  PromptInputAttachments,
  PromptInputAttachment,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionAddAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { uploadChatAttachment } from "@/lib/supabase/upload-chat-attachment";
import type { FileUIPart } from "ai";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { MessageSquareIcon, PanelLeftIcon } from "lucide-react";
import { toast } from "sonner";
import { generateUUID } from "@/app/agent/lib/utils/generate-uuid";
import { useModelSelection } from "@/app/agent/hooks/use-model-selection";
import { ModelSelector } from "@/app/agent/components/model-selector";
import { useSidebar } from "@/components/ui/sidebar";
import { ModeToggle } from "@/components/global/theme-switcher";

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
  const [isUploading, setIsUploading] = useState(false);
  const { selectedModel, handleModelChange } = useModelSelection();
  const { toggleSidebar } = useSidebar();

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

  // Update URL to include conversation ID after first message
  useEffect(() => {
    if (messages.length > 0 && !window.location.pathname.includes(id)) {
      const nextPath = projectId
        ? `/projects/${projectId}/conversations/${id}`
        : `/agent/${id}`;
      window.history.replaceState({}, "", nextPath);
    }
  }, [id, messages, projectId]);

  const handleSubmit = useCallback(
    async (promptMessage: PromptInputMessage) => {
      const content = input.trim();
      const hasText = Boolean(content);
      const hasAttachments = Boolean(promptMessage.files?.length);

      if (!hasText && !hasAttachments) return;

      let uploadedFiles: FileUIPart[] = [];

      if (hasAttachments && promptMessage.files) {
        setIsUploading(true);
        try {
          const uploadPromises = promptMessage.files.map(async (fileUIPart) => {
            if (!fileUIPart.url) {
              throw new Error("File URL is missing");
            }
            const response = await fetch(fileUIPart.url);
            const blob = await response.blob();
            const file = new File([blob], fileUIPart.filename || "attachment", {
              type: fileUIPart.mediaType || blob.type,
            });
            return uploadChatAttachment(id, file);
          });
          uploadedFiles = await Promise.all(uploadPromises);
        } catch (error) {
          console.error("Error uploading attachments:", error);
          toast.error("Failed to upload attachments");
          setIsUploading(false);
          return;
        }
        setIsUploading(false);
      }

      const parts: any[] = [];
      if (content || !hasAttachments) {
        parts.push({ type: "text", text: content || "Sent with attachments" });
      }
      uploadedFiles.forEach(file => {
        parts.push(file);
      });

      sendMessage(
        { parts },
        {
          body: {
            model: selectedModel,
            conversationID: id,
            projectID: projectId,
            attachments: uploadedFiles,
          },
        }
      );

      setInput("");
    },
    [input, id, selectedModel, sendMessage]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
    },
    []
  );

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-4 py-2 h-[57px]">
        <button
          onClick={() => toggleSidebar()}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors active:scale-95"
          title="Toggle sidebar"
        >
          <PanelLeftIcon className="size-4" />
        </button>
        
        <div className="ml-auto flex items-center gap-2">
          <ModeToggle />
        </div>
      </div>

      {/* Messages */}
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto flex min-w-0 max-w-3xl flex-col gap-4 px-2 py-4 md:gap-6 md:px-4">
          {messages.length === 0 && status !== "streaming" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 pt-20">
              <div className="rounded-full bg-muted p-4">
                <MessageSquareIcon className="size-8 text-muted-foreground" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-semibold">Start a conversation</h3>
                <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                  Ask a question, attach a file, or describe what you&apos;re working on.
                </p>
              </div>
            </div>
          )}
          <Messages
            isLoading={status === "submitted" || status === "streaming"}
            messages={messages}
          />
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Input */}
      <div className="sticky bottom-0 z-10 mx-auto flex w-full max-w-3xl flex-col gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
        <PromptInput onSubmit={handleSubmit} className="border-border w-full" globalDrop multiple>
          <PromptInputHeader className="p-0">
            <PromptInputAttachments>
              {(attachment) => <PromptInputAttachment data={attachment} />}
            </PromptInputAttachments>
          </PromptInputHeader>
          <PromptInputBody>
            <PromptInputTextarea
              onChange={handleInputChange}
              value={input}
              placeholder="Send a message..."
              name="message"
              disabled={isUploading || status === "streaming" || status === "submitted"}
              autoFocus
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>

              <ModelSelector
                key={selectedModel}
                selectedModelId={selectedModel}
                onModelChange={handleModelChange}
              />
            </PromptInputTools>
            <PromptInputSubmit
              disabled={(!input && status !== "streaming") || isUploading}
              status={
                isUploading || status === "streaming" || status === "submitted"
                  ? "streaming"
                  : "ready"
              }
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
