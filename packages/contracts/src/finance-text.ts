import { z } from "zod";
import { stripInvisibleControls } from "./common.ts";

/** Shared by finance requests without importing their barrel and creating a dependency cycle. */
export const text = (max: number) =>
  z
    .string()
    .transform(stripInvisibleControls)
    .pipe(z.string().trim().max(max, "validation.tooLong"));

/** A written reason must remain visible after stripping controls and trimming whitespace. */
export const requiredText = (max: number) =>
  text(max).pipe(z.string().min(1, "validation.required"));
