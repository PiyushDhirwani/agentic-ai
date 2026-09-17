import { Chat } from "@/components/Chat";
import { env } from "@/config/env";

export const dynamic = "force-dynamic";

/**
 * Server component. The model list is read from env here and passed down as a
 * prop — no NEXT_PUBLIC_ variable, so nothing about the configuration is
 * inlined into the browser bundle.
 */
export default function Page() {
  const models = [...new Set([env.openRouter.primaryModel, ...env.openRouter.fallbackModels])];
  return <Chat models={models} />;
}
