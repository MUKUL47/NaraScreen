// ─── flutter plugin: script contract ─────────────────────────────────
//
// Only zod and plain data here — schema.ts imports this file (never the other
// way round), so the plugin's fields show up in the JSON Schema and the docs.

import { z } from "zod";

/** Phone presets: CSS size, pixel ratio (the video is recorded at CSS × ratio). */
export const FLUTTER_DEVICES = {
  "pixel-7": { width: 412, height: 915, pixelRatio: 2.625, model: "Pixel 7" },
  "pixel-9-pro": { width: 427, height: 952, pixelRatio: 3, model: "Pixel 9 Pro" },
  "galaxy-s24": { width: 360, height: 780, pixelRatio: 3, model: "SM-S921B" },
  "small-phone": { width: 360, height: 640, pixelRatio: 2, model: "Android Phone" },
} as const;
export type FlutterDeviceName = keyof typeof FLUTTER_DEVICES;
export const DEFAULT_FLUTTER_DEVICE: FlutterDeviceName = "pixel-7";

export interface FlutterDevice {
  width: number;
  height: number;
  pixelRatio: number;
}

export interface FlutterPluginOptions {
  device?: FlutterDeviceName | FlutterDevice;
  /** Turn on Flutter's accessibility tree automatically (default true). */
  semantics?: boolean;
}

export const FlutterPluginSchema = z
  .object({
    device: z
      .union([
        z.enum(Object.keys(FLUTTER_DEVICES) as [FlutterDeviceName, ...FlutterDeviceName[]]),
        z
          .object({
            width: z.number().int().min(240).max(1024).describe("Screen width in CSS px (e.g. 412)."),
            height: z.number().int().min(320).max(1400).describe("Screen height in CSS px (e.g. 915)."),
            pixelRatio: z.number().min(1).max(4).describe("Device pixel ratio (e.g. 2.625). The video is recorded at width×ratio by height×ratio."),
          })
          .strict(),
      ])
      .optional()
      .describe(`Phone to emulate: ${Object.keys(FLUTTER_DEVICES).join(" | ")} (default ${DEFAULT_FLUTTER_DEVICE}), or {width, height, pixelRatio}.`),
    semantics: z
      .boolean()
      .optional()
      .describe("Turn on Flutter's accessibility tree automatically so role/label/text selectors work (default true). Set false only if the app already enables it itself."),
  })
  .strict()
  .describe("Record a Flutter web build as an Android phone: touch input, mobile user agent, phone-sized screen, portrait video.");

export const SWIPE_DIRECTIONS = ["up", "down", "left", "right"] as const;

/** Fields of the `swipe` act (its selector keys come from schema.ts). */
export function swipeFields(selector: z.ZodTypeAny) {
  return {
    direction: z
      .enum(SWIPE_DIRECTIONS)
      .describe("Finger direction: up = scroll down to later content, down = scroll back up, left = next page/card, right = previous."),
    distance: z.number().min(0.1).max(1).optional().describe("How far the finger travels, as a fraction of the area (default 0.6)."),
    durationMs: z.number().int().min(100).max(3000).optional().describe("How long the finger takes (default 400). Faster = a longer fling."),
    to: selector.optional().describe("Keep swiping until this element is on screen (then it is centred). Its box becomes the target of following fx."),
    maxSwipes: z.number().int().min(1).max(30).optional().describe("With `to`: give up after this many swipes (default 10)."),
  };
}
