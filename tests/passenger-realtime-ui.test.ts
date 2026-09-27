import { formatBRL, formatCoord } from "../apps/passenger/src/logic/format";
import { canSearch, searchPlaces } from "../apps/passenger/src/services/geocode";

describe("formatBRL — formatação determinística de centavos", () => {
  test("formata centavos simples", () => {
    expect(formatBRL(1456)).toBe("R$ 14,56");
  });

  test("agrupa milhar com ponto", () => {
    expect(formatBRL(300000)).toBe("R$ 3.000,00");
  });

  test("zero e negativos", () => {
    expect(formatBRL(0)).toBe("R$ 0,00");
    expect(formatBRL(-250)).toBe("-R$ 2,50");
  });

  test("não numérico vira zero", () => {
    expect(formatBRL(Number.NaN)).toBe("R$ 0,00");
  });
});

describe("formatCoord — representação de coordenada real", () => {
  test("formata com 4 casas decimais", () => {
    expect(formatCoord(-23.5505, -46.6333)).toBe("-23.5505, -46.6333");
  });

  test("NaN vira traço (nunca inventa posição)", () => {
    expect(formatCoord(Number.NaN, 0)).toBe("—");
  });
});

describe("geocode — busca de destino no OSM", () => {
  const globalWithFetch = globalThis as { fetch?: unknown };
  const originalFetch = globalWithFetch.fetch;

  afterEach(() => {
    globalWithFetch.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test("canSearch exige 3+ caracteres", () => {
    expect(canSearch("ab")).toBe(false);
    expect(canSearch(" av paulista ")).toBe(true);
  });

  test("searchPlaces mapeia resposta real do Nominatim", async () => {
    globalWithFetch.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { display_name: "Avenida Paulista, São Paulo", lat: "-23.5614", lon: "-46.6559" },
        { display_name: "Rua inválida", lat: "not-a-number", lon: "-46.6" },
      ],
    });

    const places = await searchPlaces("Avenida Paulista");
    expect(places).toHaveLength(1);
    expect(places[0]).toEqual({
      label: "Avenida Paulista, São Paulo",
      lat: -23.5614,
      lng: -46.6559,
    });
    expect(globalWithFetch.fetch).toHaveBeenCalledTimes(1);
  });

  test("erro de rede retorna lista vazia (UI degrada sem quebrar)", async () => {
    globalWithFetch.fetch = jest.fn().mockRejectedValue(new Error("offline"));
    expect(await searchPlaces("qualquer coisa")).toEqual([]);
  });

  test("resposta não-2xx retorna vazio", async () => {
    globalWithFetch.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    expect(await searchPlaces("qualquer coisa")).toEqual([]);
  });

  test("query curta não chama a rede", async () => {
    globalWithFetch.fetch = jest.fn();
    expect(await searchPlaces("ab")).toEqual([]);
    expect(globalWithFetch.fetch).not.toHaveBeenCalled();
  });
});
