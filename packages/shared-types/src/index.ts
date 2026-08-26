export type RideStatus = 
  | "REQUESTED" 
  | "SEARCHING" 
  | "DRIVER_ASSIGNED" 
  | "DRIVER_ARRIVING" 
  | "DRIVER_AT_PICKUP" 
  | "PASSENGER_ONBOARD" 
  | "IN_PROGRESS" 
  | "COMPLETED" 
  | "CANCELLED_BY_PASSENGER" 
  | "CANCELLED_BY_DRIVER" 
  | "CANCELLED_BY_SYSTEM" 
  | "EXPIRED" 
  | "DISPUTED";

export type VehicleType = "CAR" | "MOTORCYCLE";

export interface PriceQuote {
  originalPrice: number;
  promotionDiscount: number;
  passengerPrice: number;
  driverCredit: number;
}
