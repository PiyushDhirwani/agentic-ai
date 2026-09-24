import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chat } from "@/components/Chat";
import { toUiMessages } from "@/components/view-models";
import { conversations, messages } from "@/server/db";
import { env } from "@/config/env";
import { getCatalogue } from "@/server/services/models.service";
import { conversationIdSchema } from "@/validation/schemas";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

/** Named after the conversation, so a shared link reads well in a tab. */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const parsed = conversationIdSchema.safeParse(id);
  if (!parsed.success) return {};
  const conversation = await conversations.findById(parsed.data).catch(() => null);
  return conversation?.title ? { title: conversation.title } : {};
}

/**
 * A conversation at its own URL, rendered on the server. Opening or sharing
 * the link gives the full transcript on first paint, with no client fetch.
 */
export default async function ConversationPage({ params }: PageProps) {
  const { id } = await params;

  const parsed = conversationIdSchema.safeParse(id);
  if (!parsed.success) notFound();

  const conversation = await conversations.findById(parsed.data);
  if (!conversation) notFound();

  const [transcript, catalogue] = await Promise.all([
    messages.findAll(conversation.id),
    getCatalogue(),
  ]);

  return (
    // Keyed so switching conversations resets the thread rather than merging.
    <Chat
      key={conversation.id}
      models={catalogue.options}
      defaultModel={conversation.model ?? catalogue.defaultModel}
      conversationId={conversation.id}
      initialMessages={toUiMessages(transcript)}
      webSearchAvailable={env.webSearch.available}
      webSearchDefault={env.webSearch.defaultOn}
    />
  );
}
