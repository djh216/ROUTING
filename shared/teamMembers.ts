const DEFAULT_EXCLUDED_TEAM_MEMBERS = ["david hall"];

function normalizeTeamMemberName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function splitTeamMemberParts(raw: string): string[] {
  return raw
    .split(/\s+and\s+|\s*&\s*|,\s*|;\s*/i)
    .map(normalizeTeamMemberName)
    .filter(Boolean);
}

/** Apply team-member policy on stored customer fields (mutates customer). */
export function applyTeamMembersPolicy(customer: { teamMembers?: string }): void {
  if (customer.teamMembers === undefined) return;
  const clean = sanitizeTeamMembers(customer.teamMembers);
  if (clean) customer.teamMembers = clean;
  else delete customer.teamMembers;
}

/** Remove configured names (default: David Hall) from Outfield-style team member strings. */
export function sanitizeTeamMembers(
  raw: string,
  excludedNames: string[] = DEFAULT_EXCLUDED_TEAM_MEMBERS
): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const excluded = new Set(excludedNames.map((n) => n.trim().toLowerCase()).filter(Boolean));
  const kept = splitTeamMemberParts(trimmed).filter((name) => !excluded.has(name.toLowerCase()));

  if (kept.length === 0) return "";
  if (kept.length === 1) return kept[0]!;
  return kept.join(" and ");
}
