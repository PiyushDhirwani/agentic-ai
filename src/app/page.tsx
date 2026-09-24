import { Chat } from "@/components/Chat";
import { env } from "@/config/env";
import { getCatalogue } from "@/server/services/models.service";

export const dynamic = "force-dynamic";

/**
 * A new, unsaved chat. As soon as the first turn creates a conversation the
 * URL becomes /c/<id>, so the tab can be shared or reopened.
 */
export default async function Page() {
  const { options, defaultModel } = await getCatalogue();
  return (
    <Chat
      models={options}
      defaultModel={defaultModel}
      webSearchAvailable={env.webSearch.available}
      webSearchDefault={env.webSearch.defaultOn}
    />
  );
}
