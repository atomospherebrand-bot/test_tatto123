import { Router } from "express";
import { and, asc, desc, eq, ilike, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import {
  portfolioTable,
  mastersTable,
  portfolioItemSchema,
  portfolioFiltersSchema,
} from "@shared/schema";
import { z } from "zod";

const router = Router();

const isPresent = <T>(value: T | undefined | null): value is T => value !== undefined && value !== null;

const listSchema = z.object({
  masterId: z.string().uuid().optional(),
  style: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

const createSchema = z.object({
  url: z.string().min(1),
  title: z.string().min(1),
  masterId: z.string().uuid().optional(),
  style: z.string().optional().nullable(),
  thumbnail: z
    .string()
    .optional()
    .nullable()
    .refine(
      (value) =>
        !value ||
        value === "" ||
        value.startsWith("http://") ||
        value.startsWith("https://") ||
        value.startsWith("/uploads/"),
      "Invalid thumbnail",
    ),
  mediaType: z.enum(["image", "video"]).default("image"),
});

router.get("/", async (req, res, next) => {
  try {
    const { masterId, style, q, page, pageSize } = listSchema.parse(req.query);

    const trimmedStyle = style?.trim();
    const trimmedQuery = q?.trim();

    const filters = [
      masterId ? eq(portfolioTable.masterId, masterId) : undefined,
      trimmedStyle ? ilike(portfolioTable.style, `%${trimmedStyle}%`) : undefined,
      trimmedQuery ? ilike(portfolioTable.title, `%${trimmedQuery}%`) : undefined,
    ].filter(isPresent);

    const where = filters.length ? and(...filters) : undefined;

    let countQuery = db.select({ count: sql<number>`count(*)` }).from(portfolioTable);
    if (where) {
      countQuery = countQuery.where(where);
    }
    const [{ count }] = await countQuery;

    let itemsQuery = db
      .select({
        id: portfolioTable.id,
        url: portfolioTable.url,
        title: portfolioTable.title,
        masterId: portfolioTable.masterId,
        style: portfolioTable.style,
        thumbnail: portfolioTable.thumbnail,
        mediaType: portfolioTable.mediaType,
        createdAt: portfolioTable.createdAt,
        masterName: mastersTable.name,
      })
      .from(portfolioTable)
      .leftJoin(mastersTable, eq(mastersTable.id, portfolioTable.masterId))
      .orderBy(desc(portfolioTable.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    if (where) {
      itemsQuery = itemsQuery.where(where);
    }

    const rows = await itemsQuery;
    const portfolio = rows.map((item) => ({
      ...portfolioItemSchema.parse({
        id: item.id,
        url: item.url,
        title: item.title,
        masterId: item.masterId,
        style: item.style,
        thumbnail: item.thumbnail,
        mediaType: (item.mediaType ?? "image") as "image" | "video",
        createdAt: item.createdAt ? item.createdAt.toISOString() : undefined,
      }),
      masterName: item.masterName ?? null,
    }));

    const total = Number(count ?? 0);
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

    res.json({ portfolio, total, page, pageSize, totalPages });
  } catch (err) {
    next(err);
  }
});

router.get("/filters", async (_req, res, next) => {
  try {
    const masters = await db
      .select({ id: mastersTable.id, name: mastersTable.name, nickname: mastersTable.nickname })
      .from(mastersTable)
      .orderBy(asc(mastersTable.name));

    const styleRows = await db
      .select({ style: portfolioTable.style })
      .from(portfolioTable)
      .where(and(isNotNull(portfolioTable.style), ne(portfolioTable.style, "")))
      .groupBy(portfolioTable.style)
      .orderBy(asc(portfolioTable.style));

    const styles = styleRows
      .map((row) => row.style?.trim())
      .filter(isPresent);
    const uniqueStyles = Array.from(new Set(styles)).sort((a, b) => a.localeCompare(b, "ru"));

    const filters = portfolioFiltersSchema.parse({ masters, styles: uniqueStyles });

    res.json(filters);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const url = body.url.trim();
    const title = body.title.trim();
    const isUpload = url.startsWith("/uploads/");
    const isHttp = url.startsWith("http://") || url.startsWith("https://");
    if (!isUpload && !isHttp) {
      return res.status(400).json({ message: "Invalid url" });
    }

    if (!title) {
      return res.status(400).json({ message: "Название обязательно" });
    }

    const style = body.style?.trim() || null;
    const thumbnail = body.thumbnail?.trim() || null;

    const [created] = await db
      .insert(portfolioTable)
      .values({
        url,
        title,
        masterId: body.masterId ?? null,
        style,
        thumbnail,
        mediaType: body.mediaType ?? "image",
      })
      .returning({ id: portfolioTable.id });

    if (!created) {
      return res.status(500).json({ message: "Не удалось создать работу портфолио" });
    }

    const [inserted] = await db
      .select({
        id: portfolioTable.id,
        url: portfolioTable.url,
        title: portfolioTable.title,
        masterId: portfolioTable.masterId,
        style: portfolioTable.style,
        thumbnail: portfolioTable.thumbnail,
        mediaType: portfolioTable.mediaType,
        createdAt: portfolioTable.createdAt,
        masterName: mastersTable.name,
      })
      .from(portfolioTable)
      .leftJoin(mastersTable, eq(mastersTable.id, portfolioTable.masterId))
      .where(eq(portfolioTable.id, created.id))
      .limit(1);

    if (!inserted) {
      return res.status(500).json({ message: "Не удалось прочитать работу портфолио" });
    }

    const item = {
      ...portfolioItemSchema.parse({
        id: inserted.id,
        url: inserted.url,
        title: inserted.title,
        masterId: inserted.masterId,
        style: inserted.style,
        thumbnail: inserted.thumbnail,
        mediaType: (inserted.mediaType ?? "image") as "image" | "video",
        createdAt: inserted.createdAt ? inserted.createdAt.toISOString() : undefined,
      }),
      masterName: inserted.masterName ?? null,
    };

    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const deleted = await db
      .delete(portfolioTable)
      .where(eq(portfolioTable.id, id))
      .returning({ id: portfolioTable.id });

    if (deleted.length === 0) {
      return res.status(404).json({ message: "Работа не найдена" });
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
