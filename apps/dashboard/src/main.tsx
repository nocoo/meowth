import { applyStoredTheme } from '@/lib/theme-init';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

applyStoredTheme();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('main: #root element missing from index.html');
}
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
