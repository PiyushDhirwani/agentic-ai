import { Chat } from "@/components/Chat";
import { env } from "@/config/env";

export const dynamic = "force-dynamic";

/**
 * Server component: the model list lives in env, so it is read here rather
 * than exposed through a NEXT_PUBLIC_ variable.
 */
export default function Page() {
  const models = [...new Set([env.openRouter.primaryModel, ...env.openRouter.fallbackModels])];
  return <Chat models={models} />;
}
