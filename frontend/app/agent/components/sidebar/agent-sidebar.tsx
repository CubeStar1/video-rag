"use client";

import { User } from "@supabase/supabase-js";
import Link from "next/link";
import {
  PlusIcon,
  FolderKanbanIcon,
} from "lucide-react";
import { AgentSidebarHistory } from "./sidebar-history";
import { SidebarUserNav } from "@/app/agent/components/sidebar/sidebar-user-nav";
import Image from "next/image";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarRail,
  SidebarSeparator,
  SidebarGroup,
  SidebarGroupContent,
  useSidebar,
} from "@/components/ui/sidebar";

interface AgentSidebarProps {
  user: User | null;
}

export function AgentSidebar({ user }: AgentSidebarProps) {
  const { setOpenMobile } = useSidebar();
  const appName = process.env.NEXT_PUBLIC_APP_NAME!;
  const appIcon = process.env.NEXT_PUBLIC_APP_ICON!;

  return (
    <Sidebar collapsible="icon" className="group-data-[side=left]:border-r-0 overflow-x-hidden">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              size="lg"
              tooltip={appName}
            >
              <Link
                href="/"
                onClick={() => setOpenMobile(false)}
              >
                <Image
                  src={appIcon}
                  alt={appName}
                  width={24}
                  height={24}
                  className="h-6 w-6 rounded-full shrink-0"
                />
                <span className="text-lg font-semibold truncate">
                  {appName}
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="overflow-x-hidden">
        {/* Icon actions — always visible, icon-only when collapsed */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Projects">
                  <Link href="/projects" onClick={() => setOpenMobile(false)}>
                    <FolderKanbanIcon className="size-4" />
                    <span>Projects</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <div className="group-data-[collapsible=icon]:hidden">
          <SidebarSeparator />

          {/* Chat history — hidden when collapsed */}
          <AgentSidebarHistory user={user!} />
        </div>
      </SidebarContent>

      <SidebarFooter>
        {user && <SidebarUserNav user={user} />}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
