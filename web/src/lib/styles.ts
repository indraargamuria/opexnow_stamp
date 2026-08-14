import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Animation utilities
export const animations = {
  "slide-in-right": "animate-in slide-in-from-right duration-300",
  "slide-in-left": "animate-in slide-in-from-left duration-300",
  "fade-in": "animate-in fade-in duration-200",
  "scale-in": "animate-in scale-in duration-200",
  "spin": "animate-spin",
} as const

// Layout utilities
export const layouts = {
  container: "max-w-container mx-auto px-4 sm:px-6 lg:px-8",
  sidebar: "w-sidebar",
  header: "h-header",
} as const

// Common component patterns
export const components = {
  card: "rounded-lg border bg-card text-card-foreground shadow-sm",
  "card-header": "flex flex-col space-y-1.5 p-6",
  "card-title": "font-semibold leading-none tracking-tight",
  "card-description": "text-sm text-muted-foreground",
  "card-content": "p-6 pt-0",
  "card-footer": "flex items-center p-6 pt-0",

  button: {
    base: "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
    variants: {
      default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
      destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
      outline: "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
      secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
      ghost: "hover:bg-accent hover:text-accent-foreground",
      link: "text-primary underline-offset-4 hover:underline",
    },
    sizes: {
      default: "h-9 px-4 py-2",
      sm: "h-8 rounded-md px-3 text-xs",
      lg: "h-10 rounded-md px-8",
      icon: "h-9 w-9",
    },
  },

  input: "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",

  badge: "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",

  table: "w-full caption-bottom text-sm",
  "table-header": "flex h-10 items-center border-b px-2",
  "table-row": "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
  "table-head": "h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",

  alert: "relative w-full rounded-lg border p-4",
  "alert-title": "mb-1 font-medium leading-none tracking-tight",

  dialog: "fixed left-[50%] top-[50%] z-50 grid w-full max-w-dialog translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 sm:rounded-lg",
} as const

// Status utilities
export const statuses = {
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  error: "bg-destructive/10 text-destructive border-destructive/20",
  info: "bg-info/10 text-info border-info/20",
} as const

// Spacing utilities
export const spacing = {
  page: "container py-8",
  section: "py-12",
  item: "space-y-4",
} as const
