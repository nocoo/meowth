import { BasaltProviders } from '@/components/basalt-providers';
import { router } from '@/routes';
import { RouterProvider } from 'react-router';

export default function App() {
  return (
    <BasaltProviders>
      <RouterProvider router={router} />
    </BasaltProviders>
  );
}
