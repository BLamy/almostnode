import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import '@webide/styles/ide.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing renderer root element.');
}

createRoot(rootElement).render(<App />);
