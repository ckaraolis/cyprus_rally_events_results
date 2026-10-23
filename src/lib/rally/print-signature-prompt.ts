import type { PrintSignature } from "./print-signature";

export type PrintSignaturePromptResult =
  | { action: "sign"; signature: PrintSignature; subject: string }
  | { action: "skip"; subject: string }
  | { action: "cancel" };

export type PrintSignaturePromptOptions = {
  /** Prefilled sheet title shown at the top of the PDF (editable). */
  defaultSubject?: string;
};

type PromptListener = (open: boolean, options: PrintSignaturePromptOptions) => void;

let resolver: ((value: PrintSignaturePromptResult) => void) | null = null;
let currentOptions: PrintSignaturePromptOptions = {};
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
  listeners.forEach((l) => l(open, currentOptions));
}

/**
 * Opens the print dialog (must have PrintSignatureHost mounted).
 * - sign: Yes — print with signature footer + subject
 * - skip: No — print without signature, still with subject
 * - cancel: Esc / click outside — do not print
 */
export function promptPrintSignature(
  options: PrintSignaturePromptOptions = {},
): Promise<PrintSignaturePromptResult> {
  if (typeof window === "undefined") {
    return Promise.resolve({ action: "cancel" });
  }
  if (resolver) {
    // Replace any stalled prompt so a new Print click is not blocked.
    resolver({ action: "cancel" });
    resolver = null;
  }
  currentOptions = options;
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
  currentOptions = {};
  notify(false);
  r?.(value);
}
