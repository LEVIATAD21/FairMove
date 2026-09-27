import { ActivityIndicator, View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@fairmove/ui";
import { useAuth } from "../../../src/auth/AuthProvider";

export default function DriverTabsLayout() {
  const { status } = useAuth();

  // Sessão real obrigatória para ver as telas do app.
  if (status === "guest") return <Redirect href="/auth/login" />;
  if (status === "restoring") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.obsidian, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.gold.DEFAULT} />
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.gold.DEFAULT,
        tabBarInactiveTintColor: colors.ice.muted,
        tabBarStyle: {
          backgroundColor: colors.graphite.deepest,
          borderTopColor: colors.glass.border,
        },
        sceneStyle: { backgroundColor: colors.obsidian },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Online",
          tabBarIcon: ({ color, size }) => <Ionicons name="radio" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="rides"
        options={{
          title: "Corridas",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="car-sport" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: "Ganhos",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="wallet" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="reserve"
        options={{
          title: "Reserva",
          tabBarIcon: ({ color, size }) => <Ionicons name="shield" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Perfil",
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
