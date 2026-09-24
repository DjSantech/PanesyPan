import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

const THEMES = ['light', 'dark'] as const;

/**
 * Revisa la pantalla con axe (reglas WCAG 2.2 A y AA) en el tema claro y en el oscuro.
 * Falla ante problemas graves o críticos: contraste, controles sin nombre, roles mal usados…
 */
export async function expectAccessible(page: Page, screen: string): Promise<void> {
  const problems: string[] = [];
  for (const colorScheme of THEMES) {
    await page.emulateMedia({ colorScheme });
    await waitForThemeApplied(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      // Los avisos (sonner) aparecen y desaparecen solos: no son parte de la pantalla.
      .exclude('[data-sonner-toaster]')
      .analyze();
    for (const violation of violations) {
      if (violation.impact !== 'serious' && violation.impact !== 'critical') continue;
      const nodes = violation.nodes
        .slice(0, 3)
        .map((node) => `${node.target.join(' ')} [${node.failureSummary ?? ''}]`)
        .join(' | ');
      problems.push(`${colorScheme} · ${violation.id}: ${violation.help} → ${nodes}`);
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await waitForThemeApplied(page);
  expect(problems, `Problemas de accesibilidad en ${screen}`).toEqual([]);
}

/** El fondo del body tarda un instante en tomar el tema nuevo: se espera a que coincida. */
async function waitForThemeApplied(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--background)';
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(document.body).backgroundColor === expected;
  });
}
