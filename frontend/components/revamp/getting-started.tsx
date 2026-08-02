'use client'

import { cn } from '@/lib/utils'
import { motion, useMotionTemplate, useMotionValue } from 'framer-motion'
import React, { MouseEvent } from 'react'
import { BackgroundGrid } from './background-grid'
import { Gutter } from './gutter'

interface Step {
  number: string
  title: string
  description: string
}

const steps: Step[] = [
  {
    number: '01',
    title: 'Sign Up',
    description: 'Create your account securely using your credentials. Get started instantly.',
  },
  {
    number: '02',
    title: 'Create a Workflow',
    description: 'Initiate a conversational session and paste your GitHub repository link.',
  },
  {
    number: '03',
    title: 'Agentic Generation',
    description: 'Watch the UiPath agent reason, fetch repository structures, and generate YAML pipelines.',
  },
  {
    number: '04',
    title: 'Merge the PR',
    description: 'Review the Pull Request opened by our agent and merge it into your main branch.',
  },
]

function SpotlightListItem({ step, index }: { step: Step; index: number }) {
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)

  function handleMouseMove({ currentTarget, clientX, clientY }: MouseEvent) {
    const { left, top } = currentTarget.getBoundingClientRect()
    mouseX.set(clientX - left)
    mouseY.set(clientY - top)
  }

  return (
    <motion.li
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="group relative border-t border-white/10 bg-white/5 backdrop-blur-xl overflow-hidden transition-colors hover:bg-white/10"
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

      <div className="relative z-10 grid py-8 md:grid-cols-12 md:gap-8 px-4 md:px-8">
        <div className="mb-4 md:col-span-2 md:mb-0">
          <span className="font-mono text-sm text-neutral-500 group-hover:text-white transition-colors">
            {step.number}
          </span>
        </div>

        <div className="md:col-span-4">
          <h3 className="text-xl font-semibold text-white transition-colors duration-300 group-hover:text-neutral-200 md:text-2xl">
            {step.title}
          </h3>
        </div>

        <div className="mt-2 md:col-span-6 md:mt-0">
          <p className="text-neutral-400 group-hover:text-neutral-300 transition-colors">
            {step.description}
          </p>
        </div>
      </div>
    </motion.li>
  )
}

export function GettingStarted() {
  return (
    <section className="relative z-[1] bg-transparent py-24 md:py-32">
      <BackgroundGrid
        gridLineStyles={{
          0: {
            background:
              'linear-gradient(to bottom, var(--grid-line-dark) 0px, transparent 20rem, transparent calc(100% - 20rem), var(--grid-line-dark) 100%)',
          },
          1: {
            background:
              'linear-gradient(to bottom, var(--grid-line-dark) 0px, transparent 10rem, transparent calc(100% - 10rem), var(--grid-line-dark) 100%)',
          },
          2: {
            background:
              'linear-gradient(to bottom, var(--grid-line-dark) 0px, transparent 5rem, transparent calc(100% - 5rem), var(--grid-line-dark) 100%)',
          },
          3: {
            background:
              'linear-gradient(to bottom, var(--grid-line-dark) 0px, transparent 10rem, transparent calc(100% - 10rem), var(--grid-line-dark) 100%)',
          },
          4: {
            background:
              'linear-gradient(to bottom, var(--grid-line-dark) 0px, transparent 20rem, transparent calc(100% - 20rem), var(--grid-line-dark) 100%)',
          },
        }}
        zIndex={0}
      />

      <Gutter>
        <motion.div
          className="mb-16 max-w-2xl"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-white md:text-4xl lg:text-5xl">
            Get started in minutes
          </h2>
          <p className="text-lg text-neutral-400">
            From sign-up to a merged Pull Request, completely redefining pipeline generation.
          </p>
        </motion.div>

        <ul className="relative border-b border-white/10">
          {steps.map((step, index) => (
            <SpotlightListItem key={index} step={step} index={index} />
          ))}
        </ul>
      </Gutter>
    </section>
  )
}
