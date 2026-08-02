"use client";

import type { UIMessage } from "ai";
import { AnimatePresence, motion } from "framer-motion";
import { memo } from "react";
import { SparklesIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageContent, MessageResponse } from "@/components/ai-elements/message";

const getMessageText = (message: UIMessage): string => {
  const textPart = message.parts?.find(part => part.type === 'text');
  return textPart && 'text' in textPart ? textPart.text : '';
};

const PurePreviewMessage = ({
  message,
  isLoading,
}: {
  message: UIMessage;
  isLoading: boolean;
}) => {
  const content = getMessageText(message);
  return (
    <AnimatePresence>
      <motion.div
        className="w-full mx-auto max-w-3xl px-4 group/message"
        initial={{
          y: 5,
          opacity: 0,
        }}
        animate={{
          y: 0,
          opacity: 1,
        }}
        data-role={message.role}
      >
        <div
          className={cn(
            "flex gap-4 w-full group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl",
            {
              "w-full": true,
              "group-data-[role=user]/message:w-fit": true,
            },
          )}
        >
          <div className="flex flex-col gap-2 w-full overflow-x-auto">
            {content && (
              <div className="flex flex-row gap-2 items-start">
                <div
                  className={cn("flex flex-col gap-4", {
                    "bg-primary text-primary-foreground px-3 py-2 rounded-xl":
                      message.role === "user",
                  })}
                >
                  <MessageContent id={message.id}>
                    <MessageResponse >
                      {content}
                    </MessageResponse>
                  </MessageContent>
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    const prevText = getMessageText(prevProps.message);
    const nextText = getMessageText(nextProps.message);
    if (prevText !== nextText) return false;
    return true;
  },
);
export const ThinkingMessage = () => {
  const role = "assistant";
  return (
    <motion.div
      className="w-full mx-auto max-w-3xl px-4 group/message"
      initial={{
        y: 5,
        opacity: 0,
      }}
      animate={{
        y: 0,
        opacity: 1,
        transition: {
          delay: 1,
        },
      }}
      data-role={role}
    >
      <div className="flex gap-4 w-full">
        <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border">
          <SparklesIcon size={14} />
        </div>

        <div className="flex flex-col gap-2 w-full">
          <div className="flex flex-col gap-4 text-muted-foreground">
            Thinking...
          </div>
        </div>
      </div>
    </motion.div>
  );
};
