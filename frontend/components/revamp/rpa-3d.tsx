'use client'

import type { CSSProperties } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export function PaperPilot3D() {
  const containerRef = useRef<HTMLDivElement>(null)
  const defaultStyles = {
    '--mouse-x': 0,
    '--mouse-y': 0,
  } as CSSProperties
  const [gradientStyles, setGradientStyle] = useState<CSSProperties>(defaultStyles)

  useEffect(() => {
    let intersectionObserver: IntersectionObserver
    let scheduledAnimationFrame = false

    const updateMousePosition = (e: MouseEvent) => {
      if (containerRef.current) {
        const boundingRect = containerRef.current.getBoundingClientRect()
        const x = e.clientX - boundingRect.left
        const y = e.clientY - boundingRect.top

        const styles = {
          '--mouse-x': x,
          '--mouse-y': y,
        } as CSSProperties

        setGradientStyle(styles)
      }
      scheduledAnimationFrame = false
    }

    const handleMouseMovement = (e: MouseEvent) => {
      if (scheduledAnimationFrame) {
        return
      }

      scheduledAnimationFrame = true
      requestAnimationFrame(function () {
        updateMousePosition(e)
      })
    }

    if (containerRef.current) {
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              window.addEventListener('mousemove', handleMouseMovement)
            } else {
              window.removeEventListener('mousemove', handleMouseMovement)
            }
          })
        },
        {
          rootMargin: '0px',
        }
      )

      intersectionObserver.observe(containerRef.current)
    }

    return () => {
      if (intersectionObserver) {
        intersectionObserver.disconnect()
      }
      window.removeEventListener('mousemove', handleMouseMovement)
    }
  }, [])

  return (
    <div
      className={cn(
        'relative pt-16',
        'mb-[-14.5rem]',
        'md:mb-[-12rem]',
        'sm:mb-[-10rem] sm:pointer-events-none'
      )}
      data-theme="dark"
      ref={containerRef}
    >
      <div
        className={cn('w-full bg-black relative', 'transition-all duration-1000', 'origin-bottom')}
        style={{
          aspectRatio: '1600/436',
          maskImage: 'url(/images/video-mind-mask.svg)',
          WebkitMaskImage: 'url(/images/video-mind-mask.svg)',
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
          maskPosition: 'center',
          WebkitMaskPosition: 'center',
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          imageRendering: 'crisp-edges',
        }}
      >
        <div
          className="absolute inset-0 z-[5]"
          style={{
            backgroundImage: 'url(/images/noise.png)',
            backgroundRepeat: 'repeat',
          }}
          aria-hidden="true"
        />

        <div
          className={cn(
            'absolute rounded-full',
            'w-[70rem] h-[70rem]',
            'md:w-[35rem] md:h-[35rem]',
            'blur-[100px]',
            'transition-opacity duration-1000'
          )}
          style={
            {
              ...gradientStyles,
              transform: `translate3d(calc(var(--mouse-x, -100%) * 1px - 35rem), calc(var(--mouse-y, -100%) * 1px - 35rem), 0px)`,
              background:
                'radial-gradient(circle at center, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0))',
            } as CSSProperties
          }
        />
      </div>
    </div>
  )
}
