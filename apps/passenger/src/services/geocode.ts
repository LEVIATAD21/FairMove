/**
 * Geocoding real de destino via Nominatim (OpenStreetMap) — sem chave,
 * sem dado inventado: o que aparece é o que o OSM retorna.
 * Uso com moderação (policy do Nominatim: no máximo ~1 req/s por app).
 */

export type PlaceSuggestion = {
  label: string;
  lat: number;
  lng: number;
};

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const MIN_QUERY_LENGTH = 3;

export function canSearch(query: string): boolean {
  return query.trim().length >= MIN_QUERY_LENGTH;
}

/** Busca endereços reais. Retorna lista vazia em erro/rede fora (UI degrada). */
export async function searchPlaces(query: string): Promise<PlaceSuggestion[]> {
  if (!canSearch(query)) return [];

  const url =
    `${NOMINATIM_URL}?format=jsonv2&limit=5&accept-language=pt-BR&q=` +
    encodeURIComponent(query.trim());

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "FairMovePassenger/1.0 (contato: dev@fairmove.dev)" },
    });
    if (!response.ok) return [];
    const rows = (await response.json()) as Array<{
      display_name?: string;
      lat?: string;
      lon?: string;
    }>;
    return rows
      .filter((row) => row.display_name && row.lat && row.lon)
      .map((row) => ({
        label: row.display_name as string,
        lat: Number(row.lat),
        lng: Number(row.lon),
      }))
      .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng));
  } catch {
    return [];
  }
}
