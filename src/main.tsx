import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './app/App';
import { initTheme } from './app/theme';

initTheme();

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);