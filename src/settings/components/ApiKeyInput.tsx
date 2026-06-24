import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ViewIcon, ViewOffSlashIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState, type ComponentProps } from "react";

type ApiKeyInputProps = Omit<ComponentProps<typeof Input>, "type"> & {
  /** 是否默认显示明文，默认 false（掩码）。 */
  defaultReveal?: boolean;
};

/**
 * 密钥输入框：默认掩码显示，点击右侧眼睛图标切换明文/掩码。
 * 透传其余 Input 属性（value / onChange / placeholder / className 等）。
 */
export function ApiKeyInput({
  className,
  defaultReveal = false,
  ...props
}: ApiKeyInputProps) {
  const [reveal, setReveal] = useState(defaultReveal);

  return (
    <div className="relative">
      <Input
        type={reveal ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        className={cn("pr-8 font-mono", className)}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setReveal((value) => !value)}
        className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground/60 transition-colors hover:text-foreground"
        aria-label={reveal ? "隐藏密钥" : "显示密钥"}
      >
        <HugeiconsIcon
          icon={reveal ? ViewOffSlashIcon : ViewIcon}
          size={12}
          strokeWidth={1.75}
        />
      </button>
    </div>
  );
}
