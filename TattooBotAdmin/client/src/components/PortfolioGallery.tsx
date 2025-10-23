import React from "react";

type Item = {
  id: string;
  url: string;
  title: string;
  mediaType?: "image" | "video";
  masterId?: string | null;
  masterName?: string | null;
  style?: string | null;
  thumbnail?: string | null;
};

type Props = {
  items: Item[];
  onDelete: (id: string) => void;
};

export default function PortfolioGallery({ items, onDelete }: Props) {
  if (!items?.length) return <div className="text-sm text-gray-500">Пока нет работ</div>;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {items.map((it) => {
        const normalizedType = (it.mediaType ?? "image") as "image" | "video";
        const isVideo =
          normalizedType === "video" || /\.(mp4|mov|mkv|webm)$/i.test(it.url ?? "");
        return (
          <div key={it.id} className="border rounded-lg overflow-hidden">
            <div className="aspect-square bg-black/5 flex items-center justify-center relative">
              {isVideo ? (
                <video
                  src={it.url}
                  controls
                  poster={it.thumbnail ?? undefined}
                  className="w-full h-full object-cover"
                />
              ) : (
                <img src={it.url} alt={it.title} className="w-full h-full object-cover" />
              )}
              {isVideo && (
                <span className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white">
                  Видео
                </span>
              )}
            </div>
          <div className="p-2">
            <div className="text-sm font-medium">{it.title}</div>
            {(it.masterName || it.style) && (
              <div className="text-xs text-gray-500">
                {it.masterName ? it.masterName : ""} {it.style ? `• ${it.style}` : ""}
              </div>
            )}
            <div className="flex justify-end mt-2">
              <button className="text-xs text-red-600" onClick={()=>onDelete(it.id)}>Удалить</button>
            </div>
          </div>
        </div>
        );
      })}
    </div>
  );
}