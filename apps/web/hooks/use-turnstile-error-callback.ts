"use client";

import { useEffect, useId } from "react";

export const useTurnstileErrorCallback = () => {
  const callbackName = `turnstileError${useId().replaceAll(/\W/gu, "")}`;

  useEffect(() => {
    Object.defineProperty(window, callbackName, {
      configurable: true,
      value: (errorCode: string) => errorCode.startsWith("300") || errorCode.startsWith("600"),
    });

    return () => {
      Reflect.deleteProperty(window, callbackName);
    };
  }, [callbackName]);

  return callbackName;
};

/**
 * Cloudflare injects `window.turnstile` from the challenge script, which ships
 * no types. The cast lives here, beside the other code that reaches for
 * Turnstile globals, rather than in an ambient `.d.ts`: a global augmentation
 * only works while the declaration file stays in the TypeScript program, and
 * nothing fails loudly when it drops out.
 *
 * Tokens are single use, so a rejected submission has to hand the widget back
 * a fresh challenge before the visitor can retry.
 */
export const resetTurnstile = () => {
  (
    window as typeof window & {
      turnstile?: { reset: (widget?: string | HTMLElement) => void };
    }
  ).turnstile?.reset();
};
