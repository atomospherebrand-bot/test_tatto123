import {
  type Master,
  type Service,
  type Booking,
  type BotMessage,
  type Settings,
  type PortfolioItem,
  type PortfolioFilters,
  type BotAction,
  insertMasterSchema,
  insertServiceSchema,
  insertBookingSchema,
  botMessageSchema,
  settingsSchema,
  portfolioItemSchema,
} from "@shared/schema";

const BASE_URL = "/api";

type UploadResponse = { url: string; mediaType: "image" | "video"; thumbnail?: string };

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${input}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    credentials: "same-origin",
    ...init,
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      const parsed = JSON.parse(text);
      message = parsed.message ?? text;
    } catch {}
    throw new Error(message || `Request failed with status ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function uploadFile(file: File, options?: { thumbnail?: File | null; fullResponse?: false }): Promise<string>;
async function uploadFile(
  file: File,
  options: { thumbnail?: File | null; fullResponse: true }
): Promise<UploadResponse>;
async function uploadFile(
  file: File,
  options?: { thumbnail?: File | null; fullResponse?: boolean }
): Promise<string | UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (options?.thumbnail) {
    formData.append("thumbnail", options.thumbnail);
  }

  const response = await fetch(`${BASE_URL}/upload`, { method: "POST", body: formData });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Ошибка загрузки файла");
  }

  const data = (await response.json()) as UploadResponse;
  if (options?.fullResponse) {
    return data;
  }
  return data.url;
}

export const api = {
  uploadFile,

  // … оставшиеся методы без изменений …

  async getPortfolio(params: { masterId?: string; style?: string; q?: string; page?: number; pageSize?: number } = {}) {
    const query = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([_, v]) => v !== undefined && v !== ""))
    );
    return request<{
      portfolio: (PortfolioItem & {
        mediaType?: string;
        masterName?: string | null;
      })[];
      total: number;
      totalPages: number;
      page: number;
      pageSize: number;
    }>(`/portfolio?${query.toString()}`);
  },

  async getPortfolioFilters() {
    return request<PortfolioFilters>(`/portfolio/filters`);
  },

  async addPortfolioItem(payload: {
    url: string;
    title: string;
    masterId?: string;
    style?: string;
    mediaType?: "image" | "video";
    thumbnail?: string | null;
  }) {
    const body = { ...payload };
    return request<{ item: PortfolioItem }>(`/portfolio`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  async deletePortfolioItem(id: string) {
    await request<void>(`/portfolio/${id}`, { method: "DELETE" });
  },
};