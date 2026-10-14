// Adapted from Magic UI (MIT, see ./LICENSE.md), commit 85f97fd.
import { useRef, type ComponentPropsWithoutRef } from "react"
import { useInView } from "framer-motion"

import { cn } from "@/lib/utils"

interface MarqueeProps extends ComponentPropsWithoutRef<"div"> {
  className?: string
  /** Scroll the other way. */
  reverse?: boolean
  /** Pause while hovered; it also pauses while a child has keyboard focus. */
  pauseOnHover?: boolean
  children: React.ReactNode
  vertical?: boolean
  /** Copies of the children laid end to end, so the loop never shows a gap. */
  repeat?: number
}

/**
 * Scrolls its children in a loop. Only the first copy reaches assistive
 * technology and the keyboard. Off screen it pauses; with reduced motion it
 * stands still and scrolls by hand instead.
 */
export function Marquee({
  className,
  reverse = false,
  pauseOnHover = false,
  children,
  vertical = false,
  repeat = 4,
  ...props
}: MarqueeProps) {
  const ref = useRef<HTMLDivElement>(null)
  const onScreen = useInView(ref)

  return (
    <div
      ref={ref}
      {...props}
      data-offscreen={onScreen ? undefined : ""}
      className={cn(
        "group flex gap-(--gap) overflow-hidden p-2 [--duration:40s] [--gap:1rem] motion-reduce:overflow-x-auto",
        {
          "flex-row": !vertical,
          "flex-col": vertical,
        },
        className
      )}
    >
      {Array.from({ length: repeat }, (_, i) => (
        <div
          key={i}
          aria-hidden={i > 0 || undefined}
          inert={i > 0 || undefined}
          className={cn(
            "flex shrink-0 justify-around gap-(--gap) group-data-[offscreen]:[animation-play-state:paused] motion-reduce:animate-none",
            {
              "animate-marquee flex-row": !vertical,
              "animate-marquee-vertical flex-col": vertical,
              "group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]": pauseOnHover,
              "[animation-direction:reverse]": reverse,
              "motion-reduce:hidden": i > 0,
            }
          )}
        >
          {children}
        </div>
      ))}
    </div>
  )
}
