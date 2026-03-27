import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  AppButton,
  Badge,
  BodyText,
  EmptyState,
  LabeledInput,
  ScreenScrollView,
  SectionCard,
  SectionTitle,
} from "@/components/native-ui";
import { useMobileIde } from "@/context/mobile-ide-context";
import { TEMPLATE_OPTIONS } from "@/templates";

function formatTimestamp(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default function ProjectsScreen(): React.ReactElement {
  const mobileIde = useMobileIde();
  const [draftTitle, setDraftTitle] = useState("Mobile IDE Project");
  const [selectedTemplate, setSelectedTemplate] = useState(TEMPLATE_OPTIONS[0].id);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const selectedTemplateLabel = useMemo(() => (
    TEMPLATE_OPTIONS.find((template) => template.id === selectedTemplate)?.label ?? "Project"
  ), [selectedTemplate]);

  return (
    <ScreenScrollView>
      <SectionCard>
        <SectionTitle>New Project</SectionTitle>
        <BodyText muted>
          Seed a workspace from the same template set the web IDE uses, then open it in the native tabs shell.
        </BodyText>
        <LabeledInput
          label="Project Title"
          onChangeText={setDraftTitle}
          placeholder={`${selectedTemplateLabel} Project`}
          value={draftTitle}
        />
        <View style={styles.templateGrid}>
          {TEMPLATE_OPTIONS.map((template) => (
            <SectionCard
              key={template.id}
              style={[
                styles.templateCard,
                selectedTemplate === template.id ? styles.templateCardActive : null,
              ]}
            >
              <Text style={styles.templateTitle}>{template.label}</Text>
              <BodyText muted>{template.description}</BodyText>
              <AppButton
                disabled={mobileIde.busy}
                label={selectedTemplate === template.id ? "Selected" : "Use Template"}
                onPress={() => setSelectedTemplate(template.id)}
                variant={selectedTemplate === template.id ? "primary" : "secondary"}
              />
            </SectionCard>
          ))}
        </View>
        <AppButton
          disabled={mobileIde.busy}
          label={mobileIde.busy ? "Working..." : "Create Project"}
          onPress={async () => {
            const title = draftTitle.trim() || `${selectedTemplateLabel} Project`;
            await mobileIde.createProject(selectedTemplate, title);
            setDraftTitle(`${selectedTemplateLabel} Project`);
          }}
        />
      </SectionCard>

      <SectionCard>
        <SectionTitle>Saved Projects</SectionTitle>
        <BodyText muted>
          Projects live in the app document directory and reopen directly from the mobile shell.
        </BodyText>
        {mobileIde.loading ? (
          <BodyText>Loading projects…</BodyText>
        ) : mobileIde.projects.length === 0 ? (
          <EmptyState
            description="Create a project above to seed the first mobile workspace."
            title="No projects yet"
          />
        ) : (
          <View style={styles.projectList}>
            {mobileIde.projects.map((project) => {
              const isEditing = editingProjectId === project.id;
              const isActive = mobileIde.activeProject?.id === project.id;

              return (
                <SectionCard key={project.id}>
                  <View style={styles.projectHeader}>
                    <View style={styles.projectMeta}>
                      <Text style={styles.projectTitle}>{project.title}</Text>
                      <BodyText muted>{project.templateId} · updated {formatTimestamp(project.updatedAt)}</BodyText>
                    </View>
                    <View style={styles.badgeRow}>
                      {isActive ? <Badge label="Active" /> : null}
                      <Badge label={project.templateId} />
                    </View>
                  </View>

                  {isEditing ? (
                    <View style={styles.renameBlock}>
                      <LabeledInput
                        label="Rename Project"
                        onChangeText={setEditingTitle}
                        value={editingTitle}
                      />
                      <View style={styles.actionRow}>
                        <AppButton
                          disabled={mobileIde.busy || !editingTitle.trim()}
                          label="Save Name"
                          onPress={async () => {
                            await mobileIde.renameProject(project.id, editingTitle.trim());
                            setEditingProjectId(null);
                            setEditingTitle("");
                          }}
                        />
                        <AppButton
                          label="Cancel"
                          onPress={() => {
                            setEditingProjectId(null);
                            setEditingTitle("");
                          }}
                          variant="secondary"
                        />
                      </View>
                    </View>
                  ) : (
                    <View style={styles.actionRow}>
                      <AppButton
                        disabled={mobileIde.busy}
                        label={isActive ? "Reopen" : "Open"}
                        onPress={() => mobileIde.openProject(project.id)}
                      />
                      <AppButton
                        disabled={mobileIde.busy}
                        label="Rename"
                        onPress={() => {
                          setEditingProjectId(project.id);
                          setEditingTitle(project.title);
                        }}
                        variant="secondary"
                      />
                      <AppButton
                        disabled={mobileIde.busy}
                        label="Duplicate"
                        onPress={() => mobileIde.duplicateProject(project.id)}
                        variant="secondary"
                      />
                      <AppButton
                        disabled={mobileIde.busy}
                        label="Delete"
                        onPress={() => mobileIde.deleteProject(project.id)}
                        variant="danger"
                      />
                    </View>
                  )}
                </SectionCard>
              );
            })}
          </View>
        )}
      </SectionCard>
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  templateGrid: {
    gap: 12,
  },
  templateCard: {
    backgroundColor: "#ffffff",
  },
  templateCardActive: {
    borderColor: "#1d4ed8",
    borderWidth: 2,
  },
  templateTitle: {
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "700",
  },
  projectList: {
    gap: 12,
  },
  projectHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  projectMeta: {
    flex: 1,
    gap: 4,
  },
  projectTitle: {
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "700",
  },
  badgeRow: {
    alignItems: "flex-end",
    gap: 6,
  },
  actionRow: {
    gap: 10,
  },
  renameBlock: {
    gap: 10,
  },
});
