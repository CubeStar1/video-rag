import { source } from '@/lib/fumadocs/source'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { baseOptions } from '@/lib/fumadocs/layout.shared'
import { RootProvider } from 'fumadocs-ui/provider/next'

export default function Layout({ children }: LayoutProps<'/docs'>) {
  return (
    <RootProvider>
      <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
        {children}
      </DocsLayout>
    </RootProvider>
  )
}
