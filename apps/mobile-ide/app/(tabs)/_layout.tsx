import React from "react";
import { Tabs } from "expo-router";

export default function TabLayout(): React.ReactElement {
  return (
    <Tabs
      screenOptions={{
        headerStyle: {
          backgroundColor: "#ffffff",
        },
        headerTitleStyle: {
          color: "#0f172a",
          fontWeight: "700",
        },
        tabBarActiveTintColor: "#0f172a",
        tabBarInactiveTintColor: "#64748b",
        tabBarStyle: {
          backgroundColor: "#ffffff",
          borderTopColor: "#dbe4ee",
        },
      }}
    >
      <Tabs.Screen
        name="projects"
        options={{ title: "Projects" }}
      />
      <Tabs.Screen
        name="opencode"
        options={{ title: "OpenCode" }}
      />
      <Tabs.Screen
        name="preview"
        options={{ title: "Preview" }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: "Settings" }}
      />
    </Tabs>
  );
}
