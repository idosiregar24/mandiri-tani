import { useEffect, useState } from 'react';
import type { DeviceConfig, ProductItem, SyncState } from './types';
import { getConfig, getProducts, getSyncState } from './lib/storage';
import { runSync } from './lib/sync';
import { SyncHeader } from './components/SyncHeader';
import { Navbar, type TabType } from './components/Navbar';
import { HomePage } from './pages/HomePage';
import { PriceCheckPage } from './pages/PriceCheckPage';
import { StockOpnamePage } from './pages/StockOpnamePage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const [config, setConfig] = useState<DeviceConfig | null>(null);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [syncState, setSyncState] = useState<SyncState>({
    isOnline: false,
    isSyncing: false,
    lastSyncedAt: null,
    pendingCount: 0,
    lastError: null,
  });
  const [currentTab, setCurrentTab] = useState<TabType>('home');
  const [initialSearchBarcode, setInitialSearchBarcode] = useState('');

  // Initial load from storage
  useEffect(() => {
    let active = true;
    async function loadData() {
      const [storedConfig, storedProducts, storedSync] = await Promise.all([
        getConfig(),
        getProducts(),
        getSyncState(),
      ]);
      if (!active) return;
      setConfig(storedConfig);
      setProducts(storedProducts);
      setSyncState(storedSync);

      // If configured, trigger initial background sync
      if (storedConfig) {
        void runSync().then((res) => {
          if (!active) return;
          setSyncState(res.state);
          void getProducts().then((p) => active && setProducts(p));
        });
      }
    }
    void loadData();
    return () => {
      active = false;
    };
  }, []);

  const handleTriggerSync = async () => {
    const res = await runSync();
    setSyncState(res.state);
    const updatedProducts = await getProducts();
    setProducts(updatedProducts);
  };

  const handleOpnameSaved = async () => {
    const s = await getSyncState();
    setSyncState(s);
    // If online, try immediate sync push
    if (syncState.isOnline) {
      await handleTriggerSync();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between font-sans">
      <SyncHeader
        config={config}
        syncState={syncState}
        onTriggerSync={handleTriggerSync}
      />

      <main className="flex-1 max-w-lg mx-auto w-full">
        {currentTab === 'home' && (
          <HomePage
            config={config}
            products={products}
            syncState={syncState}
            onTriggerSync={handleTriggerSync}
            onNavigateTab={(tab) => setCurrentTab(tab)}
            onSelectScannedBarcode={(code) => setInitialSearchBarcode(code)}
          />
        )}

        {currentTab === 'price' && (
          <PriceCheckPage
            products={products}
            initialSearch={initialSearchBarcode}
          />
        )}

        {currentTab === 'opname' && (
          <StockOpnamePage
            products={products}
            onOpnameSaved={handleOpnameSaved}
          />
        )}

        {currentTab === 'settings' && (
          <SettingsPage
            config={config}
            syncState={syncState}
            onConfigChange={(newCfg) => setConfig(newCfg)}
            onTriggerSync={handleTriggerSync}
          />
        )}
      </main>

      <Navbar
        currentTab={currentTab}
        onChangeTab={(tab) => {
          if (tab !== 'price') setInitialSearchBarcode('');
          setCurrentTab(tab);
        }}
        pendingCount={syncState.pendingCount}
      />
    </div>
  );
}

export default App;

