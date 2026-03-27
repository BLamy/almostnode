import React from "react";
import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

export default function NotFoundScreen(): React.ReactElement {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Route Not Found</Text>
      <Link href="/projects" style={styles.link}>
        Return to Projects
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    flex: 1,
    gap: 12,
    justifyContent: "center",
  },
  title: {
    color: "#0f172a",
    fontSize: 20,
    fontWeight: "700",
  },
  link: {
    color: "#2563eb",
    fontSize: 15,
    fontWeight: "600",
  },
});
