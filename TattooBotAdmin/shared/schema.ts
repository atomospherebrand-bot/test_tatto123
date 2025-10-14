import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  pgTable,
  text,
  time,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/** USERS */
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

/** MASTERS */
export const mastersTable = pgTable("masters", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  nickname: text("nickname").notNull(),
  telegram: text("telegram"),
  specialization: text("specialization").notNull(),
  avatar: text("avatar"),
  isActive: boolean("is_active").notNull().default(true),
});

/** SERVICES */
export const servicesTable = pgTable("services", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  duration: integer("duration").notNull(),
  price: integer("price").notNull(),
  description: text("description").notNull(),
});

/** BOOKINGS */
export const bookingsTable = pgTable("bookings", {
  id: uuid("id").primaryKey(),
  clientName: text("client_name").notNull(),
  clientPhone: text("client_phone").notNull(),
  clientTelegram: text("client_telegram"),
  masterId: uuid("master_id").notNull().references(() => mastersTable.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").notNull().references(() => servicesTable.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  time: time("time").notNull(),
  duration: integer("duration").notNull(),
  status: text("status").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/** BOT MESSAGES */
export const botMessagesTable = pgTable("bot_messages", {
  id: uuid("id").primaryKey(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  value: text("value").notNull(),
  type: text("type").notNull(),
});

/** PORTFOLIO (images + videos) */
export const portfolioTable = pgTable("portfolio_items", {
  id: uuid("id").primaryKey(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  masterId: uuid("master_id").references(() => mastersTable.id, { onDelete: "set null" }),
  style: text("style"),
  thumbnail: text("thumbnail"),
  mediaType: text("media_type").notNull().default("image"), // 'image' | 'video'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/** SETTINGS */
export const settingsTable = pgTable("settings", {
  id: text("id").primaryKey(),
  botToken: text("bot_token").notNull().default(""),
  studioName: text("studio_name").notNull(),
  address: text("address").notNull(),
  yandexMapUrl: text("yandex_map_url"),
  latitude: text("latitude"),
  longitude: text("longitude"),
  paymentMethods: text("payment_methods").notNull().default(""),
  workingHours: text("working_hours").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/** ZOD */
export const insertUserSchema = createInsertSchema(users).pick({ username: true, password: true });

export const masterSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  nickname: z.string().min(1),
  telegram: z.string().min(1).optional(),
  specialization: z.string().min(1),
  avatar: z
    .string()
    .refine(v => !v || v.startsWith("http") || v.startsWith("/uploads/"), "Invalid url")
    .optional(),
  isActive: z.boolean(),
});
export const insertMasterSchema = masterSchema.omit({ id: true });

export const serviceSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  duration: z.number().int().positive(),
  price: z.number().int().nonnegative(),
  description: z.string().default(""),
});
export const insertServiceSchema = serviceSchema.omit({ id: true });

export const bookingStatusSchema = z.enum(["pending", "confirmed", "cancelled"]);
export const bookingSchema = z.object({
  id: z.string(),
  clientName: z.string().min(1),
  clientPhone: z.string().min(1),
  clientTelegram: z.string().optional(),
  masterId: z.string(),
  masterName: z.string(),
  masterTelegram: z.string().optional(),
  serviceId: z.string(),
  service: z.string(),
  date: z.string().regex(/\d{4}-\d{2}-\d{2}/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  duration: z.number().int().positive(),
  status: bookingStatusSchema,
  notes: z.string().optional(),
});
export const insertBookingSchema = bookingSchema
  .omit({ id: true, masterName: true, masterTelegram: true, service: true, status: true, duration: true })
  .extend({ status: bookingStatusSchema.optional() });

export const botMessageSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  value: z.string(),
  type: z.enum(["text", "textarea"]),
});

export const settingsSchema = z.object({
  botToken: z.string().default(""),
  studioName: z.string().min(1),
  address: z.string().min(1),
  yandexMapUrl: z.string().optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  paymentMethods: z.string().default(""),
  workingHours: z.string().default(""),
});

export const botActionSchema = z.enum(["none", "start", "restart", "stop"]);

export const portfolioItemSchema = z.object({
  id: z.string(),
  url: z.string().min(1).refine(v => v.startsWith("http") || v.startsWith("/uploads/"), "Invalid url"),
  title: z.string().min(1),
  masterId: z.string().optional().nullable(),
  style: z.string().optional().nullable(),
  thumbnail: z
    .string()
    .optional()
    .nullable()
    .refine(
      (v) => !v || v.startsWith("http") || v.startsWith("/uploads/"),
      "Invalid thumbnail url",
    ),
  mediaType: z.enum(["image", "video"]).default("image"),
  createdAt: z.string().optional(),
});

export const portfolioFilterMasterSchema = z.object({
  id: z.string(),
  name: z.string(),
  nickname: z.string(),
});

export const portfolioFiltersSchema = z.object({
  masters: z.array(portfolioFilterMasterSchema),
  styles: z.array(z.string()),
});

export const botMasterSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  nickname: z.string(),
  specialization: z.string(),
  avatar: z
    .string()
    .optional()
    .refine((value) => !value || value.startsWith("http") || value.startsWith("/uploads/"), "Invalid avatar url"),
  telegram: z.string().optional(),
});

export const botAvailabilitySlotSchema = z.object({
  time: z.string().regex(/^\d{2}:\d{2}$/),
  masters: z.array(botMasterSummarySchema),
});

export const botAvailabilityDaySchema = z.object({
  date: z.string().regex(/\d{4}-\d{2}-\d{2}/),
  label: z.string(),
  weekday: z.string(),
  weekdayShort: z.string(),
  slots: z.array(botAvailabilitySlotSchema),
});

export const botBookingRequestSchema = z.object({
  clientName: z.string().min(1),
  clientPhone: z.string().min(5),
  clientTelegram: z.string().optional(),
  serviceId: z.string().uuid(),
  masterId: z.string().uuid(),
  date: z.string().regex(/\d{4}-\d{2}-\d{2}/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  notes: z.string().optional(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Master = z.infer<typeof masterSchema>;
export type InsertMaster = z.infer<typeof insertMasterSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type InsertService = z.infer<typeof insertServiceSchema>;
export type Booking = z.infer<typeof bookingSchema>;
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type BotMessage = z.infer<typeof botMessageSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type PortfolioItem = z.infer<typeof portfolioItemSchema>;
export type PortfolioFilterMaster = z.infer<typeof portfolioFilterMasterSchema>;
export type PortfolioFilters = z.infer<typeof portfolioFiltersSchema>;
export type BotAction = z.infer<typeof botActionSchema>;
export type BotMasterSummary = z.infer<typeof botMasterSummarySchema>;
export type BotAvailabilitySlot = z.infer<typeof botAvailabilitySlotSchema>;
export type BotAvailabilityDay = z.infer<typeof botAvailabilityDaySchema>;
export type BotBookingRequest = z.infer<typeof botBookingRequestSchema>;
