import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { EmptyState } from "@/components/native-ui";
import { useMobileIde } from "@/context/mobile-ide-context";
import OpenCodeDom from "@/dom/opencode-screen";

export default function OpenCodeScreen(): React.ReactElement {
  const mobileIde = useMobileIde();

  if (!mobileIde.activeProject) {
    return (
      <View style={styles.emptyRoot}>
        <EmptyState
          description="Select or create a project in the Projects tab before mounting OpenCode."
          title="No active project"
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.headerCard}>
        <Text style={styles.title}>{mobileIde.activeProject.title}</Text>
        <Text style={styles.subtitle}>
          {mobileIde.activeProject.templateId} · {mobileIde.openCodeStatus?.phase ?? "booting"}
        </Text>
      </View>
      <OpenCodeDom
        copyText={mobileIde.copyText}
        dom={{ scrollEnabled: false }}
        files={mobileIde.activeProjectFiles}
        flushProject={mobileIde.flushActiveProject}
        loadSecrets={mobileIde.loadSecrets}
        onStatusChange={mobileIde.updateOpenCodeStatus}
        openExternalUrl={mobileIde.openExternalUrl}
        persistOps={mobileIde.persistActiveProjectOps}
        projectId={mobileIde.activeProject.id}
        runCommand={mobileIde.activeProject.runCommand}
        style={styles.dom}
        themeMode={mobileIde.themeMode}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: "#e2e8f0",
    flex: 1,
    padding: 12,
  },
  emptyRoot: {
    backgroundColor: "#e2e8f0",
    flex: 1,
    justifyContent: "center",
    padding: 16,
  },
  headerCard: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe4ee",
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 12,
    padding: 16,
  },
  title: {
    color: "#0f172a",
    fontSize: 20,
    fontWeight: "700",
  },
  subtitle: {
    color: "#64748b",
    fontSize: 14,
    marginTop: 4,
  },
  dom: {
    flex: 1,
    overflow: "hidden",
  },
});
