import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MobileIdeProvider } from "@/context/mobile-ide-context";

export default function RootLayout(): React.ReactElement {
  return (
    <SafeAreaProvider>
      <MobileIdeProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="+not-found" />
        </Stack>
      </MobileIdeProvider>
    </SafeAreaProvider>
  );
}
