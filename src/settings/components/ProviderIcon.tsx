import type { ProviderId } from "@/modules/ai/config";
import { cn } from "@/lib/utils";

// @lobehub/icons 提供的 AI 模型图标
import { DeepSeek } from "@lobehub/icons";
import { Zhipu } from "@lobehub/icons";
import { Minimax } from "@lobehub/icons";
import { Kimi } from "@lobehub/icons";
import { XiaomiMiMo } from "@lobehub/icons";
import { OpenAI } from "@lobehub/icons";

// 图标映射
const ICON_MAP: Record<ProviderId, React.ComponentType<{ size?: number; className?: string }>> = {
  // 国产模型服务商
  deepseek: DeepSeek,
  zhipu: Zhipu,
  minimax: Minimax,
  kimi: Kimi,
  xiaomimimo: XiaomiMiMo,
  // 兼容服务商
  "openai-compatible": OpenAI,
};

type Props = {
  provider: ProviderId;
  size?: number;
  className?: string;
};

export function ProviderIcon({ provider, size = 14, className }: Props) {
  const IconComponent = ICON_MAP[provider];
  if (!IconComponent) return null;

  return (
    <IconComponent
      size={size}
      className={cn("inline-block", className)}
    />
  );
}
