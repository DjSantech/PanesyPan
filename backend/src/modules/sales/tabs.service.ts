import {
  lineTotal,
  SALE_LIMITS,
  sumMoney,
  toBusinessDate,
  type CloseSaleRequest,
  type Sale,
  type SaleLineInput,
} from '@panesypan/shared';
import { mongo } from 'mongoose';
import { AppError } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import { findOpenShift } from '../cash/cash.service';
import { getSettings } from '../settings/settings.service';
import { toAuditActor } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import { resolveApproval, type PosContext } from './approval.service';
import { SaleModel, type SaleDocument, type SaleLineAttrs } from './sale.model';
import { adjustPortions, buildLine, loadSellableProducts, portionChangesOf } from './sale-lines';
import {
  assertOpenTab,
  conflict,
  findSaleOrThrow,
  personOf,
  productFor,
  runInTransaction,
  saleEntity,
} from './sales.service';
import { toSaleDto } from './sales.mapper';

const tableTaken = (tableNumber: number): AppError =>
  conflict(`La mesa ${String(tableNumber)} ya tiene una cuenta abierta.`);

async function assertTableExists(tableNumber: number): Promise<void> {
  const { tableCount } = await getSettings();
  if (tableNumber > tableCount) {
    throw new AppError(400, 'VALIDATION_ERROR', `La mesa ${String(tableNumber)} no existe.`);
  }
}

/** En una cuenta abierta no hay descuento: el total es la suma de las líneas. */
function refreshTotals(tab: SaleDocument): void {
  const subtotal = sumMoney(tab.lines.map((line) => line.total));
  tab.subtotal = subtotal;
  tab.total = subtotal;
}

/** Copia plana de una línea (las líneas del documento son subdocumentos de Mongoose). */
function pickLine(line: SaleLineAttrs): SaleLineAttrs {
  return {
    _id: line._id,
    productId: line.productId,
    name: line.name,
    unitPrice: line.unitPrice,
    quantity: line.quantity,
    note: line.note,
    total: line.total,
    isLunch: line.isLunch,
    menuDate: line.menuDate,
  };
}

function findLine(tab: SaleDocument, lineId: string): SaleLineAttrs {
  const line = tab.lines.find((item) => item._id.toString() === lineId);
  if (line === undefined)
    throw new AppError(404, 'NOT_FOUND', 'Ese producto ya no está en la cuenta.');
  return line;
}

async function auditRemoval(
  tab: SaleDocument,
  line: Pick<SaleLineAttrs, 'name' | 'unitPrice'>,
  quantity: number,
  ctx: ActorContext,
): Promise<void> {
  await recordAudit(
    {
      action: 'TAB_ITEM_REMOVED',
      actor: toAuditActor(ctx.actor),
      entity: saleEntity(tab),
      metadata: {
        table: tab.tableNumber,
        product: line.name,
        quantity,
        total: line.unitPrice * quantity,
      },
      meta: ctx.meta,
    },
    ctx.logger,
  );
}

export async function listOpenTabs(): Promise<Sale[]> {
  const tabs = await SaleModel.find({ status: 'OPEN', type: 'TABLE' }).sort({ tableNumber: 1 });
  return tabs.map(toSaleDto);
}

export async function openTab(tableNumber: number, ctx: ActorContext): Promise<Sale> {
  await assertTableExists(tableNumber);
  if ((await SaleModel.exists({ status: 'OPEN', type: 'TABLE', tableNumber })) !== null) {
    throw tableTaken(tableNumber);
  }
  try {
    const tab = await SaleModel.create({
      type: 'TABLE',
      tableNumber,
      status: 'OPEN',
      lines: [],
      subtotal: 0,
      total: 0,
      openedBy: personOf(ctx.actor),
      openedAt: new Date(),
    });
    return toSaleDto(tab);
  } catch (error) {
    // Dos cajeras abriendo la misma mesa a la vez: el índice único deja pasar solo una.
    if (error instanceof mongo.MongoServerError && error.code === 11000)
      throw tableTaken(tableNumber);
    throw error;
  }
}

/** Agrega un producto. Si ya está en la cuenta con la misma nota y precio, suma la cantidad. */
export async function addTabLine(id: string, input: SaleLineInput): Promise<Sale> {
  const note = input.note ?? '';
  const tab = await runInTransaction(async (session) => {
    const doc = await findSaleOrThrow(id, session);
    assertOpenTab(doc);
    const today = toBusinessDate();
    const product = productFor(
      await loadSellableProducts([input.productId], session),
      input.productId,
    );
    const candidate = buildLine(product, input.quantity, note, today);

    const same = doc.lines.find(
      (line) =>
        line.productId.equals(candidate.productId) &&
        line.note === candidate.note &&
        line.unitPrice === candidate.unitPrice &&
        line.menuDate === candidate.menuDate,
    );
    if (same === undefined) {
      if (doc.lines.length >= SALE_LIMITS.maxLines) {
        throw new AppError(400, 'VALIDATION_ERROR', 'La cuenta tiene demasiados productos.');
      }
      doc.lines.push(candidate);
    } else {
      if (same.quantity + input.quantity > SALE_LIMITS.maxQuantity) {
        throw new AppError(400, 'VALIDATION_ERROR', 'La cantidad es demasiado alta.');
      }
      same.quantity += input.quantity;
      same.total = lineTotal(same);
    }
    await adjustPortions(portionChangesOf([candidate], 1), session);
    refreshTotals(doc);
    await doc.save({ session });
    return doc;
  });
  return toSaleDto(tab);
}

