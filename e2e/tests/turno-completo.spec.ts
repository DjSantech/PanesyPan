import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from '../fixtures/a11y';
import { completeFirstLogin, login, productButton } from '../fixtures/actions';
import { ADMIN, CASHIER } from '../fixtures/env';

/**
 * Un día normal de principio a fin, en orden:
 *   1. El administrador ingresa por primera vez y crea la cuenta de la cajera.
 *   2. La cajera ingresa, abre la caja, vende en mostrador y en mesa (pago combinado)
 *      y cierra la caja con un arqueo que cuadra exacto.
 *   3. El administrador ve en el panel lo vendido y la caja cerrada.
 * Base $ 100.000 + efectivo $ 7.000 (mostrador) + $ 2.500 (mesa) = $ 109.500 en el cajón.
 */
test.describe.configure({ mode: 'serial' });

let cashierTemporaryPassword = '';

test('el administrador ingresa por primera vez y crea a la cajera', async ({ page }) => {
  await page.goto('/ingresar');
  await expectAccessible(page, 'el ingreso');
  await login(page, ADMIN.username, ADMIN.initialPassword);
  await expectAccessible(page, 'el cambio de contraseña');
  await completeFirstLogin(page, ADMIN.initialPassword, ADMIN.password, ADMIN.pin);
  await expect(page.getByRole('heading', { name: 'Hola, Marta' })).toBeVisible();
  await expectAccessible(page, 'el panel del administrador');

  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Usuarios' })
    .click();
  await page.getByRole('button', { name: 'Nuevo usuario' }).click();
  const form = page.getByRole('dialog', { name: 'Nuevo usuario' });
  await form.getByLabel('Nombre completo').fill(CASHIER.name);
  await form.getByLabel('Usuario para ingresar').fill(CASHIER.username);
  await expect(form.getByLabel('Rol')).toHaveValue('CASHIER');
  await expectAccessible(page, 'el formulario de usuario');
  await form.getByRole('button', { name: 'Crear usuario' }).click();

  const credentials = page.getByRole('dialog', { name: 'Contraseña temporal' });
  await expect(credentials.getByRole('definition').first()).toHaveText(CASHIER.username);
  cashierTemporaryPassword = (await credentials.getByRole('definition').nth(1).innerText()).trim();
  expect(cashierTemporaryPassword).toMatch(/^[a-z0-9]{4}(-[a-z0-9]{4}){2}$/);
  await credentials.getByRole('button', { name: 'Listo, ya la entregué' }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: `@${CASHIER.username}` }),
  ).toBeVisible();

  // Facturación electrónica con el proveedor simulado (sin validez ante la DIAN).
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Ajustes' })
    .click();
  await page.getByRole('switch', { name: 'Facturar electrónicamente cada venta' }).click();
  await page.getByLabel('Impuesto general de los productos').selectOption('INC_8');
  await expectAccessible(page, 'los ajustes de facturación');
  await page.getByRole('button', { name: 'Guardar facturación' }).click();
  await expect(page.getByText('Facturación electrónica guardada')).toBeVisible();
});

