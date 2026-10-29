// "Focus returns to the scan box after every action" (golden rule 10) — one place to do it.
let scanBox: HTMLInputElement | null = null;

export function registerScanBox(el: HTMLInputElement | null): void {
  scanBox = el;
}

export const isScanBox = (el: Element | null): boolean => el !== null && el === scanBox;

/**
 * Next frame, so it also works right after a dialog unmounts. Never while another dialog is open:
 * a closing dialog must not steal the focus of the one that replaced it (Bayar → Selesai,
 * Riwayat → Batal).
 */
export function focusScan(): void {
  requestAnimationFrame(() => {
    if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
    scanBox?.focus();
  });
}

/** Short low tone for "barang tidak ditemukan" (design-standards §3); silent if audio is unavailable. */
export function beepError(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 220;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => void ctx.close();
  } catch {
    // no audio device — the red notice still shows
  }
}
