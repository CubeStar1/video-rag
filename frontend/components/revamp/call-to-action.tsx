'use client'

import { cn } from '@/lib/utils'
import { motion, useMotionTemplate, useMotionValue } from 'framer-motion'
import React, { MouseEvent } from 'react'
import { BackgroundGrid } from './background-grid'
import { Gutter } from './gutter'
import { SlideUpLink } from './slide-up-link'

export function CallToAction() {
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)

  function handleMouseMove({ currentTarget, clientX, clientY }: MouseEvent) {
    const { left, top } = currentTarget.getBoundingClientRect()
    mouseX.set(clientX - left)
    mouseY.set(clientY - top)
  }

  return (
    <section className="relative z-[1] bg-transparent py-24 md:py-32">
      <BackgroundGrid zIndex={0} />

      <Gutter>
        <motion.div
          className="group relative grid gap-px overflow-hidden backdrop-blur-xl border border-white/10 md:grid-cols-2"
          onMouseMove={handleMouseMove}
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
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

          <div className="relative z-10 flex flex-col justify-center gap-6 p-8 md:p-16">
            <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl lg:text-5xl">
              Stop scrubbing. Start asking.
            </h2>
            <p className="text-neutral-400">
              Upload your first video and find the moment you need in seconds — no more dragging the playhead hoping to land on it.
            </p>
          </div>

          <div className="relative z-10 flex flex-col justify-center gap-px bg-white/5 border-l border-white/10">
            <SlideUpLink
              href="/projects"
              label="Upload a Video"
              variant="primary"
              size="lg"
              className="flex-1 hover:bg-white/5"
            />

            <div className="h-px w-full bg-white/10" />

            <SlideUpLink
              href="/architecture"
              label="Explore the Architecture"
              variant="primary"
              size="lg"
              className="flex-1 hover:bg-white/5"
            />
          </div>
        </motion.div>
      </Gutter>
    </section>
  )
}
