import type { Transition, Variants } from 'framer-motion'

/**
 * Centralized motion presets so every animated surface shares one feel.
 * Keep durations short and springs gentle - this is a dense operator console,
 * not a marketing page. All consumers should respect reduced-motion (see the
 * `prefers-reduced-motion` guard in globals.css and `useReducedMotion` usage).
 */

export const spring: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 32,
  mass: 0.8
}

export const softSpring: Transition = {
  type: 'spring',
  stiffness: 260,
  damping: 26
}

export const ease: Transition = {
  duration: 0.32,
  ease: [0.22, 1, 0.36, 1]
}

/** Container that staggers its children on mount. */
export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.04 }
  }
}

/** Standard entrance: rise + fade. Pairs with `staggerContainer`. */
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: ease }
}

/** Subtle scale-in for cards and panels. */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.97 },
  show: { opacity: 1, scale: 1, transition: ease }
}

/** List row entrance/exit, used inside AnimatePresence for live streams. */
export const listItem: Variants = {
  hidden: { opacity: 0, y: -6 },
  show: { opacity: 1, y: 0, transition: ease },
  exit: { opacity: 0, transition: { duration: 0.15 } }
}

/** Page-level transition for route changes. */
export const pageTransition: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.18, ease: 'easeIn' } }
}

/** Hover/press feedback shared by interactive cards. */
export const hoverLift = {
  whileHover: { y: -3 },
  whileTap: { scale: 0.99 },
  transition: spring
}
