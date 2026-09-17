import { NextResponse } from "next/server";
import type { ZodError } from "zod";

/** JSON helpers shared by every route handler. */

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function error(message: string, status = 400, extra?: Record<string, unknown>): NextResponse {
  return json({ error: message, ...extra }, status);
}

export function validationError(err: ZodError): NextResponse {
  return error("Invalid request", 422, { details: err.issues });
}

/** Reads a JSON body, returning undefined rather than throwing on bad input. */
export async function readJson(request: Request): Promise<unknown | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
