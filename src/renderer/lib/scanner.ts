// Barcode scanner as a keyboard (PRD §8.3): a scanner "types" a code much faster than a person
// and ends with Enter. useScanner() catches such bursts anywhere on the page; when the burst went
// into some other text field, that field gets its old value back (the scan must not end up typed
// into, say, the price box).
import { useEffect, useRef } from 'react';

export interface ScannerOptions {
  /** Max pause between two characters of one scan (ms). Settings may tune it later. */
  maxGapMs?: number;
  minLength?: number;
  /** Elements that read scans themselves (the cashier's scan box): bursts there are left alone. */
  ignore?: (el: Element | null) => boolean;
  enabled?: boolean;
}

type Field = HTMLInputElement | HTMLTextAreaElement;
const isField = (el: Element | null): el is Field =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

/** Pure burst detector — exported for tests. */
export function createScanDetector(maxGapMs: number, minLength: number) {
  let buf = '';
  let last = 0;
  return {
    /** Feed one key; returns the code when Enter closes a fast-enough burst. */
    key(key: string, at: number): string | null {
      if (key === 'Enter') {
        const code = buf;
        buf = '';
        return code.length >= minLength && at - last <= maxGapMs * 3 ? code : null;
      }
      if (key.length !== 1) return null;
      buf = at - last > maxGapMs ? key : buf + key;
      last = at;
      return null;
    },
    /** True while the current burst is still a candidate scan. */
    get pending() {
      return buf.length > 0;
    },
  };
}

export function useScanner(onScan: (code: string) => void, opts: ScannerOptions = {}): void {
  const { maxGapMs = 35, minLength = 4, ignore, enabled = true } = opts;
  const cb = useRef(onScan);
  useEffect(() => {
    cb.current = onScan;
  });
  useEffect(() => {
    if (!enabled) return;
    const detector = createScanDetector(maxGapMs, minLength);
    let snapshot: { el: Field; value: string } | null = null;
    let lastAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const el = document.activeElement;
      if (ignore?.(el)) return;
      const now = e.timeStamp || performance.now();
      if (e.key.length === 1 && (now - lastAt > maxGapMs || !detector.pending)) {
        snapshot = isField(el) ? { el, value: el.value } : null;
      }
      if (e.key.length === 1) lastAt = now;
      const code = detector.key(e.key, now);
      if (code) {
        e.preventDefault();
        e.stopPropagation();
        if (snapshot) {
          // Undo the burst in that field, through the native setter so React sees the change.
          const proto = snapshot.el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
          Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(snapshot.el, snapshot.value);
          snapshot.el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        snapshot = null;
        cb.current(code);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [maxGapMs, minLength, ignore, enabled]);
}
