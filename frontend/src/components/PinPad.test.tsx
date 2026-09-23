// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PinPad } from './PinPad';

function Harness({ onComplete }: { onComplete: (pin: string) => void }) {
  const [value, setValue] = useState('');
  return <PinPad label="PIN de prueba" value={value} onChange={setValue} onComplete={onComplete} />;
}

describe('PinPad', () => {
  it('completa el PIN con los botones grandes', async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(<Harness onComplete={onComplete} />);

    for (const digit of ['4', '8', '2', '9', '1', '5']) {
      await user.click(screen.getByRole('button', { name: `Dígito ${digit}` }));
    }

    expect(onComplete).toHaveBeenCalledWith('482915');
    expect(screen.getByText('6 de 6 dígitos')).toBeInTheDocument();
  });

  it('funciona con el teclado físico y permite borrar', async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(<Harness onComplete={onComplete} />);

    await user.keyboard('4829');
    await user.keyboard('{Backspace}');
    expect(screen.getByText('3 de 6 dígitos')).toBeInTheDocument();

    await user.keyboard('9157');
    expect(onComplete).toHaveBeenCalledWith('482915');
  });

  it('no muestra nunca los dígitos escritos', async () => {
    const user = userEvent.setup();
    render(<Harness onComplete={vi.fn()} />);
    await user.keyboard('73026');
    expect(screen.queryByText('73026')).not.toBeInTheDocument();
  });

  it('muestra el error de forma accesible', () => {
    render(<PinPad label="PIN" value="" onChange={vi.fn()} error="PIN incorrecto" />);
    expect(screen.getByRole('alert')).toHaveTextContent('PIN incorrecto');
  });
});
