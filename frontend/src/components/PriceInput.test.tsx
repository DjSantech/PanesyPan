// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PriceInput } from './PriceInput';

function Harness() {
  const [value, setValue] = useState<number | null>(null);
  return (
    <>
      <PriceInput aria-label="Precio" value={value} onValueChange={setValue} />
      <output>{value === null ? 'vacío' : String(value)}</output>
    </>
  );
}

describe('PriceInput', () => {
  it('muestra separador de miles y entrega el número entero', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Precio'), '12500');

    expect(screen.getByLabelText('Precio')).toHaveValue('12.500');
    expect(screen.getByRole('status')).toHaveTextContent('12500');
  });

  it('ignora letras y queda vacío si se borra todo', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Precio');
    await user.type(input, '8a0b0');
    expect(input).toHaveValue('800');

    await user.clear(input);
    expect(screen.getByRole('status')).toHaveTextContent('vacío');
  });
});
