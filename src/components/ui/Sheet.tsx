import * as React from "react"
import { cn } from "cn"
import { Dialog as SheetPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/40 backdrop-blur-xs duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "bottom",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col bg-background/95 backdrop-blur-md text-foreground shadow-2xl transition duration-300 ease-out border-border",
          // bottom side (原本从下面升起，小屏全宽，大屏精致居中底部卡片)
          side === "bottom" &&
            "inset-x-0 bottom-0 h-[88vh] max-h-[88dvh] rounded-t-[28px] border-t mx-auto sm:max-w-2xl lg:max-w-3xl data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom",
          // right side
          side === "right" &&
            "inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-md lg:max-w-lg data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right",
          // left side
          side === "left" &&
            "inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-md data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left",
          // top side
          side === "top" &&
            "inset-x-0 top-0 h-auto border-b data-open:animate-in data-open:slide-in-from-top data-closed:animate-out data-closed:slide-out-to-top",
          className
        )}
        {...props}
      >
        {/* Luma 风格药丸把手 (仅在 bottom 模式渲染) */}
        {side === "bottom" && (
          <div className="mx-auto mt-2.5 mb-1 h-1.5 w-12 rounded-full bg-muted-foreground/20 shrink-0" />
        )}
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-4 right-4 bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground rounded-full size-8"
              size="icon"
            >
              <XIcon className="size-4" />
              <span className="sr-only">关闭</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 px-6 py-3 border-b border-border/40", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-6 border-t border-border/40", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-sans text-base font-semibold text-foreground tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export interface AdaptiveSheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  className?: string
  header?: React.ReactNode
  side?: "top" | "right" | "bottom" | "left"
}

export function AdaptiveSheet({
  open,
  onClose,
  title,
  children,
  className = "",
  header,
  side = "bottom", // 默认严格使用 bottom，还原原汁原味的底部升起抽屉！
}: AdaptiveSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen: boolean) => {
        if (!nextOpen) onClose()
      }}
    >
      <SheetContent
        side={side}
        className={cn(
          "flex flex-col p-0 transition-all duration-300",
          className
        )}
      >
        <SheetHeader className="px-6 py-3.5">
          <SheetTitle>
            {header ?? title}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
