// Adapted from Magic UI (MIT, see ./LICENSE.md), commit 85f97fd.
import React, { useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef } from "react"
import { AnimatePresence, motion, useInView, useReducedMotion, type MotionProps } from "framer-motion"

import { cn } from "@/lib/utils"
import { visibleListItems } from "./visible-list-items"

export function AnimatedListItem({ children }: { children: React.ReactNode }) {
  const animations: MotionProps = {
    initial: { scale: 0, opacity: 0 },
    animate: { scale: 1, opacity: 1, originY: 0 },
    exit: { scale: 0, opacity: 0 },
    transition: { type: "spring", stiffness: 350, damping: 40 },
  }

  return (
    <motion.div {...animations} layout className="mx-auto w-full">
      {children}
    </motion.div>
  )
}

export interface AnimatedListProps extends ComponentPropsWithoutRef<"div"> {
  children: React.ReactNode
  /** Milliseconds between arrivals. */
  delay?: number
  /** Show each new item on top (Magic UI's default) or below the earlier ones. */
  newestFirst?: boolean
}

/** Reveals its children one at a time once on screen; with reduced motion they all show at once. */
export const AnimatedList = React.memo(
  ({ children, className, delay = 1000, newestFirst = true, ...props }: AnimatedListProps) => {
    const ref = useRef<HTMLDivElement>(null)
    const onScreen = useInView(ref, { once: true })
    const reduceMotion = useReducedMotion()
    const childrenArray = useMemo(() => React.Children.toArray(children), [children])
    const [shown, setShown] = useState(1)

    useEffect(() => {
      if (!onScreen || reduceMotion || shown >= childrenArray.length) return
      const timeout = setTimeout(() => setShown((count) => count + 1), delay)
      return () => clearTimeout(timeout)
    }, [onScreen, reduceMotion, shown, delay, childrenArray.length])

    const items = visibleListItems(childrenArray, reduceMotion ? childrenArray.length : shown, newestFirst)

    return (
      <div ref={ref} className={cn("flex flex-col items-center gap-4", className)} {...props}>
        {reduceMotion ? (
          items
        ) : (
          <AnimatePresence>
            {items.map((item) => (
              <AnimatedListItem key={(item as React.ReactElement).key}>{item}</AnimatedListItem>
            ))}
          </AnimatePresence>
        )}
      </div>
    )
  }
)

AnimatedList.displayName = "AnimatedList"
