import Link from "next/link";
import { ROUTES } from "@/config/constants";

/** Shown when a shared conversation link points at something deleted. */
export default function NotFound() {
  return (
    <main className="empty">
      <h1>Conversation not found</h1>
      <p>This chat may have been deleted, or the link may be incomplete.</p>
      <p style={{ marginTop: 20 }}>
        <Link href={ROUTES.newChat}>Start a new chat</Link>
      </p>
    </main>
  );
}
