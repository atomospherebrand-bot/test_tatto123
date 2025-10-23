import {
  type Master,
  type Service,
  type Booking,
  type BotMessage,
  type Settings,
  type PortfolioItem,
  type PortfolioFilters,
  type BotAction,
  botMessageSchema,
  settingsSchema,
} from "@shared/schema";

const BASE_URL = "/api";

type UploadResponse = { url: string; mediaType: "image" | "video"; thumbnail?: string };

const requireString = (value: string | undefined, message: string): string => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Error(message);
  }
  return trimmed;
};

const optionalString = (value: string | null | undefined): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const nullableString = (value: string | null | undefined): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const ensureNumber = (value: unknown, message: string): number => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(message);
  }
  return numeric;
};

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

  async getMasters() {
    const { masters } = await request<{ masters: Master[] }>("/masters");
    return masters;
  },

  async createMaster(payload: Partial<Master>) {
    const body = {
      name: requireString(payload.name, "Укажите имя мастера"),
      nickname: requireString(payload.nickname, "Укажите псевдоним мастера"),
      telegram: optionalString(payload.telegram ?? undefined),
      specialization: requireString(payload.specialization, "Укажите специализацию мастера"),
      avatar: optionalString(payload.avatar ?? undefined),
      isActive: payload.isActive ?? true,
    } satisfies Partial<Master>;
    const { master } = await request<{ master: Master }>("/masters", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return master;
  },

  async updateMaster(id: string, payload: Partial<Master>) {
    const body: Record<string, unknown> = {};
    if (payload.name !== undefined) body.name = requireString(payload.name, "Имя мастера не может быть пустым");
    if (payload.nickname !== undefined)
      body.nickname = requireString(payload.nickname, "Псевдоним мастера не может быть пустым");
    if (payload.specialization !== undefined)
      body.specialization = requireString(payload.specialization, "Специализация не может быть пустой");
    if (payload.telegram !== undefined) body.telegram = nullableString(payload.telegram ?? undefined);
    if (payload.avatar !== undefined) body.avatar = nullableString(payload.avatar ?? undefined);
    if (payload.isActive !== undefined) body.isActive = payload.isActive;
    const { master } = await request<{ master: Master }>(`/masters/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return master;
  },

  async deleteMaster(id: string) {
    await request<void>(`/masters/${id}`, { method: "DELETE" });
  },

  async getServices() {
    const { services } = await request<{ services: Service[] }>("/services");
    return services;
  },

  async createService(payload: Partial<Service>) {
    const body = {
      name: requireString(payload.name, "Укажите название услуги"),
      duration: ensureNumber(payload.duration, "Укажите длительность услуги"),
      price: ensureNumber(payload.price, "Укажите стоимость услуги"),
      description: (payload.description ?? "").toString(),
    } satisfies Partial<Service>;
    const { service } = await request<{ service: Service }>("/services", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return service;
  },

  async updateService(id: string, payload: Partial<Service>) {
    const body: Record<string, unknown> = {};
    if (payload.name !== undefined) body.name = requireString(payload.name, "Название услуги не может быть пустым");
    if (payload.duration !== undefined) body.duration = ensureNumber(payload.duration, "Неверная длительность услуги");
    if (payload.price !== undefined) body.price = ensureNumber(payload.price, "Неверная стоимость услуги");
    if (payload.description !== undefined) body.description = payload.description.toString();
    const { service } = await request<{ service: Service }>(`/services/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return service;
  },

  async deleteService(id: string) {
    await request<void>(`/services/${id}`, { method: "DELETE" });
  },

  async getBookings() {
    const { bookings } = await request<{ bookings: Booking[] }>("/bookings");
    return bookings;
  },

  async createBooking(payload: Partial<Booking>) {
    const body = {
      clientName: requireString(payload.clientName, "Укажите имя клиента"),
      clientPhone: requireString(payload.clientPhone, "Укажите телефон клиента"),
      clientTelegram: optionalString(payload.clientTelegram ?? undefined),
      masterId: requireString(payload.masterId, "Укажите мастера"),
      serviceId: requireString(payload.serviceId, "Укажите услугу"),
      date: requireString(payload.date, "Укажите дату"),
      time: requireString(payload.time, "Укажите время"),
      notes: optionalString(payload.notes ?? undefined),
      status: payload.status,
    } satisfies Record<string, unknown>;
    const { booking } = await request<{ booking: Booking }>("/bookings", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return booking;
  },

  async updateBooking(id: string, payload: Partial<Booking>) {
    const body: Record<string, unknown> = {};
    if (payload.clientName !== undefined) body.clientName = requireString(payload.clientName, "Имя клиента не может быть пустым");
    if (payload.clientPhone !== undefined)
      body.clientPhone = requireString(payload.clientPhone, "Телефон клиента не может быть пустым");
    if (payload.clientTelegram !== undefined) body.clientTelegram = nullableString(payload.clientTelegram ?? undefined);
    if (payload.masterId !== undefined) body.masterId = requireString(payload.masterId, "Мастер обязателен");
    if (payload.serviceId !== undefined) body.serviceId = requireString(payload.serviceId, "Услуга обязательна");
    if (payload.date !== undefined) body.date = requireString(payload.date, "Дата обязательна");
    if (payload.time !== undefined) body.time = requireString(payload.time, "Время обязательно");
    if (payload.notes !== undefined) body.notes = nullableString(payload.notes ?? undefined);
    if (payload.status !== undefined) body.status = payload.status;
    const { booking } = await request<{ booking: Booking }>(`/bookings/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return booking;
  },

  async updateBookingStatus(id: string, status: Booking["status"]) {
    const { booking } = await request<{ booking: Booking }>(`/bookings/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    return booking;
  },

  async deleteBooking(id: string) {
    await request<void>(`/bookings/${id}`, { method: "DELETE" });
  },

  async getAvailability(params: { masterId: string; serviceId: string; date: string }) {
    const search = new URLSearchParams(params);
    const { slots } = await request<{ slots: string[] }>(`/availability?${search.toString()}`);
    return slots;
  },

  async getMessages() {
    const { messages } = await request<{ messages: BotMessage[] }>("/messages");
    return messages;
  },

  async saveMessages(messages: BotMessage[]) {
    const validated = botMessageSchema.array().parse(messages);
    const { messages: saved } = await request<{ messages: BotMessage[] }>("/messages", {
      method: "PUT",
      body: JSON.stringify({ messages: validated }),
    });
    return saved;
  },

  async getSettings() {
    const { settings } = await request<{ settings: Settings }>("/settings");
    return settings;
  },

  async saveSettings(settings: Settings) {
    const body = settingsSchema.parse(settings);
    return request<{ settings: Settings; botRestarted: boolean; botAction: BotAction; botRestartMessage?: string }>(
      `/settings`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    );
  },

  async getDashboard() {
    return request<{
      stats: { bookingsToday: number; activeMasters: number; revenueWeek: number; averageDuration: number };
      recentBookings: Booking[];
    }>("/dashboard");
  },

  async importExcel(file: File) {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${BASE_URL}/excel/import`, { method: "POST", body: formData });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Не удалось импортировать Excel файл");
    }

    return (await response.json()) as { imported: number; skipped: number };
  },

  async exportExcel(params: { from?: string; to?: string }) {
    const search = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== "")),
    );
    const url = `/excel/export${search.toString() ? `?${search.toString()}` : ""}`;
    const response = await fetch(`${BASE_URL}${url}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Не удалось экспортировать данные");
    }
    return await response.blob();
  },

  async getPortfolio(params: { masterId?: string; style?: string; q?: string; page?: number; pageSize?: number } = {}) {
    const query = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([_, v]) => v !== undefined && v !== "")),
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
    const body = {
      url: requireString(payload.url, "Укажите ссылку на файл"),
      title: requireString(payload.title, "Укажите название работы"),
      masterId: optionalString(payload.masterId) ?? undefined,
      style: optionalString(payload.style) ?? undefined,
      mediaType: payload.mediaType ?? "image",
      thumbnail: nullableString(payload.thumbnail ?? undefined),
    };
    const { item } = await request<{ item: PortfolioItem }>(`/portfolio`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return item;
  },

  async deletePortfolioItem(id: string) {
    await request<void>(`/portfolio/${id}`, { method: "DELETE" });
  },
};