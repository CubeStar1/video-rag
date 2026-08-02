'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { NavigationMobile } from './header-mobile'
import { motion, LayoutGroup } from 'framer-motion'
import { HeaderConfig } from '@/lib/config/header'
import { GithubStarButton } from '@/components/revamp/github-star-button'

interface HeaderProps {
  config: HeaderConfig
}

export function Header({ config }: HeaderProps) {
  const pathname = usePathname()
  const [isScrolled, setIsScrolled] = React.useState(false)

  React.useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <>
      <div className="m-10" />

      <motion.header
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 100, damping: 20 }}
        className="fixed left-0 right-0 top-0 z-50"
      >
        <motion.div
          animate={{
            maxWidth: isScrolled ? '68rem' : '100%',
            margin: isScrolled ? '1rem auto' : '0 auto',
            borderRadius: isScrolled ? '9999px' : '0',
          }}
          transition={{
            duration: 0.3,
            ease: 'easeInOut',
          }}
          style={{
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
          }}
          className={cn(
            'transition-all duration-500',
            isScrolled
              ? 'bg-transparent backdrop-blur-xl border border-white/10 mx-4 md:mx-auto'
              : 'bg-black/40 backdrop-blur-xl border-b border-white/5'
          )}
        >
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className={cn('flex items-center justify-between', isScrolled ? 'h-14' : 'h-16')}>
              <Link href="/" className="group relative flex items-center gap-3">
                <Image
                  src={config.brand.icon}
                  alt={config.brand.title}
                  width={40}
                  height={40}
                  className="rounded-md"
                />
                <span className="font-medium tracking-tight text-white">{config.brand.title}</span>
              </Link>

              <nav className="relative hidden md:block">
                <LayoutGroup>
                  <motion.ul className="flex items-center gap-1">
                    {config.navigationLinks.map((item) => {
                      const isActive =
                        pathname === item.href || pathname.startsWith(`${item.href}/`)
                      return (
                        <motion.li
                          key={item.href}
                          className="relative flex items-center justify-center"
                        >
                          <Link
                            href={item.href}
                            className={cn(
                              'relative flex items-center justify-center rounded-full px-4 py-2 text-sm transition-colors duration-200',
                              isActive
                                ? 'text-white font-medium'
                                : 'text-neutral-400 hover:text-white'
                            )}
                          >
                            {item.label}
                          </Link>
                          {isActive && (
                            <motion.div
                              layoutId="nav-active"
                              className="absolute inset-0 -z-10 rounded-full bg-white/10 border border-white/20"
                              transition={{
                                type: 'spring',
                                stiffness: 400,
                                damping: 30,
                                mass: 1,
                              }}
                            />
                          )}
                        </motion.li>
                      )
                    })}
                  </motion.ul>
                </LayoutGroup>
              </nav>

              <div className="flex items-center gap-3">
                {/* <GithubStarButton /> */}
                <Link
                  href="/signin"
                  className="hidden md:inline-flex items-center justify-center px-5 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-full transition-colors duration-200"
                >
                  Sign In
                </Link>
                <div className="md:hidden">
                  <NavigationMobile navigationLinks={config.navigationLinks} />
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.header>
    </>
  )
}
