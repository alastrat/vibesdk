// Adapted from Magic UI (MIT, see ./LICENSE.md), commit 85f97fd.
import { useEffect, useRef, type ComponentPropsWithoutRef } from "react"
import { useInView, useMotionValue, useReducedMotion, useSpring } from "framer-motion"

import { cn } from "@/lib/utils"

interface NumberTickerProps extends ComponentPropsWithoutRef<"span"> {
  value: number
  startValue?: number
  direction?: "up" | "down"
  delay?: number
  decimalPlaces?: number
}

function formatNumber(value: number, decimalPlaces: number): string {
  return Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  }).format(Number(value.toFixed(decimalPlaces)))
}

/** Counts to `value` when it scrolls into view; with reduced motion it shows `value` straight away. */
export function NumberTicker({
  value,
  startValue = 0,
  direction = "up",
  delay = 0,
  className,
  decimalPlaces = 0,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduceMotion = useReducedMotion()
  const motionValue = useMotionValue(direction === "down" ? value : startValue)
  const springValue = useSpring(motionValue, { damping: 60, stiffness: 100 })
  const isInView = useInView(ref, { once: true, margin: "0px" })
  const target = direction === "down" ? startValue : value

  useEffect(() => {
    if (!isInView || reduceMotion) return
    const timer = setTimeout(() => motionValue.set(target), delay * 1000)
    return () => clearTimeout(timer)
  }, [motionValue, isInView, reduceMotion, delay, target])

  useEffect(
    () =>
      springValue.on("change", (latest) => {
        if (ref.current) ref.current.textContent = formatNumber(latest, decimalPlaces)
      }),
    [springValue, decimalPlaces]
  )

  return (
    <span ref={ref} className={cn("inline-block tabular-nums", className)} {...props}>
      {formatNumber(reduceMotion ? target : direction === "down" ? value : startValue, decimalPlaces)}
    </span>
  )
}
