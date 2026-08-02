"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { User } from "@supabase/supabase-js";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FolderGit2,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  ChevronRight,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { useAgentStore } from "@/app/agent/store/agent-store";
import type { ProjectHistoryItem } from "@/app/agent/types";

function ConversationRow({
  projectId,
  conversation,
  isActive,
  onRename,
  onDelete,
}: {
  projectId: string;
  conversation: ProjectHistoryItem["conversations"][number];
  isActive: boolean;
  onRename: (conversationId: string, title: string) => void;
  onDelete: (conversationId: string) => void;
}) {
  const { setOpenMobile } = useSidebar();
  const handleArtifactClose = useAgentStore((state) => state.handleArtifactClose);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(conversation.title);

  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild isActive={isActive} className="pr-8">
        <Link
          href={`/projects/${projectId}/conversations/${conversation.id}`}
          onClick={() => {
            handleArtifactClose();
            setOpenMobile(false);
          }}
        >
          <span className="truncate">{conversation.title}</span>
        </Link>
      </SidebarMenuSubButton>

      <DropdownMenu modal>
        <DropdownMenuTrigger asChild>
          <button className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-md bg-transparent text-sidebar-foreground/50 opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover/menu-sub-item:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring">
            <MoreHorizontalIcon className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end">
          <DropdownMenuItem
            onClick={() => {
              setIsRenaming(true);
              setNewTitle(conversation.title);
            }}
          >
            <PencilIcon className="size-4" />
            <span>Rename</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:bg-destructive/15 focus:text-destructive"
            onClick={() => onDelete(conversation.id)}
          >
            <TrashIcon className="size-4" />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isRenaming} onOpenChange={setIsRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
          </DialogHeader>
          <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRenaming(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onRename(conversation.id, newTitle);
                setIsRenaming(false);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarMenuSubItem>
  );
}

export function AgentSidebarHistory({ user }: { user: User | undefined }) {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const currentConversationId = typeof params?.conversationId === "string"
    ? params.conversationId
    : typeof params?.id === "string"
      ? params.id
      : "";
  const currentProjectId = typeof params?.projectId === "string" ? params.projectId : "";

  const { data, isLoading } = useQuery({
    queryKey: ["agent-project-history", user?.id],
    queryFn: async () => {
      const res = await fetch("/api/agent/history");
      if (!res.ok) throw new Error("Failed to load project history");
      return res.json() as Promise<ProjectHistoryItem[]>;
    },
    enabled: !!user,
  });

  const deleteMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const res = await fetch(`/api/chat?id=${conversationId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete conversation");
      return conversationId;
    },
    onSuccess: (deletedConversationId) => {
      queryClient.invalidateQueries({ queryKey: ["agent-project-history", user?.id] });
      toast.success("Conversation deleted");
      if (deletedConversationId === currentConversationId) {
        router.push("/projects");
      }
    },
    onError: () => {
      toast.error("Failed to delete conversation");
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ conversationId, title }: { conversationId: string; title: string }) => {
      const res = await fetch(`/api/chat?id=${conversationId}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error("Failed to rename conversation");
      return { conversationId, title };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-project-history", user?.id] });
      toast.success("Conversation renamed");
    },
    onError: () => {
      toast.error("Failed to rename conversation");
    },
  });

  const historyItems = useMemo(() => data ?? [], [data]);

  if (!user) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <div className="px-2 text-sm text-muted-foreground">
            Sign in to save projects and revisit your conversations.
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (isLoading) {
    return (
      <SidebarGroup>
        <SidebarGroupLabel>Projects</SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Loading project history...
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (!historyItems.length) {
    return (
      <SidebarGroup>
        <SidebarGroupLabel>Projects</SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="px-2 text-sm text-muted-foreground">
            Your projects will appear here once you create one.
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Projects</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {historyItems.map((item) => (
              <Collapsible key={item.project.id} asChild defaultOpen className="group/collapsible">
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip={item.project.name} isActive={item.project.id === currentProjectId}>
                      <ChevronRight className="transition-transform group-data-[state=open]/collapsible:rotate-90" />
                      <FolderGit2 className="size-4 shrink-0" />
                      <span className="truncate">{item.project.name}</span>
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  
                  <SidebarMenuAction
                    showOnHover
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      router.push(`/projects/${item.project.id}/conversations`);
                    }}
                    title="New conversation"
                  >
                    <PlusIcon className="size-4" />
                  </SidebarMenuAction>

                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {item.conversations.slice(0, 6).map((conversation) => (
                        <ConversationRow
                          key={conversation.id}
                          projectId={item.project.id}
                          conversation={conversation}
                          isActive={conversation.id === currentConversationId}
                      onDelete={(conversationId) => {
                        setDeleteId(conversationId);
                        setShowDeleteDialog(true);
                      }}
                      onRename={(conversationId, title) =>
                        renameMutation.mutate({ conversationId, title })
                      }
                    />
                  ))}

                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <AlertDialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the conversation and its local message history from the app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
