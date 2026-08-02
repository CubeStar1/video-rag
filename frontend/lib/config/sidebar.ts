import Icons from "@/components/global/icons";
import { SidebarConfig } from "@/components/global/app-sidebar";

const sidebarConfig: SidebarConfig = {
  brand: {
    title: "RPA",
    icon: Icons.bot,
    href: "/"
  },
  sections: [
    {
      label: "Projects",
      items: [
        {
          title: "Projects",
          href: "/projects",
          icon: Icons.folder
        },
      ]
    }
  ]
}

export default sidebarConfig