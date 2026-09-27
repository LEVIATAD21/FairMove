import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "@fairmove/ui";
import { AuthProvider } from "../src/auth/AuthProvider";
import { RealtimeProvider } from "../src/realtime/RealtimeProvider";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <RealtimeProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              animation: "fade",
              contentStyle: { backgroundColor: colors.obsidian },
            }}
          >
            <Stack.Screen
              name="ride-request-modal"
              options={{
                presentation: "transparentModal",
                animation: "fade",
                contentStyle: { backgroundColor: "transparent" },
              }}
            />
          </Stack>
        </RealtimeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
