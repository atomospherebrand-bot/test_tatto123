import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import PortfolioFilters from "@/components/PortfolioFilters";
import PortfolioDialog from "@/components/PortfolioDialog";
import PortfolioGallery from "@/components/PortfolioGallery";

export default function Portfolio() {
  const qc = useQueryClient();
  const [filters, setFilters] = React.useState<{ masterId?: string; style?: string; q?: string }>(
    {}
  );
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState(false);
  const pageSize = 24;

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["portfolio", filters, page],
    queryFn: () => api.getPortfolio({ ...filters, page, pageSize }),
    keepPreviousData: true,
  });

  const refresh = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["portfolio"] });
    qc.invalidateQueries({ queryKey: ["portfolio-filters"] });
  }, [qc]);

  const handleResetFilters = React.useCallback(() => {
    setFilters({});
    setPage(1);
  }, []);

  const totalPages = data?.totalPages ?? 0;
  const currentPage = data?.page ?? page;

  return (
    <div className="p-4 space-y-4">
      <PortfolioFilters
        value={filters}
        onChange={(v) => {
          setFilters(v);
          setPage(1);
        }}
        onAdd={() => setOpen(true)}
        onReset={handleResetFilters}
      />

      {isLoading && <div>Загрузка…</div>}
      {isError && <div className="text-red-500">{(error as any)?.message || "Ошибка"}</div>}

      {data && (
        <>
          <PortfolioGallery
            items={data.portfolio}
            onDelete={async (id) => {
              await api.deletePortfolioItem(id);
              refresh();
            }}
          />

          {isFetching && !isLoading && (
            <div className="text-xs text-gray-500">Обновляем список…</div>
          )}

          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-gray-500">
              Показано {data.portfolio.length} из {data.total}. Страница {currentPage} из {Math.max(totalPages, 1)}
            </span>
            <div className="flex gap-2">
              <button
                className="px-2 py-1 border rounded disabled:opacity-50"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                ← Назад
              </button>
              <button
                className="px-2 py-1 border rounded disabled:opacity-50"
                onClick={() => {
                  if (totalPages === 0 || page >= totalPages) return;
                  setPage((p) => p + 1);
                }}
                disabled={totalPages === 0 || page >= totalPages}
              >
                Далее →
              </button>
            </div>
          </div>
        </>
      )}

      <PortfolioDialog
        open={open}
        onClose={() => setOpen(false)}
        onSaved={refresh}
      />
    </div>
  );
}