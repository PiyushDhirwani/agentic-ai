/** A source the model cited, from OpenRouter's `url_citation` annotations. */
export interface Citation {
  url: string;
  title: string | null;
  /** Excerpt the model was shown, when the provider returns one. */
  content?: string | null;
}

/** Normalises OpenRouter's annotation array into plain citations. */
export function toCitations(annotations: unknown): Citation[] {
  if (!Array.isArray(annotations)) return [];

  const citations: Citation[] = [];
  for (const annotation of annotations) {
    if (!annotation || typeof annotation !== "object") continue;
    const entry = annotation as Record<string, any>;
    if (entry.type !== "url_citation") continue;

    const source = entry.url_citation;
    if (!source?.url) continue;

    citations.push({
      url: String(source.url),
      title: source.title ? String(source.title) : null,
      content: source.content ? String(source.content) : null,
    });
  }
  return citations;
}

/** Merges citations, keeping first-seen order and dropping duplicate URLs. */
export function mergeCitations(existing: Citation[], incoming: Citation[]): Citation[] {
  const seen = new Set(existing.map((citation) => citation.url));
  const merged = [...existing];
  for (const citation of incoming) {
    if (seen.has(citation.url)) continue;
    seen.add(citation.url);
    merged.push(citation);
  }
  return merged;
}
