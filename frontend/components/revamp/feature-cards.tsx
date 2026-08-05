'use client'

import { cn } from '@/lib/utils'
import { motion, useMotionTemplate, useMotionValue } from 'framer-motion'
import {
  AudioLines,
  Scan,
  Clapperboard,
  MessageSquareQuote,
  Scissors,
  BarChart3,
  Search,
  Server,
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
    title: 'Semantic Moment Search',
    description: 'Describe what you are looking for and get ranked, timestamped moments across every tagged video.',
    icon: <Search className="h-6 w-6" />,
  },
  {
    title: 'Cited Answers',
    description: 'Responses stay short and point back at the m:ss timecodes the evidence came from.',
    icon: <MessageSquareQuote className="h-6 w-6" />,
  },
  {
    title: 'Clip Artifact Panel',
    description: 'Retrieved moments become a reel you can scrub, filter, and play end to end.',
    icon: <Scissors className="h-6 w-6" />,
  },
  {
    title: 'Speech & Speakers',
    description: 'Whisper transcripts with diarization, so you know who said what and exactly when.',
    icon: <AudioLines className="h-6 w-6" />,
  },
  {
    title: 'Visual Understanding',
    description: 'YOLO detection, CLIP embeddings, and on-screen OCR describe what the frame actually shows.',
    icon: <Scan className="h-6 w-6" />,
  },
  {
    title: 'Scenes & Chapters',
    description: 'An interactive timeline of scenes, chapters, and events you can jump straight into.',
    icon: <Clapperboard className="h-6 w-6" />,
  },
  {
    title: 'Video-Level Insights',
    description: 'Aggregators roll chunks up into entity timelines, co-occurrence, sentiment, and stats.',
    icon: <BarChart3 className="h-6 w-6" />,
  },
  {
    title: 'Self-Hosted Core',
    description: 'FastAPI, PyTorch, and Qdrant run the pipeline on your own hardware — your footage stays yours.',
    icon: <Server className="h-6 w-6" />,
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
            Built for video
          </h2>
          <p className="text-lg text-neutral-400">
            A full retrieval stack — chunking, analysis, indexing, and answers — purpose-built for footage.
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
