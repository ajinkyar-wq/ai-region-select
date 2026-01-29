import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

const SliderVertical = React.forwardRef<
    React.ElementRef<typeof SliderPrimitive.Root>,
    React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
    <SliderPrimitive.Root
        ref={ref}
        className={cn(
            "relative flex w-full touch-none select-none items-center py-2", // Added py-2 for touch target
            className
        )}
        {...props}
    >
        <SliderPrimitive.Track className="relative h-[2px] w-full grow overflow-hidden rounded-full bg-[#3F3F46]">
            <SliderPrimitive.Range className="absolute h-full bg-[#A1A1AA]" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
            className="block h-3 w-[2px] bg-[#E4E4E7] ring-offset-background transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 shadow-sm"
        />
    </SliderPrimitive.Root>
))
SliderVertical.displayName = SliderPrimitive.Root.displayName

export { SliderVertical }
