export interface FooterLink {
  href: string
  label: string
}

export interface FooterSection {
  title: string
  links: FooterLink[]
}

export interface FooterConfig {
  brand: {
    title: string
    description: string
  }
  sections: FooterSection[]
  copyright: string
}

export const footerConfig: FooterConfig = {
  brand: {
    title: "FalconVQA",
    description: "Retrieval-augmented generation for video — grounded answers, timecodes, and playable clips."
  },
  sections: [
    {
      title: "Platform",
      links: [
        { href: "/projects", label: "Projects" },
        { href: "/architecture", label: "Architecture" },
      ]
    },
    {
      title: "Legal",
      links: [
        { href: "#", label: "Privacy Policy" },
        { href: "#", label: "Terms of Service" },
      ]
    }
  ],
  copyright: `© ${new Date().getFullYear()} FalconVQA. All rights reserved.`
}
