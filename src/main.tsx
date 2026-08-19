import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {runStorageMigration} from './lib/storage';

// Storage schema migration must complete before any component reads finance data.
runStorageMigration();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
