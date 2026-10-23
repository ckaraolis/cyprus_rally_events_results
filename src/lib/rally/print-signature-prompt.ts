import type { PrintSignature } from "./print-signature";

type PromptListener = (open: boolean) => void;

let resolver: ((value: PrintSignature | null) => void) | null = null;
const listeners = new Set<PromptListener>();

export function subscribePrintSignaturePrompt(
  listener: PromptListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isPrintSignaturePromptOpen(): boolean {
  return resolver != null;
}

function notify(open: boolean): void {
  listeners.forEach((l) => l(open));
}

/**
 * Opens the print signature dialog (must have PrintSignatureHost mounted).
 * Resolves with the signed values, or null if cancelled.
 */
export function promptPrintSignature(): Promise<PrintSignature | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }
  if (resolver) {
    // Replace any stalled prompt so a new Print click is not blocked.
    resolver(null);
    resolver = null;
  }
  return new Promise((resolve) => {
    resolver = resolve;
    notify(true);
    if (listeners.size === 0) {
      window.setTimeout(() => {
        if (resolver === resolve) {
          resolver = null;
          resolve(null);
        }
      }, 0);
    }
  });
}

export function resolvePrintSignaturePrompt(
  value: PrintSignature | null,
): void {
  const r = resolver;
  resolver = null;
  notify(false);
  r?.(value);
}