test('la cajera abre caja, vende en mostrador y en mesa, y cierra cuadrada', async ({ page }) => {
  test.skip(cashierTemporaryPassword === '', 'Depende de la cuenta creada en la prueba anterior');

  await login(page, CASHIER.username, cashierTemporaryPassword);
  await completeFirstLogin(page, cashierTemporaryPassword, CASHIER.password, CASHIER.pin);

  // ── Apertura ──
  await page.goto('/vender');
  await page.getByLabel('Base inicial en efectivo').fill('100000');
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page.getByText('Caja abierta. ¡Buen turno!')).toBeVisible();
  await expectAccessible(page, 'el punto de venta');

  // ── Mostrador: 2 panes de bono + 1 croissant, paga con $ 10.000 ──
  await productButton(page, 'Pan de Bono, $ 2.000').click();
  await productButton(page, 'Pan de Bono, $ 2.000').click();
  await productButton(page, 'Croissant, $ 3.000').click();
  const order = page.getByRole('region', { name: 'Pedido de mostrador' });
  await expect(order.getByRole('listitem').filter({ hasText: 'Pan de Bono' })).toContainText(
    '$ 4.000',
  );
  await order.getByRole('button', { name: 'Cobrar $ 7.000' }).click();

  const counterCheckout = page.getByRole('dialog', { name: 'Cobrar pedido' });
  await counterCheckout.getByRole('button', { name: '$ 10.000' }).click();
  await expect(counterCheckout).toContainText(/Cambio\s*\$\s*3\.000/);
  await expectAccessible(page, 'el cobro');
  // La clienta pide la factura a su nombre.
  await counterCheckout.getByRole('button', { name: 'Factura a nombre del cliente' }).click();
  await counterCheckout.getByLabel('Número').fill('1088123456');
  await counterCheckout.getByLabel('Nombre o razón social').fill('Ana María Ospina');
  await counterCheckout.getByRole('button', { name: 'Cobrar $ 7.000' }).click();
  await expectSaleDone(page, 'Venta N.º 000001 registrada', '$ 3.000', 'SIMU1');

  // ── Mesa 3: 2 almojábanas + 1 buñuelo, efectivo y Nequi ──
  await page.getByRole('radio', { name: 'Mesas' }).click();
  await page.getByRole('button', { name: 'Mesa 3, libre' }).click();
  await productButton(page, 'Almojábana, $ 2.000').click();
  await productButton(page, 'Almojábana, $ 2.000').click();
  await productButton(page, 'Buñuelo, $ 1.500').click();
  const tab = page.getByRole('region', { name: 'Mesa 3' });
  await expect(tab.getByText('Total · 3 productos')).toBeVisible();
  await expectAccessible(page, 'las mesas');
  await tab.getByRole('button', { name: 'Cobrar $ 5.500' }).click();

  const tabCheckout = page.getByRole('dialog', { name: 'Cobrar mesa 3' });
  await tabCheckout.getByRole('button', { name: 'Pago combinado' }).click();
  await tabCheckout.getByLabel('Efectivo').fill('2500');
  await tabCheckout.getByLabel('Nequi').fill('3000');
  await expect(tabCheckout.getByText('Los pagos cuadran con el total')).toBeVisible();
  await tabCheckout.getByRole('button', { name: 'Cobrar $ 5.500' }).click();
  await expectSaleDone(page, 'Venta N.º 000002 registrada', '$ 0', 'SIMU2');
  await expect(page.getByRole('button', { name: 'Mesa 3, libre' })).toBeVisible();

  // ── Cierre con arqueo: 1 × 100.000 + 1 × 5.000 + 2 × 2.000 + 1 × 500 = 109.500 ──
  await page.getByRole('button', { name: 'Caja', exact: true }).click();
  const cash = page.getByRole('dialog', { name: 'Caja' });
  await expect(definitionOf(cash, 'Efectivo esperado')).toHaveText('$ 109.500');
  await cash.getByRole('button', { name: 'Cerrar caja' }).click();

  const closing = page.getByRole('dialog', { name: 'Cerrar caja' });
  const counts = closing.getByRole('list', { name: 'Conteo por denominación' });
  await counts.getByLabel('$ 100.000', { exact: true }).fill('1');
  await counts.getByLabel('$ 5.000', { exact: true }).fill('1');
  await counts.getByLabel('$ 2.000', { exact: true }).fill('2');
  await counts.getByLabel('$ 500', { exact: true }).fill('1');
  await expect(definitionOf(closing, 'Contado')).toHaveText('$ 109.500');
  await expectAccessible(page, 'el arqueo');
  await expect(closing.getByLabel('Nota obligatoria')).toHaveCount(0);
  await closing.getByRole('button', { name: 'Cerrar caja' }).click();

  const closed = page.getByRole('dialog', { name: 'Caja cerrada' });
  await expect(closed).toContainText('Contaste $ 109.500 y el sistema esperaba $ 109.500.');
  await expect(closed).toContainText('Cuadra exacto');
  await closed.getByRole('button', { name: 'Listo' }).click();
  await expect(page.getByRole('heading', { name: 'Abrir caja' })).toBeVisible();
});

test('el administrador ve lo vendido en el panel', async ({ page }) => {
  await login(page, ADMIN.username, ADMIN.password);
  const summary = page.getByRole('region', { name: 'Resumen de hoy' });
  await expect(summary).toContainText('$ 12.500');
  await expect(summary).toContainText('No hay cajas abiertas');

  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Ventas' })
    .click();
  await expect(page.getByText('000001')).toBeVisible();
  await expect(page.getByText('000002')).toBeVisible();

  await page.goto('/facturacion');
  await expect(page.getByRole('heading', { name: 'Facturación electrónica' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Validada (2)' })).toBeVisible();
  const documents = page.getByRole('listitem');
  await expect(documents.filter({ hasText: 'Factura SIMU1' })).toContainText('Ana María Ospina');
  await expect(documents.filter({ hasText: 'Factura SIMU2' })).toContainText('Consumidor final');
  await expectAccessible(page, 'la facturación electrónica');
});

async function expectSaleDone(
  page: Page,
  title: string,
  change: string,
  invoiceNumber: string,
): Promise<void> {
  const done = page.getByRole('dialog', { name: title });
  await expect(done).toBeVisible();
  await expect(done).toContainText(change);
  // La factura electrónica se valida en segundos y el diálogo lo muestra sin recargar.
  await expect(done).toContainText('Factura electrónica: Validada');
  await expect(done).toContainText(invoiceNumber);
  await done.getByRole('button', { name: 'Nueva venta' }).click();
  await expect(done).toBeHidden();
}

/** Valor (dd) que acompaña a una etiqueta (dt) dentro de un diálogo. */
const definitionOf = (scope: ReturnType<Page['getByRole']>, term: string) =>
  scope.getByRole('term').filter({ hasText: term }).locator('xpath=following-sibling::dd[1]');
