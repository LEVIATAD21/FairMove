/** Identidade FairMove — monograma "FV", nome FAIRMOVE, slogan. */
export const BRAND = "FAIRMOVE";
export const MONOGRAM = "FV";
export const SLOGAN = "RIDE FAIR. LIVE FORWARD.";

/** Sequência cinematográfica da Splash Screen. */
export const SPLASH_SEQUENCE = [
  "fundo obsidiana aparece",
  "linha da estrada surge",
  "rota dourada é desenhada",
  "pin de localização aparece",
  "carro entra",
  "moto entra",
  "FV aparece",
  "FAIRMOVE surge",
];

/** Estados de corrida compartilhados entre passageiro e motorista. */
export const RIDE_STATES = {
  REQUESTED: "REQUESTED",
  SEARCHING: "SEARCHING",
  DRIVER_ASSIGNED: "DRIVER_ASSIGNED",
  DRIVER_ARRIVING: "DRIVER_ARRIVING",
  DRIVER_AT_PICKUP: "DRIVER_AT_PICKUP",
  PASSENGER_ONBOARD: "PASSENGER_ONBOARD",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
} as const;

/** Promoção de exemplo usada nas telas (preço base -> desconto -> final). */
export const FAIR_PROMO_EXAMPLE = {
  basePriceCents: 2159,
  discountCents: 703,
  finalPriceCents: 1456,
  driverCreditCents: 1456,
} as const;
