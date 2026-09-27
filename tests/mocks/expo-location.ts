/** Mock mínimo de expo-location p/ testes em ambiente Node/Jest. */
export const Accuracy = { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5 };

let granted = true;

export function __setMockGranted(value: boolean): void {
  granted = value;
}

export async function getForegroundPermissionsAsync(): Promise<{ granted: boolean }> {
  return { granted };
}

export async function requestForegroundPermissionsAsync(): Promise<{ granted: boolean }> {
  return { granted };
}

export async function getCurrentPositionAsync(): Promise<{
  coords: { latitude: number; longitude: number; accuracy: number };
}> {
  if (!granted) throw new Error("permission denied");
  return { coords: { latitude: -23.5505, longitude: -46.6333, accuracy: 10 } };
}
