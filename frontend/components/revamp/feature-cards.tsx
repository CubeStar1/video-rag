'use client'

import { cn } from '@/lib/utils'
import { motion, useMotionTemplate, useMotionValue } from 'framer-motion'
import {
  Database,
  FileSearch,
  FolderSync,
  Sparkles,
  Layers,
  Zap,
  BookOpen,
  WifiOff,
} from 'lucide-react'
import React, { MouseEvent } from 'react'
import { BackgroundGrid } from './background-grid'
import { Gutter } from './gutter'

interface FeatureCard {
  title: string
  description: string
  icon: React.ReactNode
}

const features: FeatureCard[] = [
  {
    title: 'UiPath Automation',
    description: 'Seamless orchestration of RPA tasks via advanced LlamaIndex integrations.',
    icon: <Sparkles className="h-6 w-6" />,
  },
  {
    title: 'Model Context Protocol',
    description: 'Extend agent capabilities securely through robust FastMCP tools.',
    icon: <Database className="h-6 w-6" />,
  },
  {
    title: 'Workflow Graph',
    description: 'Interactive node-based visualization mapping the entire agent pipeline.',
    icon: <Layers className="h-6 w-6" />,
  },
  {
    title: 'YAML Generation',
    description: 'Automatically craft linted, project-specific GitHub Actions.',
    icon: <FileSearch className="h-6 w-6" />,
  },
  {
    title: 'Automated PRs',
    description: 'Deploy ready-to-merge Pull Requests directly to your repository.',
    icon: <FolderSync className="h-6 w-6" />,
  },
  {
    title: 'Live Telemetry',
    description: 'Analyze agent execution run state logs continuously as they happen.',
    icon: <Zap className="h-6 w-6" />,
  },
  {
    title: 'Multi-Model Support',
    description: 'Switch freely between models tailored for varying reasoning depth.',
    icon: <BookOpen className="h-6 w-6" />,
  },
  {
    title: 'Secure Context',
    description: 'Your project structure remains tightly scoped inside the platform.',
    icon: <WifiOff className="h-6 w-6" />,
  },
]

function SpotlightCard({ feature, index }: { feature: FeatureCard; index: number }) {
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)

  function handleMouseMove({ currentTarget, clientX, clientY }: MouseEvent) {
    const { left, top } = currentTarget.getBoundingClientRect()
    mouseX.set(clientX - left)
    mouseY.set(clientY - top)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="group relative backdrop-blur-xl bg-white/5 overflow-hidden"
      onMouseMove={handleMouseMove}
    >
      <motion.div
        className="pointer-events-none absolute -inset-px opacity-0 transition duration-300 group-hover:opacity-100"
        style={{
          background: useMotionTemplate`
            radial-gradient(
              650px circle at ${mouseX}px ${mouseY}px,
              rgba(255,255,255,0.1),
              transparent 80%
            )
          `,
        }}
      />
      <div className="relative flex h-full flex-col p-8">
        <div className="mb-6 inline-flex w-fit rounded-none bg-white/5 p-3 ring-1 ring-white/10 text-neutral-200">
          {feature.icon}
        </div>
        <h3 className="mb-3 text-xl font-semibold text-white">{feature.title}</h3>
        <p className="text-neutral-400 leading-relaxed">{feature.description}</p>
      </div>
    </motion.div>
  )
}

export function FeatureCards() {
  return (
    <section className="relative z-[1] bg-transparent py-24   md:py-32">
      <BackgroundGrid zIndex={0} />

      <Gutter>
        <motion.div
          className="mb-16 max-w-2xl"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-white md:text-4xl lg:text-5xl">
            Powerful features
          </h2>
          <p className="text-lg text-neutral-400">
            Everything you need to deploy enterprise-grade GitHub Actions faster.
          </p>
        </motion.div>

        <div className="border border-white/10">
          {/* Mobile: single column with horizontal dividers */}
          <div className="grid grid-cols-1 divide-y divide-white/10 md:hidden">
            {features.map((feature, index) => (
              <SpotlightCard key={index} feature={feature} index={index} />
            ))}
          </div>
          {/* Tablet/Desktop: 2-4 columns with vertical dividers */}
          <div className="hidden md:block">
            <div className="grid md:grid-cols-2 lg:grid-cols-4 md:divide-x divide-white/10">
              {features.slice(0, 4).map((feature, index) => (
                <SpotlightCard key={index} feature={feature} index={index} />
              ))}
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 md:divide-x divide-white/10 border-t border-white/10">
              {features.slice(4, 8).map((feature, index) => (
                <SpotlightCard key={index + 4} feature={feature} index={index + 4} />
              ))}
            </div>
          </div>
        </div>
      </Gutter>
    </section>
  )
}
