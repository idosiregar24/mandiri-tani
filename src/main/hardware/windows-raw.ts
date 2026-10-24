// Transport "windows-raw" (PRD §8.1): sends bytes to a Windows printer queue as a RAW job,
// so the Epson driver passes ESC/P through untouched and no print dialog appears.
// Uses a small PowerShell + Win32 (winspool) helper instead of a native Node module:
// nothing to rebuild for Electron's ABI. The same code was field-tested as tools/uji-cetak.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HELPER = String.raw`param(
  [Parameter(Mandatory = $true)][string]$Printer,
  [Parameter(Mandatory = $true)][string]$JobFile,
  [string]$DocName = 'Mandiri Tani POS'
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class MtposRawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFO {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }
    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr handle);
    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern int StartDocPrinter(IntPtr handle, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO info);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr handle, IntPtr bytes, int count, out int written);
    public static int Send(string printerName, byte[] data, string docName) {
        IntPtr handle;
        int jobId;
        if (!OpenPrinter(printerName, out handle, IntPtr.Zero))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenPrinter");
        try {
            DOCINFO info = new DOCINFO();
            info.pDocName = docName;
            info.pDataType = "RAW";
            jobId = StartDocPrinter(handle, 1, info);
            if (jobId == 0)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "StartDocPrinter RAW");
            try {
                if (!StartPagePrinter(handle)) throw new Win32Exception(Marshal.GetLastWin32Error(), "StartPagePrinter");
                IntPtr buffer = Marshal.AllocCoTaskMem(data.Length);
                try {
                    Marshal.Copy(data, 0, buffer, data.Length);
                    int written;
                    if (!WritePrinter(handle, buffer, data.Length, out written) || written != data.Length)
                        throw new Win32Exception(Marshal.GetLastWin32Error(), "WritePrinter");
                } finally { Marshal.FreeCoTaskMem(buffer); }
                EndPagePrinter(handle);
            } finally { EndDocPrinter(handle); }
        } finally { ClosePrinter(handle); }
        return jobId;
    }
}
'@
$bytes = [System.IO.File]::ReadAllBytes($JobFile)
$jobId = [MtposRawPrinter]::Send($Printer, $bytes, $DocName)

# The spooler accepting a job does not mean the printer got it (e.g. a queue on a dead
# LPT1 port). Watch the job briefly: gone = handed to the printer; error state = stuck,
# so cancel it (no surprise print later) and report.
$deadline = (Get-Date).AddSeconds(8)
do {
  Start-Sleep -Milliseconds 500
  $job = Get-PrintJob -PrinterName $Printer -ID $jobId -ErrorAction SilentlyContinue
  if (-not $job) { Write-Output "OK $($bytes.Length) DONE"; exit 0 }
  $status = [string]$job.JobStatus
  if ($status -match 'Error|Offline|PaperOut|Blocked|UserIntervention') {
    Remove-PrintJob -InputObject $job -ErrorAction SilentlyContinue
    Write-Output "STUCK $status"
    exit 0
  }
} while ((Get-Date) -lt $deadline)
Write-Output "OK $($bytes.Length) QUEUED"
`;

/** Lists Windows printer queues with port and status (fixed command, no user input). */
const LIST_PRINTERS =
  "Get-Printer | Select-Object Name, DriverName, PortName, @{n='Status';e={[string]$_.PrinterStatus}} | ConvertTo-Json -Compress";

export interface WindowsPrinter {
  name: string;
  driver: string;
  port: string;
  status: string;
}

export function listWindowsPrinters(timeoutMs = 20_000): Promise<WindowsPrinter[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', LIST_PRINTERS],
      { windowsHide: true, timeout: timeoutMs, encoding: 'utf8' },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          const raw = JSON.parse(stdout.trim() || '[]') as
            | { Name: string; DriverName: string; PortName: string; Status: string }
            | { Name: string; DriverName: string; PortName: string; Status: string }[];
          const list = Array.isArray(raw) ? raw : [raw];
          resolve(list.map((p) => ({ name: p.Name, driver: p.DriverName ?? '', port: p.PortName ?? '', status: p.Status ?? '' })));
        } catch (parseErr) {
          reject(parseErr instanceof Error ? parseErr : new Error(String(parseErr)));
        }
      },
    );
  });
}

export class RawPrintError extends Error {
  constructor(
    message: string,
    public readonly detail: string,
  ) {
    super(message);
    this.name = 'RawPrintError';
  }
}

function friendlyMessage(detail: string): string {
  if (/OpenPrinter/.test(detail)) return 'Printer tidak ditemukan di Windows. Periksa nama printer dan drivernya.';
  if (/StartDocPrinter/.test(detail)) {
    return 'Driver printer menolak cetak langsung (RAW). Coba tambahkan printer dengan driver "Generic / Text Only" di port yang sama.';
  }
  if (/WritePrinter/.test(detail)) return 'Gagal mengirim data ke printer. Periksa kabel USB, daya, dan kertas.';
  return 'Gagal mencetak. Periksa printer (menyala, ON-LINE, kertas terpasang) lalu coba lagi.';
}

export interface RawPrintOptions {
  /** Folder for the helper script (the app data dir), so it survives temp cleaners. */
  helperDir: string;
  docName?: string;
  timeoutMs?: number;
}

/** Sends `bytes` as one RAW job. Resolves when the spooler accepted it. */
export async function sendRaw(printer: string, bytes: Uint8Array, opts: RawPrintOptions): Promise<void> {
  mkdirSync(opts.helperDir, { recursive: true });
  const helper = join(opts.helperDir, 'raw-print.ps1');
  writeFileSync(helper, `${String.fromCharCode(0xfeff)}${HELPER}`, 'utf8'); // BOM: PowerShell 5.1 reads UTF-8 correctly
  const job = join(tmpdir(), `mtpos-print-${randomBytes(6).toString('hex')}.prn`);
  writeFileSync(job, bytes);
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Printer', printer, '-JobFile', job, '-DocName', opts.docName ?? 'Mandiri Tani POS'],
        { windowsHide: true, timeout: opts.timeoutMs ?? 30_000, encoding: 'utf8' },
        (err, stdout, stderr) => {
          if (!err && /^OK \d+/m.test(stdout)) return resolve();
          const stuck = /^STUCK (.*)$/m.exec(stdout);
          if (!err && stuck) {
            return reject(
              new RawPrintError(
                `Printer tidak merespons — pekerjaan cetak tertahan di antrean Windows (status: ${stuck[1]?.trim()}) dan sudah dibatalkan. ` +
                  'Pastikan printer menyala & ON-LINE, kabel USB terpasang, dan pilih printer yang port-nya USB.',
                stdout.trim(),
              ),
            );
          }
          const detail = `${stderr || ''}${err ? `\n${err.message}` : ''}`.trim() || stdout;
          reject(new RawPrintError(friendlyMessage(detail), detail));
        },
      );
    });
  } finally {
    rmSync(job, { force: true });
  }
}
