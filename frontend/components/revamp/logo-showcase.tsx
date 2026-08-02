'use client'

import { cn } from '@/lib/utils'
import React from 'react'
import { motion } from 'framer-motion'
import { Gutter } from './gutter'
import { BackgroundScanline } from './background-scanline'
import Image from 'next/image'

const logos = [
  { name: 'OpenAI', icon: '/logos/providers/openai-logo.png' },
  { name: 'Gemini', icon: '/logos/providers/gemini-logo.png' },
  { name: 'Groq', icon: '/logos/providers/groq-logo.png' },
  { name: 'Cerebras', icon: '/logos/providers/cerebras-logo.png' },
]

function CrosshairIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5 text-white/50', className)}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 20 21"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M10 0.332031V20.332" />
      <path d="M0 10.332L20 10.332" />
    </svg>
  )
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
}

function LogoCell({ logo, className }: { logo: (typeof logos)[0]; className?: string }) {
  return (
    <motion.div
      variants={itemVariants}
      className={cn(
        'group relative flex aspect-square w-full items-center justify-center',
        'border-l border-[var(--grid-line-dark,rgba(255,255,255,0.1))]',
        'transition-all duration-300',
        className
      )}
    >
      <div
        className={cn(
          'relative z-10 flex items-center justify-center overflow-hidden rounded-2xl bg-white p-4 shadow-sm transition-all duration-300',
          'h-24 w-40 group-hover:scale-105 group-hover:shadow-[0_0_20px_rgba(255,255,255,0.3)]'
        )}
      >
        <Image
          src={logo.icon}
          alt={logo.name}
          width={120}
          height={60}
          className="h-full w-full object-contain"
        />
      </div>

      <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] font-medium uppercase tracking-widest text-white/40 transition-colors group-hover:text-white/70">
        {logo.name}
      </span>

      <BackgroundScanline
        className={cn('opacity-0 transition-opacity duration-500', 'group-hover:opacity-100')}
      />
    </motion.div>
  )
}

export function LogoShowcase() {
  return (
    <Gutter className="mt-8 flex flex-col items-center gap-8">
      <motion.p
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="max-w-5xl text-center text-xl font-medium leading-relaxed text-white"
      >
        RPA supports models from the following providers
      </motion.p>

      <motion.div
        className="relative grid w-full grid-cols-2 border border-[var(--grid-line-dark,rgba(255,255,255,0.1))] border-l-0 md:grid-cols-4 lg:grid-cols-16"
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
      >
        {logos.map((logo, index) => (
          <LogoCell
            key={index}
            logo={logo}
            className={cn('col-span-1 lg:col-span-2', index === 0 && 'lg:col-start-5 border-l-0')}
          />
        ))}

        <CrosshairIcon className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2" />
        <CrosshairIcon className="absolute right-0 top-0 -translate-y-1/2 translate-x-1/2" />
        <CrosshairIcon className="absolute bottom-0 left-0 -translate-x-1/2 translate-y-1/2" />
        <CrosshairIcon className="absolute bottom-0 right-0 translate-x-1/2 translate-y-1/2" />
      </motion.div>
    </Gutter>
  )
}
