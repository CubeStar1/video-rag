import { LucideIcon } from "lucide-react"

export interface HeaderLink {
  href: string
  label: string
  icon?: LucideIcon
  description?: string
}

export interface HeaderConfig {
  brand: {
    title: string
    icon: string
  }
  navigationLinks: HeaderLink[]
}

export const headerConfig: HeaderConfig = {
  brand: {
    title: "FalconVQA",
    icon: "/logos/falcon-vqa-logo.png"
  },
  navigationLinks: [
    {
      href: "/",
      label: "Home"
    },
    {
      href: "/projects",
      label: "Projects"
    },
    {
      href: "/docs",
      label: "Documentation"
    }
  ]
}