import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

export function ScreenScrollView(
  props: React.PropsWithChildren<{ style?: StyleProp<ViewStyle> }>,
): React.ReactElement {
  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      style={props.style}
    >
      {props.children}
    </ScrollView>
  );
}

export function SectionCard(
  props: React.PropsWithChildren<{ style?: StyleProp<ViewStyle> }>,
): React.ReactElement {
  return <View style={[styles.card, props.style]}>{props.children}</View>;
}

export function SectionTitle(props: { children: React.ReactNode }): React.ReactElement {
  return <Text style={styles.sectionTitle}>{props.children}</Text>;
}

export function BodyText(props: { children: React.ReactNode; muted?: boolean }): React.ReactElement {
  return (
    <Text style={props.muted ? styles.bodyMuted : styles.body}>
      {props.children}
    </Text>
  );
}

export function InlineLabel(props: { children: React.ReactNode }): React.ReactElement {
  return <Text style={styles.inlineLabel}>{props.children}</Text>;
}

export function AppButton(props: {
  label: string;
  onPress: () => void | Promise<void>;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}): React.ReactElement {
  const variantStyle = props.variant === "danger"
    ? styles.buttonDanger
    : props.variant === "secondary"
      ? styles.buttonSecondary
      : styles.buttonPrimary;

  const textStyle = props.variant === "secondary"
    ? styles.buttonSecondaryText
    : styles.buttonPrimaryText;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={() => {
        void props.onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        variantStyle,
        props.disabled ? styles.buttonDisabled : null,
        pressed ? styles.buttonPressed : null,
      ]}
    >
      <Text style={textStyle}>{props.label}</Text>
    </Pressable>
  );
}

export function LabeledInput(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}): React.ReactElement {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inlineLabel}>{props.label}</Text>
      <TextInput
        multiline={props.multiline}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor="#94a3b8"
        style={[styles.input, props.multiline ? styles.inputMultiline : null]}
        value={props.value}
      />
    </View>
  );
}

export function EmptyState(props: {
  title: string;
  description: string;
}): React.ReactElement {
  return (
    <SectionCard style={styles.emptyState}>
      <Text style={styles.emptyStateTitle}>{props.title}</Text>
      <BodyText muted>{props.description}</BodyText>
    </SectionCard>
  );
}

export function Badge(props: { label: string }): React.ReactElement {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{props.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    gap: 16,
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: "#f8fafc",
    borderColor: "#dbe4ee",
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  sectionTitle: {
    color: "#0f172a",
    fontSize: 20,
    fontWeight: "700",
  },
  body: {
    color: "#334155",
    fontSize: 15,
    lineHeight: 22,
  },
  bodyMuted: {
    color: "#64748b",
    fontSize: 14,
    lineHeight: 20,
  },
  inlineLabel: {
    color: "#0f172a",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  button: {
    alignItems: "center",
    borderRadius: 14,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonPrimary: {
    backgroundColor: "#0f172a",
  },
  buttonSecondary: {
    backgroundColor: "#e2e8f0",
  },
  buttonDanger: {
    backgroundColor: "#b91c1c",
  },
  buttonPrimaryText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  buttonSecondaryText: {
    color: "#0f172a",
    fontSize: 15,
    fontWeight: "700",
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  inputGroup: {
    gap: 8,
  },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#cbd5e1",
    borderRadius: 14,
    borderWidth: 1,
    color: "#0f172a",
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputMultiline: {
    minHeight: 140,
    textAlignVertical: "top",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 32,
  },
  emptyStateTitle: {
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "700",
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#dbeafe",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    color: "#1d4ed8",
    fontSize: 12,
    fontWeight: "700",
  },
});
