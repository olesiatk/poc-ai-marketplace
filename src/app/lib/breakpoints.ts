import { DestroyRef, inject, signal, type Signal } from "@angular/core";

export interface Breakpoint<T> {
  minWidth: number;
  value: T;
}

function hasMatchMedia(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

/**
 * A signal of `table`'s value for the current viewport width — the first
 * (widest) entry whose `minWidth` matches, else `narrowest`. Updates live on
 * resize. Inside an <iframe> this is the iframe's own width, not the host
 * page's. Where matchMedia doesn't exist (jsdom in unit tests) it's fixed
 * at `fallback`.
 *
 * Must be called in an injection context (it cleans up its listeners via
 * DestroyRef). Layout that has to agree with a computed page size should be
 * driven from this signal too, rather than from parallel CSS breakpoints.
 */
export function breakpointSignal<T>(table: readonly Breakpoint<T>[], narrowest: T, fallback: T): Signal<T> {
  if (!hasMatchMedia()) return signal(fallback).asReadonly();

  const queries = table.map((bp) => ({ value: bp.value, mql: window.matchMedia(`(min-width: ${bp.minWidth}px)`) }));
  const read = () => queries.find((q) => q.mql.matches)?.value ?? narrowest;
  const current = signal(read());
  const update = () => current.set(read());
  queries.forEach((q) => q.mql.addEventListener("change", update));
  inject(DestroyRef).onDestroy(() => queries.forEach((q) => q.mql.removeEventListener("change", update)));
  return current.asReadonly();
}
