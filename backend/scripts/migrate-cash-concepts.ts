/**
 * Les pone tipo (Nómina, Compra de insumos, Gas…) a los egresos, retiros e ingresos que se
 * registraron antes de que existieran los tipos, según las palabras del motivo. Lo que no
 * reconoce queda en "Gastos varios" (egresos) o "Guardar en caja fuerte" (retiros).
 *
 * Uso (desde backend/):  npm run cash:concepts            (solo muestra lo que haría)
 *                        npm run cash:concepts -- --apply  (lo guarda)
 * Se puede ejecutar varias veces: solo toca los movimientos que siguen sin tipo.
 */
import { removeAccents, type CashMovementType } from '@panesypan/shared';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { loadEnv } from '../src/config/env';
import { CashConceptModel } from '../src/modules/cash/cash-config.models';
import { ensureDefaultCashConcepts } from '../src/modules/cash/cash-config.service';
import { CashMovementModel } from '../src/modules/cash/cash-movement.model';

/** Palabras del motivo → tipo por defecto (en orden: gana la primera que coincida). */
const RULES: readonly { type: CashMovementType; words: readonly string[]; concept: string }[] = [
  {
    type: 'EXPENSE',
    words: ['nomina', 'sueldo', 'quincena', 'adelanto'],
    concept: 'Nómina / pago a trabajador',
  },
  {
    type: 'EXPENSE',
    words: ['insumo', 'carne', 'queso', 'huevo', 'harina', 'leche', 'pollo'],
    concept: 'Compra de insumos',
  },
  { type: 'EXPENSE', words: ['arriendo'], concept: 'Arriendo' },
  {
    type: 'EXPENSE',
    words: ['servicio', 'energia', 'agua', 'internet'],
    concept: 'Servicios públicos',
  },
  { type: 'EXPENSE', words: ['gas'], concept: 'Gas' },
  { type: 'EXPENSE', words: ['hielo'], concept: 'Hielo' },
  { type: 'EXPENSE', words: ['domicilio'], concept: 'Domicilio' },
  { type: 'EXPENSE', words: ['proveedor'], concept: 'Proveedor' },
  { type: 'EXPENSE', words: [], concept: 'Gastos varios' },
  {
    type: 'WITHDRAWAL',
    words: ['ganancia', 'dueno', 'socio'],
    concept: 'Retiro / ganancia del dueño',
  },
  { type: 'WITHDRAWAL', words: ['proveedor'], concept: 'Base de proveedores' },
  { type: 'WITHDRAWAL', words: [], concept: 'Guardar en caja fuerte' },
  { type: 'INCOME', words: ['cambio'], concept: 'Cambio que trae el dueño' },
  { type: 'INCOME', words: ['reintegro', 'devuelve'], concept: 'Reintegro' },
  { type: 'INCOME', words: [], concept: 'Base adicional' },
];

const apply = process.argv.includes('--apply');
let exitCode = 0;
try {
  const env = loadEnv();
  await connectDatabase({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  await ensureDefaultCashConcepts();
  const concepts = await CashConceptModel.find();
  const conceptFor = (type: CashMovementType, reason: string) => {
    const text = removeAccents(reason).toLowerCase();
    const rule = RULES.find(
      (candidate) =>
        candidate.type === type &&
        (candidate.words.length === 0 || candidate.words.some((word) => text.includes(word))),
    );
    return concepts.find((concept) => concept.type === type && concept.name === rule?.concept);
  };

  const pending = await CashMovementModel.find({ concept: null });
  let updated = 0;
  for (const movement of pending) {
    const concept = conceptFor(movement.type, movement.reason);
    if (concept === undefined) continue;
    console.log(`[cash-concepts] "${movement.reason}" → ${concept.name}`);
    if (apply) {
      await CashMovementModel.updateOne(
        { _id: movement._id, concept: null },
        { $set: { concept: { id: concept._id, name: concept.name } } },
      );
    }
    updated += 1;
  }
  console.log(
    `[cash-concepts] ${String(updated)} de ${String(pending.length)} movimientos sin tipo ` +
      (apply ? 'actualizados.' : 'se actualizarían (agrega --apply para guardarlos).'),
  );
} catch (error) {
  console.error(`[cash-concepts] ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  await disconnectDatabase().catch(() => undefined);
}
process.exit(exitCode);
