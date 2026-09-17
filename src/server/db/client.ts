import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { env } from "@/config/env";

let client: NeonQueryFunction<false, false> | null = null;

/** Lazily created so importing a repository never requires DATABASE_URL. */
export function sql(): NeonQueryFunction<false, false> {
  if (!client) client = neon(env.database.url);
  return client;
}
