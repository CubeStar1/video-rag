'use client'

import { cn } from '@/lib/utils'
import React, { Suspense } from 'react'

interface BackgroundGradientProps {
  className?: string
}

export function BackgroundGradient({ className }: BackgroundGradientProps) {
  return (
    <div
      className={cn('pointer-events-none fixed inset-0 z-0 overflow-hidden', 'bg-black', className)}
      style={{ maxHeight: '100vh' }}
    >
      <Suspense fallback={null}>
        <video
          autoPlay
          loop
          muted
          playsInline
          className={cn(
            'h-full w-full object-cover',
            'opacity-0 animate-[fadeIn_2s_ease-in-out_forwards]'
          )}
          src="https://l4wlsi8vxy8hre4v.public.blob.vercel-storage.com/video/glass-animation-5-f0gPcjmKFIV3ot5MGOdNy2r4QHBoXt.mp4"
        />
      </Suspense>

      <div
        className="absolute inset-0 z-[1] mix-blend-multiply"
        style={{
          backgroundImage: 'url(/crt.gif)',
          backgroundRepeat: 'repeat',
          backgroundSize: '256px',
          backgroundPosition: 'center center',
        }}
        aria-hidden="true"
      />

      <div
        className="absolute inset-0"
        style={{
          boxShadow: 'inset 0 100px 120px 100px rgb(0, 0, 0)',
        }}
        aria-hidden="true"
      />
    </div>
  )
}
