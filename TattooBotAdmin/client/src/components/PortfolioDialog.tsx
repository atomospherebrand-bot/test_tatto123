import React from "react";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export default function PortfolioDialog({ open, onClose, onSaved }: Props) {
  const { data: filters } = useQuery({
    queryKey: ["portfolio-filters"],
    queryFn: () => api.getPortfolioFilters(),
  });

  const masters = filters?.masters ?? [];
  const styleSuggestions = filters?.styles ?? [];

  const [title, setTitle] = React.useState("");
  const [style, setStyle] = React.useState("");
  const [masterId, setMasterId] = React.useState<string | undefined>(undefined);
  const [mediaType, setMediaType] = React.useState<"image" | "video">("image");
  const [file, setFile] = React.useState<File | null>(null);
  const [url, setUrl] = React.useState("");
  const [thumbnailFile, setThumbnailFile] = React.useState<File | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setTitle("");
      setStyle("");
      setMasterId(undefined);
      setMediaType("image");
      setFile(null);
      setUrl("");
      setThumbnailFile(null);
      setThumbnailUrl("");
      setIsSubmitting(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const handleFileChange = (nextFile: File | null) => {
    setFile(nextFile);
    if (nextFile) {
      if (nextFile.type.startsWith("video/")) {
        setMediaType("video");
      } else if (mediaType === "video") {
        setMediaType("image");
      }
      setUrl("");
    }
  };

  const handleThumbnailFileChange = (nextFile: File | null) => {
    setThumbnailFile(nextFile);
    if (nextFile) {
      setThumbnailUrl("");
    }
  };

  const submit = async () => {
    try {
      setIsSubmitting(true);
      setError(null);

      let finalUrl = url.trim();
      let finalMediaType: "image" | "video" = mediaType;
      let finalThumbnail = thumbnailUrl.trim() || undefined;

      if (!finalUrl && file) {
        const uploaded = await api.uploadFile(file, {
          thumbnail: thumbnailFile,
          fullResponse: true,
        });
        finalUrl = uploaded.url;
        finalMediaType = uploaded.mediaType ?? finalMediaType;
        if (uploaded.thumbnail) {
          finalThumbnail = uploaded.thumbnail;
        }
      } else if (!finalThumbnail && thumbnailFile) {
        const uploadedThumb = await api.uploadFile(thumbnailFile, { fullResponse: true });
        finalThumbnail = uploadedThumb.url;
      }

      if (!finalUrl) {
        throw new Error("Выбери файл или укажи URL");
      }

      await api.addPortfolioItem({
        url: finalUrl,
        title: title.trim() || "Работа",
        style: style.trim() || undefined,
        masterId,
        mediaType: finalMediaType,
        thumbnail: finalThumbnail,
      });

      onSaved();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось сохранить работу";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-4 w-full max-w-2xl shadow-xl">
        <h3 className="text-lg font-semibold mb-3">Добавить работу</h3>

        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              className="border rounded px-3 py-2 flex-1"
              placeholder="Название"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <select
              className="border rounded px-3 py-2 sm:w-36"
              value={mediaType}
              onChange={(e) => {
                const next = e.target.value as "image" | "video";
                setMediaType(next);
                if (next === "image") {
                  setThumbnailFile(null);
                  setThumbnailUrl("");
                }
              }}
            >
              <option value="image">Фото</option>
              <option value="video">Видео</option>
            </select>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <select
              className="border rounded px-3 py-2 flex-1"
              value={masterId || ""}
              onChange={(e) => setMasterId(e.target.value || undefined)}
            >
              <option value="">Без мастера</option>
              {masters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nickname || m.name}
                </option>
              ))}
            </select>

            <div className="flex-1">
              <input
                className="border rounded px-3 py-2 w-full"
                placeholder="Стиль / теги"
                list="portfolio-dialog-styles"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
              />
              <datalist id="portfolio-dialog-styles">
                {styleSuggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Файл или ссылка
            </span>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="file"
                accept="image/*,video/*"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              />
              <span className="text-sm text-gray-500 sm:px-1">или</span>
              <input
                className="border rounded px-3 py-2 flex-1"
                placeholder="URL (http… или /uploads/…)"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            {file && (
              <p className="text-xs text-gray-500">
                Загруженный файл будет отправлен при сохранении. Тип определится автоматически.
              </p>
            )}
          </div>

          {mediaType === "video" && (
            <div className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Превью для видео (опционально)
              </span>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleThumbnailFileChange(e.target.files?.[0] ?? null)}
                />
                <span className="text-sm text-gray-500 sm:px-1">или</span>
                <input
                  className="border rounded px-3 py-2 flex-1"
                  placeholder="URL обложки"
                  value={thumbnailUrl}
                  onChange={(e) => setThumbnailUrl(e.target.value)}
                />
              </div>
              <p className="text-xs text-gray-500">
                Обложка будет показана до старта воспроизведения. Если не указать, Telegram и веб покажут первый кадр.
              </p>
            </div>
          )}

          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className="px-3 py-2 rounded border" onClick={onClose} disabled={isSubmitting}>
            Отмена
          </button>
          <button
            className="px-3 py-2 rounded bg-black text-white disabled:opacity-50"
            onClick={submit}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}