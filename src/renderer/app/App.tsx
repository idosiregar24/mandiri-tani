import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { CustomerList } from '@/pages/customers/CustomerList';
import { HomePage } from '@/pages/home/HomePage';
import { IposImportPage } from '@/pages/imports/IposImportPage';
import { MasterDataPage } from '@/pages/masters/MasterDataPage';
import { PickupScreen } from '@/pages/pickups/PickupScreen';
import { PosScreen } from '@/pages/pos/PosScreen';
import { PrintTestPage } from '@/pages/printer/PrintTestPage';
import { AgingPage } from '@/pages/ar-ap/AgingPage';
import { PurchaseForm } from '@/pages/purchases/PurchaseForm';
import { PurchaseList } from '@/pages/purchases/PurchaseList';
import { ProductForm } from '@/pages/products/ProductForm';
import { ProductList } from '@/pages/products/ProductList';
import { AdjustmentForm } from '@/pages/stock/AdjustmentForm';
import { AdjustmentList } from '@/pages/stock/AdjustmentList';
import { OpnameList } from '@/pages/stock/OpnameList';
import { OpnamePage } from '@/pages/stock/OpnamePage';
import { StockCardPage } from '@/pages/stock/StockCardPage';
import { StockList } from '@/pages/stock/StockList';
import { SupplierList } from '@/pages/suppliers/SupplierList';
import { useSessionStore } from '@/lib/session';
import { AppShell } from './AppShell';
import { AuthGate } from './AuthGate';
import { BootGate } from './BootGate';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  // Full screen, no sidebar (design-standards §4).
  { path: '/kasir', element: <PosScreen /> },
  { path: '/pengambilan', element: <PickupScreen /> },
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/barang', element: <ProductList /> },
      { path: '/barang/baru', element: <ProductForm /> },
      { path: '/barang/:id', element: <ProductForm /> },
      { path: '/stok', element: <StockList /> },
      { path: '/stok/:productId', element: <StockCardPage /> },
      { path: '/penyesuaian', element: <AdjustmentList /> },
      { path: '/penyesuaian/baru', element: <AdjustmentForm /> },
      { path: '/opname', element: <OpnameList /> },
      { path: '/opname/:id', element: <OpnamePage /> },
      { path: '/pelanggan', element: <CustomerList /> },
      { path: '/supplier', element: <SupplierList /> },
      { path: '/pembelian', element: <PurchaseList /> },
      { path: '/pembelian/baru', element: <PurchaseForm /> },
      { path: '/piutang', element: <AgingPage key="AR" side="AR" /> },
      { path: '/hutang', element: <AgingPage key="AP" side="AP" /> },
      { path: '/data-lain', element: <MasterDataPage /> },
      { path: '/impor-ipos', element: <IposImportPage /> },
      { path: '/uji-cetak', element: <PrintTestPage /> },
      { path: '*', element: <HomePage /> },
    ],
  },
]);

// A cashier lands on the cashier screen right after logging in (sprint-5 S5-5); the "Menu"
// button still opens the back office afterwards.
useSessionStore.subscribe((now, before) => {
  if (now.session && now.session.token !== before.session?.token && now.session.user.role === 'KASIR') {
    void router.navigate('/kasir', { replace: true });
  }
});

export function App() {
  return (
    <BootGate>
      <QueryClientProvider client={queryClient}>
        <AuthGate>
          <RouterProvider router={router} />
        </AuthGate>
      </QueryClientProvider>
    </BootGate>
  );
}
