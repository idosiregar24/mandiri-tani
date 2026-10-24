import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { HomePage } from '@/pages/home/HomePage';
import { PrintTestPage } from '@/pages/printer/PrintTestPage';
import { BootGate } from './BootGate';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/uji-cetak', element: <PrintTestPage /> },
  { path: '*', element: <HomePage /> },
]);

export function App() {
  return (
    <BootGate>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </BootGate>
  );
}
