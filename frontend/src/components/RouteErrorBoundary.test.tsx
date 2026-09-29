// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { RootErrorBoundary } from './RouteErrorBoundary';

function Boom(): never {
  throw new Error('boom');
}

describe('RootErrorBoundary', () => {
  it('muestra un mensaje en vez de una pantalla en blanco cuando algo lanza', () => {
    // El error esperado igual se imprime en consola: se silencia para no ensuciar el reporte.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <MemoryRouter>
        <RootErrorBoundary>
          <Boom />
        </RootErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText('Algo salió mal')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ir al inicio/i })).toBeInTheDocument();
  });

  it('sin errores, muestra el contenido normal', () => {
    render(
      <MemoryRouter>
        <RootErrorBoundary>
          <p>Todo bien</p>
        </RootErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText('Todo bien')).toBeInTheDocument();
  });
});
