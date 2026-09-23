import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

// Las pruebas de componentes usan jsdom; las de lógica corren en Node sin DOM.
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
