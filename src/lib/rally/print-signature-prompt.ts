import type { PrintSignature } from "./print-signature";

export type PrintSignaturePromptResult =
  | { action: "sign"; signature: PrintSignature }
  | { action: "skip" }
  | { action: "cancel" };

type PromptListener = (open: boolean) => void;

let resolver: ((value: PrintSignaturePromptResult) => void) | null = null;
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
 * - sign: Yes — print with signature footer
 * - skip: No — print without signature
 * - cancel: Esc / click outside — do not print
 */
export function promptPrintSignature(): Promise<PrintSignaturePromptResult> {
  if (typeof window === "undefined") {
    return Promise.resolve({ action: "cancel" });
  }
  if (resolver) {
    // Replace any stalled prompt so a new Print click is not blocked.
    resolver({ action: "cancel" });
    resolver = null;
  }
  return new Promise((resolve) => {
    resolver = resolve;
    notify(true);
    if (listeners.size === 0) {
      window.setTimeout(() => {
        if (resolver === resolve) {
          resolver = null;
          resolve({ action: "cancel" });
        }
      }, 0);
    }
  });
}

export function resolvePrintSignaturePrompt(
  value: PrintSignaturePromptResult,
): void {
  const r = resolver;
  resolver = null;
  notify(false);
  r?.(value);
}
