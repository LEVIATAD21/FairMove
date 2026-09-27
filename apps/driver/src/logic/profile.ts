const IGNORED_KEYS = new Set(["id", "userId", "createdAt", "updatedAt"]);

/**
 * Integridade real do perfil: percentual de campos preenchidos no profile
 * persistido no banco. Sem profile → 0 (nada de estimativa).
 */
export function completionPercent(profile: Record<string, unknown> | null): number {
  if (!profile) return 0;
  const keys = Object.keys(profile).filter((key) => !IGNORED_KEYS.has(key));
  if (keys.length === 0) return 0;
  const filled = keys.filter((key) => {
    const value = profile[key];
    return value !== null && value !== undefined && value !== "";
  }).length;
  return Math.round((filled / keys.length) * 100);
}
