import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { CustomerList } from '@/pages/customers/CustomerList';
import { HomePage } from '@/pages/home/HomePage';
import { IposImportPage } from '@/pages/imports/IposImportPage';
import { MasterDataPage } from '@/pages/masters/MasterDataPage';
import { PrintTestPage } from '@/pages/printer/PrintTestPage';
import { ProductForm } from '@/pages/products/ProductForm';
import { ProductList } from '@/pages/products/ProductList';
import { AdjustmentForm } from '@/pages/stock/AdjustmentForm';
import { AdjustmentList } from '@/pages/stock/AdjustmentList';
import { OpnameList } from '@/pages/stock/OpnameList';
import { OpnamePage } from '@/pages/stock/OpnamePage';
import { StockCardPage } from '@/pages/stock/StockCardPage';
import { StockList } from '@/pages/stock/StockList';
import { SupplierList } from '@/pages/suppliers/SupplierList';
import { AppShell } from './AppShell';
import { AuthGate } from './AuthGate';
import { BootGate } from './BootGate';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
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
      { path: '/data-lain', element: <MasterDataPage /> },
      { path: '/impor-ipos', element: <IposImportPage /> },
      { path: '/uji-cetak', element: <PrintTestPage /> },
      { path: '*', element: <HomePage /> },
    ],
  },
]);

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
