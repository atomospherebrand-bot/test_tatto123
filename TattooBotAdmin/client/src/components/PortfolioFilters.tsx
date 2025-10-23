import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

type Props = {
  value: { masterId?: string; style?: string; q?: string };
  onChange: (v: Props["value"]) => void;
  onAdd: () => void;
  onReset: () => void;
};

export default function PortfolioFilters({ value, onChange, onAdd, onReset }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["portfolio-filters"],
    queryFn: () => api.getPortfolioFilters(),
  });

  const masters = data?.masters ?? [];
  const styles = data?.styles ?? [];

  const hasActiveFilters = Boolean(value.masterId || value.style || value.q);

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <select
        className="border rounded px-2 py-1 min-w-[180px]"
        value={value.masterId || ""}
        onChange={(e) => onChange({ ...value, masterId: e.target.value || undefined })}
        disabled={isLoading}
      >
        <option value="">Все мастера</option>
        {masters.map((m) => (
          <option key={m.id} value={m.id}>
            {m.nickname || m.name}
          </option>
        ))}
      </select>

      <div className="relative">
        <input
          className="border rounded px-2 py-1"
          placeholder="Стиль"
          value={value.style || ""}
          list="portfolio-style-options"
          onChange={(e) => onChange({ ...value, style: e.target.value || undefined })}
        />
        <datalist id="portfolio-style-options">
          {styles.map((style) => (
            <option key={style} value={style} />
          ))}
        </datalist>
      </div>

      <input
        className="border rounded px-2 py-1 flex-1 min-w-[180px]"
        placeholder="Поиск по названию"
        value={value.q || ""}
        onChange={(e) => onChange({ ...value, q: e.target.value || undefined })}
      />

      <div className="ml-auto flex gap-2">
        <button
          className="rounded px-3 py-2 border text-sm disabled:opacity-50"
          onClick={onReset}
          disabled={!hasActiveFilters}
        >
          Сброс
        </button>
        <button
          className="rounded px-3 py-2 bg-black text-white text-sm"
          onClick={onAdd}
        >
          Загрузить работу
        </button>
      </div>
    </div>
  );
}