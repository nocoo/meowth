import { RouterProvider } from 'react-router';
import { BasaltProviders } from '@/components/basalt-providers';
import { router } from '@/routes';

export default function App() {
  return (
    <BasaltProviders>
      <RouterProvider router={router} />
    </BasaltProviders>
  );
}
