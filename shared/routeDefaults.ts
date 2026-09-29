import { DELIVERY_WINDOW } from "./constants.js";

/** Arrival time when a Vetri account is the first stop. */
export const VETRI_FIRST_STOP_TIME = "09:30";

/** The Vetri account, not other Vetri locations such as Pizzeria Vetri. */
export function isVetriStopName(name: string): boolean {
  return name.trim().toLowerCase() === "vetri";
}

/** Default first-stop arrival for whoever currently leads the route. */
export function defaultFirstStopTimeForName(name: string | undefined): string {
  if (name && isVetriStopName(name)) return VETRI_FIRST_STOP_TIME;
  return DELIVERY_WINDOW.start;
}
