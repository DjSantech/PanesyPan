import { describe, expect, it } from 'vitest';
import { isTrivialPin, passwordProblem, pinProblem } from './credential-rules';

describe('passwordProblem', () => {
  it('acepta contraseñas razonables', () => {
    expect(passwordProblem('horno caliente 7am')).toBeNull();
    expect(passwordProblem('Almojabana#2026')).toBeNull();
  });

  it('exige longitud mínima', () => {
    expect(passwordProblem('corta1')).toMatch(/al menos 8/);
  });

  it('rechaza contraseñas comunes, repetidas o con el usuario', () => {
    expect(passwordProblem('Panadería')).toMatch(/común/);
    expect(passwordProblem('12345678')).toMatch(/común/);
    expect(passwordProblem('aaaaaaaaaa')).toMatch(/común/);
    expect(passwordProblem('laura.gomez2026', 'laura.gomez')).toMatch(/usuario/);
  });
});

describe('PIN', () => {
  it.each(['000000', '999999', '123456', '654321', '012345', '121212', '123123', '909090'])(
    'considera trivial %s',
    (pin) => {
      expect(isTrivialPin(pin)).toBe(true);
    },
  );

  it.each(['482915', '730264', '158396'])('acepta %s', (pin) => {
    expect(pinProblem(pin)).toBeNull();
  });

  it('exige exactamente 6 números', () => {
    expect(pinProblem('12345')).toMatch(/exactamente 6/);
    expect(pinProblem('12a456')).toMatch(/exactamente 6/);
    expect(pinProblem('4829157')).toMatch(/exactamente 6/);
  });
});
