'use client'

import { cn } from '@/lib/utils'
import Link from 'next/link'
import React from 'react'
import { Gutter } from './gutter'
import { BackgroundGrid } from './background-grid'
import { PaperPilot3D } from './rpa-3d'
import { Github, Mail } from 'lucide-react'

type FooterLink = {
  label: string
  href: string
  external?: boolean
}

type FooterColumn = {
  label: string
  links: FooterLink[]
}

const footerColumns: FooterColumn[] = [
  {
    label: 'Platform',
    links: [
      { label: 'Workflows', href: '/projects' },
      { label: 'Agent Workspace', href: '/projects' },
    ],
  },
  {
    label: 'Resources',
    links: [
      { label: 'Documentation', href: '/docs' },
      { label: 'Getting Started', href: '/docs/getting-started' },
    ],
  },
]

export function Footer() {
  return (
    <footer
      className="relative z-10 bg-black/70 backdrop-blur-xl overflow-hidden"
      data-theme="dark"
      style={{ paddingTop: '8rem', paddingBottom: '7.5rem' }}
    >
      <BackgroundGrid
        className="absolute inset-0"
        zIndex={1}
        gridLineStyles={{
          0: { background: 'var(--grid-line-dark)' },
          1: { background: 'var(--grid-line-dark)' },
          2: { background: 'var(--grid-line-dark)' },
          3: { background: 'var(--grid-line-dark)' },
          4: { background: 'var(--grid-line-dark)' },
        }}
      />

      <Gutter className="relative z-10">
        <div className="grid grid-cols-4 gap-8 lg:grid-cols-16 lg:gap-0">
          {footerColumns.map((column, columnIndex) => (
            <div key={column.label} className="col-span-4 lg:col-span-4">
              <p className="text-xs font-medium uppercase tracking-widest text-neutral-500 mb-16 lg:mb-[4.5rem]">
                {column.label}
              </p>

              <div className="flex flex-col gap-4">
                {column.links.map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    className={cn(
                      'text-white text-base transition-colors duration-200',
                      'hover:text-neutral-400',
                      'focus:outline-none focus:underline'
                    )}
                    {...(link.external && {
                      target: '_blank',
                      rel: 'noopener noreferrer',
                    })}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}

          {/* <div className="col-span-4 lg:col-span-4">
            <p className="text-xs font-medium uppercase tracking-widest text-neutral-500 mb-16 lg:mb-[4.5rem]">
              Connect
            </p>

            <div className="flex gap-6">
              <Link
                href="https://github.com/CubeStar1/paper-pilot"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white hover:text-neutral-400 transition-colors duration-200"
                aria-label="GitHub"
              >
                <Github className="h-6 w-6" />
              </Link>
              <Link
                href="mailto:hello@paperpilot.dev"
                className="text-white hover:text-neutral-400 transition-colors duration-200"
                aria-label="Email"
              >
                <Mail className="h-6 w-6" />
              </Link>
            </div>
          </div> */}

          <div className="col-span-4 lg:col-span-8 lg:col-start-9 flex flex-col items-start lg:items-end text-left lg:text-right">
            <h2 className="text-4xl font-medium leading-[1.1] tracking-tight text-white md:text-5xl lg:text-6xl mb-8 lg:mb-12">
              RPA
            </h2>
            <p className="text-neutral-400 text-lg max-w-sm lg:max-w-md">
              The AI-powered RPA assistant that generates, validates, and deploys your GitHub Actions automatically.
            </p>
          </div>
        </div>
      </Gutter>

      <Gutter className="relative z-0">
        <PaperPilot3D />
      </Gutter>
    </footer>
  )
}
