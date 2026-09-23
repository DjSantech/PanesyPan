// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient, SESSION_QUERY_KEY } from '@/lib/query-client';
import { requestJson, requestUrl } from '@/test/fetch-helpers';
import { LoginPage } from './LoginPage';

const fetchMock = vi.fn<typeof fetch>();

function renderLogin() {
  const router = createMemoryRouter(
    [
      { path: '/ingresar', element: <LoginPage /> },
      { path: '/', element: <p>Inicio</p> },
    ],
    { initialEntries: ['/ingresar'] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.panesypan.test');
  vi.stubGlobal('fetch', fetchMock);
  // Nadie ha ingresado.
  queryClient.setQueryData(SESSION_QUERY_KEY, null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  queryClient.clear();
});

describe('LoginPage', () => {
  it('valida los campos antes de enviar', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(await screen.findByText('Escribe tu usuario')).toBeInTheDocument();
    expect(screen.getByText('Escribe tu contraseña')).toBeInTheDocument();
    expect(screen.getByLabelText('Usuario o correo')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('muestra el mensaje del servidor si las credenciales son incorrectas', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'INVALID_CREDENTIALS', message: 'Usuario o contraseña incorrectos' },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Usuario o correo'), 'laura');
    await user.type(screen.getByLabelText('Contraseña'), 'mala-clave');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario o contraseña incorrectos');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(requestUrl(url)).toBe('https://api.panesypan.test/api/v1/auth/login');
    expect(requestJson(init)).toEqual({ identifier: 'laura', password: 'mala-clave' });
  });

  it('permite ver la contraseña escrita', async () => {
    const user = userEvent.setup();
    renderLogin();
    const input = screen.getByLabelText('Contraseña');
    expect(input).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(input).toHaveAttribute('type', 'text');
  });
});
