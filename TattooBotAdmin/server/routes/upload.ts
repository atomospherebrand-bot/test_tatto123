import { Router } from "express";
import path from "path";
import { upload } from "../middleware/upload";

const router = Router();

const uploadFields = upload.fields([
  { name: "file", maxCount: 1 },
  { name: "thumbnail", maxCount: 1 },
]);

function toPublicUrl(file: Express.Multer.File | undefined): string | undefined {
  if (!file) return undefined;
  const filename = path.basename(file.path);
  return `/uploads/${filename}`;
}

/**
 * POST /api/upload
 * multipart/form-data с обязательным полем "file" и опциональным "thumbnail".
 * Возвращает { url, mediaType, thumbnail? }.
 */
router.post("/upload", uploadFields, (req, res) => {
  const files = (req as any).files as Record<string, Express.Multer.File[]> | undefined;
  const mainFile = files?.file?.[0] ?? (req as any).file;
  if (!mainFile) {
    return res
      .status(400)
      .json({ message: "Файл не получен (формат multipart/form-data, поле 'file')." });
  }

  const mediaType = String(mainFile.mimetype || "").startsWith("video/") ? "video" : "image";
  const payload: { url: string; mediaType: "image" | "video"; thumbnail?: string } = {
    url: toPublicUrl(mainFile)!,
    mediaType,
  };

  const thumbFile = files?.thumbnail?.[0];
  const thumbnailUrl = toPublicUrl(thumbFile);
  if (thumbnailUrl) {
    payload.thumbnail = thumbnailUrl;
  }

  res.json(payload);
});

export default router;
