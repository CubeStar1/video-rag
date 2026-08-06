import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'FalconVQA Docs',
      url: '/',
    },
    links: [
      { text: 'Documentation', url: '/docs', active: 'nested-url' },
      { text: 'API Reference', url: '/docs/api', active: 'nested-url' },
      { text: 'Projects', url: '/projects' },
    ],
  }
}
