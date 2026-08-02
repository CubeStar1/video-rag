import { Metadata } from 'next'
import { Header } from '@/components/global/header'
import { headerConfig } from '@/lib/config/header'
import { Footer } from '@/components/revamp/footer'

export const metadata: Metadata = {
  title: 'RPA',
  description:
    'RPA',
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark bg-black text-white" data-theme="dark">
      <Header config={headerConfig} />
      {children}
      <Footer />
    </div>
  )
}
