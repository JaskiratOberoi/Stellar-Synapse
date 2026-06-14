import { useEffect, useRef } from 'react'
import { animate, useMotionValue, useReducedMotion } from 'framer-motion'

interface AnimatedNumberProps {
  value: number
  /** Decimal places to render. Defaults to 0 (integers). */
  decimals?: number
  className?: string
}

/**
 * Smoothly counts from the previous value to the next whenever `value` changes.
 * Falls back to an instant set when the user prefers reduced motion.
 */
export function AnimatedNumber({ value, decimals = 0, className }: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const motionValue = useMotionValue(0)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const format = (n: number): string =>
      n.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      })

    if (reduceMotion) {
      motionValue.set(value)
      node.textContent = format(value)
      return
    }

    const controls = animate(motionValue, value, {
      duration: 0.7,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        node.textContent = format(latest)
      }
    })
    return () => controls.stop()
  }, [value, decimals, motionValue, reduceMotion])

  return <span ref={ref} className={className}>{value.toFixed(decimals)}</span>
}
