import { expect, type Page } from '@playwright/test';

/** Pasos que se repiten en varios flujos, escritos como los haría una persona. */

export async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/ingresar');
  await page.getByLabel('Usuario o correo').fill(username);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

/** Primer ingreso: cambia la contraseña temporal y crea el PIN (dos veces). */
export async function completeFirstLogin(
  page: Page,
  temporaryPassword: string,
  password: string,
  pin: string,
): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Nueva contraseña' })).toBeVisible();
  await page.getByLabel('Contraseña temporal').fill(temporaryPassword);
  await page.getByLabel('Nueva contraseña', { exact: true }).fill(password);
  await page.getByLabel('Repite la nueva contraseña').fill(password);
  await page.getByRole('button', { name: 'Guardar y continuar' }).click();

  await expect(page.getByRole('heading', { name: 'Crea tu PIN' })).toBeVisible();
  await typePin(page, pin);
  await expect(page.getByRole('heading', { name: 'Confirma tu PIN' })).toBeVisible();
  await typePin(page, pin);
  await expect(page).toHaveURL(/\/$/);
}

export async function typePin(page: Page, pin: string): Promise<void> {
  for (const digit of pin) {
    await page.getByRole('button', { name: `Dígito ${digit}` }).click();
  }
}

/** Botón de un producto en el POS, por nombre y precio ("Pan de Bono, $ 2.000"). */
export const productButton = (page: Page, label: string) =>
  page.getByRole('list', { name: 'Productos' }).getByRole('button', { name: label });