interface Removal {
  line: Pick<SaleLineAttrs, 'name' | 'unitPrice'>;
  quantity: number;
}

export async function updateTabLine(
  id: string,
  lineId: string,
  quantity: number,
  ctx: ActorContext,
): Promise<Sale> {
  const { tab, removal } = await runInTransaction(async (session) => {
    const doc = await findSaleOrThrow(id, session);
    assertOpenTab(doc);
    const line = findLine(doc, lineId);
    const delta = quantity - line.quantity;
    if (delta === 0) return { tab: doc, removal: null };
    if (delta > 0 && line.isLunch && line.menuDate !== toBusinessDate()) {
      throw conflict('Ese almuerzo es de otro día: agrégalo como un producto nuevo.');
    }
    await adjustPortions(
      portionChangesOf([{ ...pickLine(line), quantity: Math.abs(delta) }], delta > 0 ? 1 : -1),
      session,
    );
    const removed: Removal | null =
      delta < 0 ? { line: { name: line.name, unitPrice: line.unitPrice }, quantity: -delta } : null;
    line.quantity = quantity;
    line.total = lineTotal(line);
    refreshTotals(doc);
    await doc.save({ session });
    return { tab: doc, removal: removed };
  });
  if (removal !== null) await auditRemoval(tab, removal.line, removal.quantity, ctx);
  return toSaleDto(tab);
}

export async function removeTabLine(id: string, lineId: string, ctx: ActorContext): Promise<Sale> {
  const { tab, removal } = await runInTransaction(async (session) => {
    const doc = await findSaleOrThrow(id, session);
    assertOpenTab(doc);
    const line = pickLine(findLine(doc, lineId));
    await adjustPortions(portionChangesOf([line], -1), session);
    doc.lines = doc.lines.filter((item) => item._id.toString() !== lineId);
    refreshTotals(doc);
    await doc.save({ session });
    const removed: Removal = { line, quantity: line.quantity };
    return { tab: doc, removal: removed };
  });
  await auditRemoval(tab, removal.line, removal.quantity, ctx);
  return toSaleDto(tab);
}

export async function moveTab(id: string, tableNumber: number): Promise<Sale> {
  await assertTableExists(tableNumber);
  const tab = await findSaleOrThrow(id);
  assertOpenTab(tab);
  if (tab.tableNumber === tableNumber) return toSaleDto(tab);
  tab.tableNumber = tableNumber;
  try {
    await tab.save();
  } catch (error) {
    if (error instanceof mongo.MongoServerError && error.code === 11000)
      throw tableTaken(tableNumber);
    throw error;
  }
  return toSaleDto(tab);
}

/**
 * Cancela la cuenta de una mesa sin cobrarla. Si ya tenía productos (probablemente servidos),
 * hace falta la autorización de un administrador y queda en la auditoría.
 */
export async function cancelTab(
  id: string,
  input: CloseSaleRequest,
  ctx: PosContext,
): Promise<Sale> {
  const current = await findSaleOrThrow(id);
  assertOpenTab(current);
  const approver =
    current.lines.length > 0 ? await resolveApproval(ctx, input.approverPin, 'CANCEL_TAB') : null;
  const shift = await findOpenShift(ctx.actor.id);

  const tab = await runInTransaction(async (session) => {
    const doc = await findSaleOrThrow(id, session);
    assertOpenTab(doc);
    if (approver === null && doc.lines.length > 0) {
      throw new AppError(
        403,
        'APPROVAL_REQUIRED',
        'Esta operación necesita la autorización de un administrador.',
      );
    }
    const now = new Date();
    doc.status = 'CANCELED';
    doc.closure = { at: now, by: personOf(ctx.actor), approvedBy: approver, reason: input.reason };
    doc.businessDate = toBusinessDate(now);
    doc.shiftId = shift?._id ?? null;
    await adjustPortions(portionChangesOf(doc.lines, -1), session);
    await doc.save({ session });
    return doc;
  });

  await recordAudit(
    {
      action: 'TAB_CANCELED',
      actor: toAuditActor(ctx.actor),
      entity: saleEntity(tab),
      metadata: {
        table: tab.tableNumber,
        total: tab.total,
        note: input.reason,
        ...(approver === null ? {} : { approvedBy: approver.name }),
      },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toSaleDto(tab);
}
