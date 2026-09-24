import {
  businessDateRangeUtc,
  upsertDailyMenuRequestSchema,
  type DailyMenu,
  type UpsertDailyMenuRequest,
} from '@panesypan/shared';
import { trusted, Types } from 'mongoose';
import type { z } from 'zod';
import { AppError } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import { toAuditActor } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import {
  CategoryModel,
  DailyMenuModel,
  ProductModel,
  type DailyMenuDocument,
} from './catalog.models';

type ParsedMenu = z.output<typeof upsertDailyMenuRequestSchema>;

/** Valida que la fecha exista de verdad (31 de febrero, no). */
export function assertMenuDate(date: string): void {
  try {
    businessDateRangeUtc(date);
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', `La fecha ${date} no es válida`);
  }
}

async function toDailyMenuDto(date: string, menu: DailyMenuDocument | null): Promise<DailyMenu> {
  if (menu === null) {
    return {
      date,
      soup: '',
      principle: '',
      proteins: [],
      sides: [],
      juice: '',
      notes: '',
      offerings: [],
      isPublished: false,
      updatedAt: null,
    };
  }
  const products = await ProductModel.find({
    _id: trusted({ $in: menu.offerings.map((offering) => offering.productId) }),
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  return {
    date: menu.date,
    soup: menu.soup,
    principle: menu.principle,
    proteins: menu.proteins.map((protein) => ({
      name: protein.name,
      isAvailable: protein.isAvailable,
    })),
    sides: [...menu.sides],
    juice: menu.juice,
    notes: menu.notes,
    offerings: menu.offerings.map((offering) => {
      const product = byId.get(offering.productId.toString());
      return {
        productId: offering.productId.toString(),
        portions: offering.portions,
        sold: offering.sold,
        name: product?.name ?? 'Producto eliminado',
        price: product?.price ?? 0,
      };
    }),
    isPublished: menu.isPublished,
    updatedAt: menu.updatedAt.toISOString(),
  };
}

export async function getDailyMenu(date: string): Promise<DailyMenu> {
  assertMenuDate(date);
  return toDailyMenuDto(date, await DailyMenuModel.findOne({ date }));
}

/** Los productos del menú deben existir, estar activos y pertenecer a una categoría de almuerzos. */
async function assertLunchProducts(productIds: string[]): Promise<void> {
  if (productIds.length === 0) return;
  const products = await ProductModel.find({
    _id: trusted({ $in: productIds.map((id) => new Types.ObjectId(id)) }),
    isActive: true,
  });
  if (products.length !== productIds.length) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Algún producto del menú no existe o está archivado',
    );
  }
  const lunchCategories = await CategoryModel.find({ kind: 'LUNCH' });
  const lunchIds = new Set(lunchCategories.map((category) => category.id));
  const notLunch = products.filter((product) => !lunchIds.has(product.categoryId.toString()));
  if (notLunch.length > 0) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `"${notLunch[0]?.name ?? ''}" no es un producto de almuerzos`,
    );
  }
}

export async function upsertDailyMenu(
  date: string,
  input: UpsertDailyMenuRequest,
  ctx: ActorContext,
): Promise<DailyMenu> {
  assertMenuDate(date);
  const data: ParsedMenu = upsertDailyMenuRequestSchema.parse(input);
  await assertLunchProducts(data.offerings.map((offering) => offering.productId));

  const existing = await DailyMenuModel.findOne({ date });
  const soldByProduct = new Map(
    (existing?.offerings ?? []).map((offering) => [offering.productId.toString(), offering.sold]),
  );

  const offerings = data.offerings.map((offering) => {
    const sold = soldByProduct.get(offering.productId) ?? 0;
    if (offering.portions !== null && offering.portions < sold) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `Ya se vendieron ${String(sold)} porciones: no puedes dejar menos`,
      );
    }
    return { productId: new Types.ObjectId(offering.productId), portions: offering.portions, sold };
  });

  const menu = await DailyMenuModel.findOneAndUpdate(
    { date },
    {
      $set: {
        soup: data.soup,
        principle: data.principle,
        proteins: data.proteins,
        sides: data.sides,
        juice: data.juice,
        notes: data.notes,
        offerings,
        isPublished: data.isPublished,
        updatedBy: new Types.ObjectId(ctx.actor.id),
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  await recordAudit(
    {
      action: 'DAILY_MENU_UPDATED',
      actor: toAuditActor(ctx.actor),
      entity: { type: 'DAILY_MENU', id: date, label: date },
      metadata: { isPublished: data.isPublished, offerings: offerings.length },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toDailyMenuDto(date, menu);
}
