import type { AssetClass } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

const baseUrl = "https://www.space-track.org";

type SpaceTrackSession = { cookie: string };
type TlePayload = { catalogNumber: number; line1: string; line2: string; epochTimestamp: Date; name?: string };

export async function syncCatalog() {
  const [metadataCount, tleCount] = await Promise.all([syncSatelliteMetadata(), syncTleHistory()]);
  return { metadataCount, tleCount };
}

export async function syncSatelliteMetadata() {
  const session = await authenticate();
  const data = await spaceTrackJson<Record<string, string | null>[]>(
    session,
    "/basicspacedata/query/class/satcat/DECAY/null-val/orderby/NORAD_CAT_ID/format/json"
  );

  let count = 0;
  for (const item of data) {
    const catalogNumber = Number(item.NORAD_CAT_ID);
    if (!Number.isInteger(catalogNumber)) continue;

    await prisma.orbitalAsset.upsert({
      where: { catalogNumber },
      create: {
        catalogNumber,
        internationalDesignator: item.INTLDES ?? undefined,
        displayName: item.OBJECT_NAME ?? undefined,
        assetClass: classifyAsset(item.OBJECT_TYPE, item.OBJECT_NAME),
        operatorName: item.OPS_STATUS ?? undefined,
        originCountry: item.COUNTRY ?? undefined,
        launchDate: parseDate(item.LAUNCH),
        decayDate: parseDate(item.DECAY),
      },
      update: {
        internationalDesignator: item.INTLDES ?? undefined,
        displayName: item.OBJECT_NAME ?? undefined,
        assetClass: classifyAsset(item.OBJECT_TYPE, item.OBJECT_NAME),
        operatorName: item.OPS_STATUS ?? undefined,
        originCountry: item.COUNTRY ?? undefined,
        launchDate: parseDate(item.LAUNCH),
        decayDate: parseDate(item.DECAY),
      },
    });
    count += 1;
  }

  return count;
}

export async function syncTleHistory() {
  const session = await authenticate();
  const data = await spaceTrackJson<Record<string, string>[]>(
    session,
    "/basicspacedata/query/class/gp/decay_date/null-val/orderby/NORAD_CAT_ID/format/json"
  );

  const payloads = data
    .map((item) => ({
      catalogNumber: Number(item.NORAD_CAT_ID),
      name: item.OBJECT_NAME,
      line1: item.TLE_LINE1,
      line2: item.TLE_LINE2,
      epochTimestamp: new Date(item.EPOCH),
    }))
    .filter((item) => Number.isInteger(item.catalogNumber) && item.line1 && item.line2 && !Number.isNaN(item.epochTimestamp.getTime()));

  return upsertTlePayloads(payloads);
}

export async function upsertTlePayloads(payloads: TlePayload[]) {
  let count = 0;
  for (const payload of payloads) {
    const asset = await prisma.orbitalAsset.upsert({
      where: { catalogNumber: payload.catalogNumber },
      create: {
        catalogNumber: payload.catalogNumber,
        displayName: payload.name,
        assetClass: "OTHER",
        orbitalEpoch: payload.epochTimestamp,
      },
      update: {
        displayName: payload.name ?? undefined,
        orbitalEpoch: payload.epochTimestamp,
      },
    });

    await prisma.orbitalElementsArchive.upsert({
      where: {
        assetId_epochTimestamp: {
          assetId: asset.assetId,
          epochTimestamp: payload.epochTimestamp,
        },
      },
      create: {
        assetId: asset.assetId,
        elementLine1: payload.line1,
        elementLine2: payload.line2,
        epochTimestamp: payload.epochTimestamp,
      },
      update: {
        elementLine1: payload.line1,
        elementLine2: payload.line2,
      },
    });
    count += 1;
  }
  return count;
}

async function authenticate(): Promise<SpaceTrackSession> {
  const identity = process.env.SPACE_TRACK_USERNAME;
  const password = process.env.SPACE_TRACK_PASSWORD;
  if (!identity || !password) throw new Error("SPACE_TRACK_USERNAME and SPACE_TRACK_PASSWORD are required");

  const response = await fetch(`${baseUrl}/ajaxauth/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ identity, password }),
  });

  if (!response.ok) throw new Error(`Space-Track authentication failed with ${response.status}`);
  const cookie = response.headers.get("set-cookie");
  if (!cookie) throw new Error("Space-Track authentication did not return a session cookie");
  return { cookie };
}

async function spaceTrackJson<T>(session: SpaceTrackSession, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { cookie: session.cookie } });
  if (!response.ok) throw new Error(`Space-Track request failed with ${response.status}`);
  return (await response.json()) as T;
}

function parseDate(value: string | null | undefined) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function classifyAsset(type?: string | null, name?: string | null): AssetClass {
  const value = `${type ?? ""} ${name ?? ""}`.toUpperCase();
  if (value.includes("DEB") || value.includes("ROCKET BODY")) return "DEBRIS";
  if (value.includes("STARLINK") || value.includes("COMM")) return "COMMUNICATION";
  if (value.includes("GPS") || value.includes("GLONASS") || value.includes("GALILEO")) return "NAVIGATION";
  if (value.includes("NOAA") || value.includes("METEOR") || value.includes("WEATHER")) return "WEATHER";
  if (value.includes("ISS") || value.includes("CREW")) return "CREWED";
  return "OTHER";
}
