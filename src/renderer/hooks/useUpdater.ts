import { useEffect, useState } from 'react';
import type { CheckUpdateResult, UpdaterStatus } from '@shared/updater';

const initialStatus: UpdaterStatus = {
  state: 'IDLE',
  currentVersion: '0.1.0',
};

export function useUpdater() {
  const [status, setStatus] = useState<UpdaterStatus>(initialStatus);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isCheckingManual, setIsCheckingManual] = useState(false);

  useEffect(() => {
    if (!window.pos?.updater) return;

    // Load initial status
    void window.pos.updater.getStatus().then((st) => {
      setStatus(st);
    });

    // Subscribe to IPC status updates
    const unsubscribe = window.pos.updater.onStatusChange((newStatus) => {
      setStatus(newStatus);
      // Reset dismissal when new state is AVAILABLE or DOWNLOADED
      if (newStatus.state === 'AVAILABLE' || newStatus.state === 'DOWNLOADED') {
        setIsDismissed(false);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const checkForUpdates = async (): Promise<CheckUpdateResult> => {
    if (!window.pos?.updater) {
      return { hasUpdate: false, error: 'Fitur updater hanya tersedia di aplikasi desktop.' };
    }
    setIsCheckingManual(true);
    setIsDismissed(false);
    try {
      return await window.pos.updater.check();
    } finally {
      setIsCheckingManual(false);
    }
  };

  const downloadUpdate = async (): Promise<void> => {
    if (!window.pos?.updater) return;
    await window.pos.updater.download();
  };

  const installUpdate = async (): Promise<void> => {
    if (!window.pos?.updater) return;
    await window.pos.updater.install();
  };

  const dismiss = () => {
    setIsDismissed(true);
  };

  const reopen = () => {
    setIsDismissed(false);
  };

  const hasUpdate = status.state === 'AVAILABLE' || status.state === 'DOWNLOADING' || status.state === 'DOWNLOADED';
  const isDownloading = status.state === 'DOWNLOADING';
  const isDownloaded = status.state === 'DOWNLOADED';
  const isChecking = status.state === 'CHECKING' || isCheckingManual;

  return {
    status,
    hasUpdate,
    isDownloading,
    isDownloaded,
    isChecking,
    isDismissed,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    dismiss,
    reopen,
  };
}

