import type { AssetClass, IlluminationState } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { deg2rad, normalizeLongitude, rad2deg, satellite } from "../lib/satellite.js";
import { getLatestTleByCatalogNumber } from "./tle.service.js";

type Observer = { latitude: number; longitude: number; minimumElevation?: number };

export async function listAssets(filters: { search?: string; catalogNumber?: number; assetClass?: AssetClass }) {
  return prisma.orbitalAsset.findMany({
    where: {
      catalogNumber: filters.catalogNumber,
      assetClass: filters.assetClass,
      displayName: filters.search ? { contains: filters.search, mode: "insensitive" } : undefined,
    },
    orderBy: [{ updatedAt: "desc" }, { catalogNumber: "asc" }],
    take: 250,
  });
}

export async function getAssetByCatalogNumber(catalogNumber: number) {
  const asset = await prisma.orbitalAsset.findUnique({ where: { catalogNumber } });
  if (!asset) throw new Error("Satellite not found");
  return asset;
}

export async function getCurrentPosition(catalogNumber: number, at = new Date()) {
  const tle = await getLatestTleByCatalogNumber(catalogNumber);
  if (!tle) throw new Error("No TLE available");

  const { satrec, position, velocity } = propagateTle(tle.line1, tle.line2, at);
  const gmst = satellite.gstime(at);
  const geo = satellite.eciToGeodetic(position, gmst);
  const velocityKmps = magnitude(velocity);

  return {
    catalogNumber: tle.catalogNumber,
    name: tle.name,
    latitude: satellite.degreesLat(geo.latitude),
    longitude: normalizeLongitude(satellite.degreesLong(geo.longitude)),
    altitudeKm: geo.height,
    velocityKmps,
    inclinationDeg: rad2deg(satrec.inclo),
    timestamp: at.toISOString(),
  };
}

export async function getGlobeAssets(limit = 25_000, at = new Date()) {
  const assets = await prisma.orbitalAsset.findMany({
    where: { orbitalEpoch: { not: null } },
    select: {
      catalogNumber: true,
      displayName: true,
      assetClass: true,
      operatorName: true,
      originCountry: true,
      updatedAt: true,
      elementArchive: {
        orderBy: { epochTimestamp: "desc" },
        take: 1,
        select: { elementLine1: true, elementLine2: true, epochTimestamp: true },
      },
    },
    orderBy: { catalogNumber: "asc" },
    take: Math.min(Math.max(limit, 1), 25_000),
  });

  const gmst = satellite.gstime(at);
  return {
    timestamp: at.toISOString(),
    assets: assets.flatMap((asset) => {
      const tle = asset.elementArchive[0];
      if (!tle) return [];
      try {
        const { position, velocity } = propagateTle(tle.elementLine1, tle.elementLine2, at);
        const gmst = satellite.gstime(at);
        const geo = satellite.eciToGeodetic(position, gmst);

        const atPlus1 = new Date(at.getTime() + 1000);
        const { position: pos2 } = propagateTle(tle.elementLine1, tle.elementLine2, atPlus1);
        const gmst2 = satellite.gstime(atPlus1);
        
        const ecf1 = satellite.eciToEcf(position, gmst);
        const ecf2 = satellite.eciToEcf(pos2, gmst2);
        
        const velocityEcf = {
          x: ecf2.x - ecf1.x,
          y: ecf2.y - ecf1.y,
          z: ecf2.z - ecf1.z,
        };

        return [{
          catalogNumber: asset.catalogNumber,
          name: asset.displayName,
          assetClass: asset.assetClass,
          operatorName: asset.operatorName,
          originCountry: asset.originCountry,
          latitude: satellite.degreesLat(geo.latitude),
          longitude: normalizeLongitude(satellite.degreesLong(geo.longitude)),
          altitudeKm: geo.height,
          velocityKmps: magnitude(velocity),
          velocityEcf,
          updatedAt: asset.updatedAt.toISOString(),
          tleEpoch: tle.epochTimestamp.toISOString(),
        }];
      } catch {
        return [];
      }
    }),
  };
}

export async function getCurrentVelocity(catalogNumber: number, at = new Date()) {
  const tle = await getLatestTleByCatalogNumber(catalogNumber);
  if (!tle) throw new Error("No TLE available");
  const { velocity } = propagateTle(tle.line1, tle.line2, at);
  return { catalogNumber, velocityKmps: velocity, speedKmps: magnitude(velocity), timestamp: at.toISOString() };
}

export async function getOrbitalInformation(catalogNumber: number) {
  const asset = await getAssetByCatalogNumber(catalogNumber);
  const position = await getCurrentPosition(catalogNumber);
  return { asset, position };
}

