import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = { userId: string };

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getCurrentUserId(): string {
  return requestContext.getStore()?.userId ?? "local";
}

export function runWithUser<T>(userId: string, fn: () => T): T {
  return requestContext.run({ userId }, fn);
}

export function extractUserIdFromHeaders(headers: Record<string, any>, bodyUserId?: string): string {
  // Express lowercases all header names, so check lowercase only.
  const h = (name: string) => {
    const v = headers[name.toLowerCase()];
    return typeof v === "string" ? v.trim() : "";
  };
  return (
    h("x-user-id") ||
    h("x-openwebui-user") ||
    h("x-openwebui-user-email") ||
    h("x-user-email") ||
    h("x-user") ||
    (typeof bodyUserId === "string" ? bodyUserId.trim() : "") ||
    "anonymous"
  );
}
