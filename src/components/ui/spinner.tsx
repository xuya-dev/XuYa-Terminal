import { cn } from "@/lib/utils";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <HugeiconsIcon
      icon={Loading03Icon}
      // @ts-ignore
      strokeWidth={2}
      role="status"
      aria-label="加载中"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