export async function listObservations(limit = 100) {
  return prisma.observationLog.findMany({
    select: {
      logId: true,
      observerId: true,
      assetId: true,
      observationTime: true,
      trackingDurationSeconds: true,
      signalQuality: true,
      remarks: true,
      createdAt: true,
    },
    orderBy: { observationTime: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
  });
}

export async function listVisibilityWindows(limit = 100) {
  return prisma.visibilityWindow.findMany({
    include: {
      asset: true,
      observer: true,
    },
    orderBy: { acquisitionTime: "asc" },
    take: Math.min(Math.max(limit, 1), 500),
  });
}

export async function getOverheadAssets(observer: Required<Observer>) {
  const assets = await prisma.orbitalAsset.findMany({
    where: { orbitalEpoch: { not: null } },
    include: { elementArchive: { orderBy: { epochTimestamp: "desc" }, take: 1 } },
    take: 1000,
  });
  const now = new Date();
  const visible = [];

  for (const asset of assets) {
    const tle = asset.elementArchive[0];
    if (!tle) continue;
    try {
      const lookAngles = lookAnglesFromTle(tle.elementLine1, tle.elementLine2, observer, now);
      if (lookAngles.elevation >= observer.minimumElevation) {
        visible.push({ asset, ...lookAngles, timestamp: now.toISOString() });
      }
    } catch {
      continue;
    }
  }

  return visible.sort((a, b) => b.elevation - a.elevation);
}

export async function predictPasses(catalogNumber: number, observer: Observer, hoursAhead: number) {
  const tle = await getLatestTleByCatalogNumber(catalogNumber);
  if (!tle) throw new Error("No TLE available");

  const minimumElevation = observer.minimumElevation ?? 10;
  const stepMs = 30_000;
  const end = Date.now() + hoursAhead * 3_600_000;
  const passes = [];
  let active: { acquisitionTime: Date; maxElevation: number; azimuthAtMax: number } | null = null;
  let previousAzimuth = 0;

  for (let time = Date.now(); time <= end; time += stepMs) {
    const at = new Date(time);
    let angles;
    try {
      angles = lookAnglesFromTle(tle.line1, tle.line2, observer, at);
    } catch {
      continue; // Skip failed propagations (e.g. decayed orbit)
    }

    if (angles.elevation >= minimumElevation) {
      if (!active) active = { acquisitionTime: at, maxElevation: angles.elevation, azimuthAtMax: angles.azimuth };
      if (angles.elevation > active.maxElevation) {
        active.maxElevation = angles.elevation;
        active.azimuthAtMax = angles.azimuth;
      }
    } else if (active) {
      passes.push({
        catalogNumber,
        acquisitionTime: active.acquisitionTime.toISOString(),
        lossTime: at.toISOString(),
        maxElevation: active.maxElevation,
        azimuth: active.azimuthAtMax,
        direction: directionFromAzimuth(previousAzimuth, angles.azimuth),
        visibility: calculateVisibilityScore(active.maxElevation, calculateIlluminationState(tle.line1, tle.line2, active.acquisitionTime)),
      });
      active = null;
    }
    previousAzimuth = angles.azimuth;
  }

  return passes.slice(0, 20);
}

export function calculateLookAngles(catalogNumber: number, observer: Observer) {
  return getLatestTleByCatalogNumber(catalogNumber).then((tle) => {
    if (!tle) throw new Error("No TLE available");
    return lookAnglesFromTle(tle.line1, tle.line2, observer, new Date());
  });
}

export function calculateVisibilityScore(maxElevation: number, illuminationState: IlluminationState) {
  const elevationScore = Math.min(70, Math.max(0, maxElevation) * 0.78);
  const illuminationScore = illuminationState === "SUNLIT" ? 30 : illuminationState === "PENUMBRA" ? 15 : 0;
  return Math.round(Math.min(100, elevationScore + illuminationScore));
}

function propagateTle(line1: string, line2: string, at: Date) {
  const satrec = satellite.twoline2satrec(line1, line2);
  const pv = satellite.propagate(satrec, at);
  if (!pv || !pv.position || !pv.velocity || typeof pv.position === "boolean" || typeof pv.velocity === "boolean") {
    throw new Error("Propagation failed");
  }
  return { satrec, position: pv.position, velocity: pv.velocity };
}

function lookAnglesFromTle(line1: string, line2: string, observer: Observer, at: Date) {
  const { position } = propagateTle(line1, line2, at);
  const gmst = satellite.gstime(at);
  const observerGd = {
    latitude: deg2rad(observer.latitude),
    longitude: deg2rad(observer.longitude),
    height: 0,
  };
  const ecf = satellite.eciToEcf(position, gmst);
  const look = satellite.ecfToLookAngles(observerGd, ecf);
  return {
    azimuth: normalizeDegrees(rad2deg(look.azimuth)),
    elevation: rad2deg(look.elevation),
    rangeKm: look.rangeSat,
  };
}

function calculateIlluminationState(line1: string, line2: string, at: Date): IlluminationState {
  const { position } = propagateTle(line1, line2, at);
  const sun = approximateSunEci(at);
  const dot = position.x * sun.x + position.y * sun.y + position.z * sun.z;
  if (dot > 0) return "SUNLIT";
  const crossMag = magnitude({
    x: position.y * sun.z - position.z * sun.y,
    y: position.z * sun.x - position.x * sun.z,
    z: position.x * sun.y - position.y * sun.x,
  });
  const distanceToShadowAxis = crossMag / magnitude(sun);
  return distanceToShadowAxis < 6378.137 ? "ECLIPSED" : "PENUMBRA";
}

function approximateSunEci(date: Date) {
  const days = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86_400_000;
  const meanLongitude = deg2rad(normalizeDegrees(280.46 + 0.9856474 * days));
  const meanAnomaly = deg2rad(normalizeDegrees(357.528 + 0.9856003 * days));
  const eclipticLongitude = meanLongitude + deg2rad(1.915) * Math.sin(meanAnomaly) + deg2rad(0.02) * Math.sin(2 * meanAnomaly);
  const obliquity = deg2rad(23.439 - 0.0000004 * days);
  return {
    x: Math.cos(eclipticLongitude),
    y: Math.cos(obliquity) * Math.sin(eclipticLongitude),
    z: Math.sin(obliquity) * Math.sin(eclipticLongitude),
  };
}

function magnitude(vector: { x: number; y: number; z: number }) {
  return Math.sqrt(vector.x ** 2 + vector.y ** 2 + vector.z ** 2);
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function directionFromAzimuth(start: number, end: number) {
  const delta = normalizeLongitude(end - start);
  return delta >= 0 ? "ascending" : "descending";
}
