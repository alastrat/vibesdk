import { createPortal } from "react-dom"
import { useTheme } from "@/contexts/theme-context"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// #root is its own stacking context, so toasts render in the body to stay above portaled dialogs.
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme()

  if (typeof document === "undefined") return null

  return createPortal(
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />,
    document.body,
  )
}

export { Toaster }
