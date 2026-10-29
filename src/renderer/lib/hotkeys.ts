// Keyboard shortcuts — defined ONCE here (frontend-standards §6, PRD §5.3). The F1 help dialog
// reads the same map, so what is shown is always what works.
import { useEffect, useRef } from 'react';

export interface Hotkey {
  /** Combo as matched against the event: "F9", "Ctrl+H", "Ctrl+Shift+L", "Delete", "ArrowUp". */
  combo: string;
  /** Shown on buttons and in the help ("Bayar  F9"). */
  label: string;
  /**
   * While a text field has focus: true = always (F-keys), 'empty' = only when the field is empty
   * (Delete/arrows from the empty scan box), false/absent = never (they must not steal typing).
   */
  inInput?: boolean | 'empty';
  /** Not built yet — listed in the help as "segera". */
  soon?: string;
}

export const POS_HOTKEYS = {
  help: { combo: 'F1', label: 'Bantuan shortcut', inInput: true },
  focusScan: { combo: 'F2', label: 'Ke kolom scan/cari', inInput: true },
  search: { combo: 'F3', label: 'Cari barang', inInput: true },
  unit: { combo: 'F4', label: 'Ganti satuan', inInput: true },
  qty: { combo: 'F5', label: 'Ubah jumlah', inInput: true },
  price: { combo: 'Ctrl+H', label: 'Ubah harga', inInput: true },
  hold: { combo: 'F6', label: 'Tahan nota', inInput: true },
  recall: { combo: 'F7', label: 'Ambil nota tertahan', inInput: true },
  customer: { combo: 'F8', label: 'Pilih pelanggan', inInput: true },
  pay: { combo: 'F9', label: 'Bayar', inInput: true },
  discount: { combo: 'F10', label: 'Potongan nota', inInput: true },
  removeLine: { combo: 'Delete', label: 'Hapus baris', inInput: 'empty' },
  up: { combo: 'ArrowUp', label: 'Baris sebelumnya', inInput: 'empty' },
  down: { combo: 'ArrowDown', label: 'Baris berikutnya', inInput: 'empty' },
  pickup: { combo: 'F11', label: 'Pengambilan barang', inInput: true },
  mode: { combo: 'Ctrl+M', label: 'Ganti Kasir / Faktur', inInput: true },
  charges: { combo: 'Ctrl+O', label: 'Ongkos angkut (faktur)', inInput: true },
  history: { combo: 'Ctrl+D', label: 'Nota hari ini (cetak ulang, batal)', inInput: true },
  receivable: { combo: 'Ctrl+B', label: 'Terima pembayaran piutang', inInput: true },
  reprint: { combo: 'Ctrl+P', label: 'Cetak ulang nota terakhir', inInput: true },
  lock: { combo: 'Ctrl+Shift+L', label: 'Kunci layar (keluar)', inInput: true },
} as const satisfies Record<string, Hotkey>;

export type PosAction = keyof typeof POS_HOTKEYS;

/** "Ctrl+Shift+L" for the event — modifiers in a fixed order, letters upper-cased. */
export function comboOf(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey'>): string {
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', key].filter(Boolean).join('+');
}

/** The focused text field, if any. */
function typingIn(el: Element | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (el instanceof HTMLTextAreaElement) return el;
  if (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(el.type)) return el;
  return null;
}

/**
 * Binds the given actions while `enabled` (pages turn it off while a dialog is open; the dialog
 * handles its own Esc/Enter). A field that handles a key itself calls preventDefault() first.
 */
export function useHotkeys<A extends string>(
  map: Record<A, Hotkey>,
  handlers: Partial<Record<A, () => void>>,
  enabled = true,
): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    if (!enabled) return;
    const byCombo = new Map<string, A>();
    for (const [action, hk] of Object.entries(map) as [A, Hotkey][]) byCombo.set(hk.combo, action);
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const action = byCombo.get(comboOf(e));
      if (!action) return;
      const hk = map[action];
      const field = typingIn(document.activeElement);
      if (field && hk.inInput !== true && !(hk.inInput === 'empty' && field.value === '')) return;
      const run = latest.current[action];
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [map, enabled]);
}
