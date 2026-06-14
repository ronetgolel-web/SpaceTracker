import type { AssetClass } from "@prisma/client";
import { Request, Response } from "express";
import * as orbitalService from "../services/orbital.service.js";
import { runSyncJob } from "../jobs/sync.job.js";

export async function listAssets(req: Request, res: Response) {
  const catalogNumber = optionalNumber(req.query.catalogNumber);
  const assetClass = optionalAssetClass(req.query.assetClass);
  const search = optionalString(req.query.search);
  res.json(await orbitalService.listAssets({ search, catalogNumber, assetClass }));
}

export async function getAsset(req: Request, res: Response) {
  res.json(await orbitalService.getAssetByCatalogNumber(requiredCatalogNumber(req)));
}

export async function getPosition(req: Request, res: Response) {
  res.json(await orbitalService.getCurrentPosition(requiredCatalogNumber(req)));
}

export async function getGlobeAssets(req: Request, res: Response) {
  res.json(await orbitalService.getGlobeAssets(optionalNumber(req.query.limit) ?? 25_000));
}

export async function getPasses(req: Request, res: Response) {
  const latitude = requiredNumber(req.query.latitude, "latitude");
  const longitude = requiredNumber(req.query.longitude, "longitude");
  const hoursAhead = optionalNumber(req.query.hoursAhead) ?? 24;
  res.json(await orbitalService.predictPasses(requiredCatalogNumber(req), { latitude, longitude }, hoursAhead));
}

export async function getOverhead(req: Request, res: Response) {
  const latitude = requiredNumber(req.query.latitude, "latitude");
  const longitude = requiredNumber(req.query.longitude, "longitude");
  const minimumElevation = optionalNumber(req.query.minimumElevation) ?? 10;
  res.json(await orbitalService.getOverheadAssets({ latitude, longitude, minimumElevation }));
}

export async function getObservations(req: Request, res: Response) {
  res.json(await orbitalService.listObservations(optionalNumber(req.query.limit) ?? 100));
}

export async function getVisibilityWindows(req: Request, res: Response) {
  res.json(await orbitalService.listVisibilityWindows(optionalNumber(req.query.limit) ?? 100));
}

export async function runSync(_req: Request, res: Response) {
  res.json(await runSyncJob());
}

function requiredCatalogNumber(req: Request) {
  return requiredNumber(req.params.catalogNumber, "catalogNumber");
}

function requiredNumber(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw Object.assign(new Error(`${field} must be a number`), { statusCode: 400 });
  return parsed;
}

function optionalNumber(value: unknown) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw Object.assign(new Error("Invalid numeric query parameter"), { statusCode: 400 });
  return parsed;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalAssetClass(value: unknown) {
  if (value === undefined) return undefined;
  const valid = ["DEBRIS", "WEATHER", "COMMUNICATION", "NAVIGATION", "EARTH_OBSERVATION", "UNKNOWN", "OTHER", "CREWED"];
  if (typeof value !== "string" || !valid.includes(value)) {
    throw Object.assign(new Error("assetClass is invalid"), { statusCode: 400 });
  }
  return value as AssetClass;
}
