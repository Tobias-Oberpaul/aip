import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import {cn} from '@/design-system/utils'

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger
const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & {container?: HTMLElement | null}
>(({className, container, sideOffset = 6, ...props}, ref) => (
  <TooltipPrimitive.Portal container={container}>
    <TooltipPrimitive.Content ref={ref} sideOffset={sideOffset}
      className={cn('z-50 max-w-xs rounded-md border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md', className)} {...props}/>
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = 'TooltipContent'
export {Tooltip, TooltipTrigger, TooltipContent, TooltipProvider}
