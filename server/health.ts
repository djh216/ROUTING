import type { Request, Response } from "express";
import { SCRANTON_DEPOT } from "../shared/constants.js";
import { RELEASE_VERSION } from "../shared/releaseVersion.js";
import { getGoogleMapsStatus } from "./routing/google-maps-status.js";

function isLoopback(ip: string | undefined): boolean {
  if (!ip) return false;
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function readHealthToken(req: Request): string | undefined {
  const header = req.header("x-health-token");
  if (header) return header;
  const q = req.query.token;
  return typeof q === "string" ? q : undefined;
}

/** Health for Docker (localhost) returns full detail; public internet gets minimal or token-gated detail. */
export function handleHealth(req: Request, res: Response): void {
  const configured = process.env.HEALTH_CHECK_TOKEN?.trim();
  const loopback = isLoopback(req.ip);
  const tokenOk = configured && readHealthToken(req) === configured;

  if (configured && !loopback && !tokenOk) {
    res.status(404).json({ ok: false });
    return;
  }

  const mapsStatus = getGoogleMapsStatus();
  res.json({
    ok: true,
    releaseVersion: RELEASE_VERSION,
    depot: SCRANTON_DEPOT,
    googleMapsConfigured: mapsStatus.configured,
    googleMapsAvailable: mapsStatus.available,
    googleMapsStatus: mapsStatus.status,
    googleMapsMessage: mapsStatus.message,
  });
}
