import React, { useEffect, useState } from "react";
import { View } from "react-native";
import {
  AppButton,
  BodyText,
  LabeledInput,
  ScreenScrollView,
  SectionCard,
  SectionTitle,
} from "@/components/native-ui";
import { useMobileIde } from "@/context/mobile-ide-context";
import type { MobileSecretFiles } from "@/types";

const EMPTY_FORM: MobileSecretFiles = {
  authJson: null,
  mcpAuthJson: null,
  configJson: null,
  configJsonc: null,
  legacyConfigJson: null,
};

export default function SettingsScreen(): React.ReactElement {
  const mobileIde = useMobileIde();
  const [form, setForm] = useState<MobileSecretFiles>(mobileIde.settings);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(mobileIde.settings);
  }, [mobileIde.settings]);

  return (
    <ScreenScrollView>
      <SectionCard>
        <SectionTitle>Secure OpenCode Settings</SectionTitle>
        <BodyText muted>
          These payloads live only in `expo-secure-store`. Project files stay on disk under the app document directory and never include provider keys.
        </BodyText>
        <LabeledInput
          label="auth.json"
          multiline
          onChangeText={(value) => setForm((current) => ({ ...current, authJson: value }))}
          placeholder='{"openai":{"type":"api","key":"sk-..."}}'
          value={form.authJson ?? ""}
        />
        <LabeledInput
          label="mcp-auth.json"
          multiline
          onChangeText={(value) => setForm((current) => ({ ...current, mcpAuthJson: value }))}
          placeholder='{"github":{"token":"..."}}'
          value={form.mcpAuthJson ?? ""}
        />
        <LabeledInput
          label="opencode.json"
          multiline
          onChangeText={(value) => setForm((current) => ({ ...current, configJson: value }))}
          placeholder='{"provider":"openai"}'
          value={form.configJson ?? ""}
        />
        <LabeledInput
          label="opencode.jsonc"
          multiline
          onChangeText={(value) => setForm((current) => ({ ...current, configJsonc: value }))}
          placeholder="// optional JSONC config"
          value={form.configJsonc ?? ""}
        />
        <LabeledInput
          label="legacy config.json"
          multiline
          onChangeText={(value) => setForm((current) => ({ ...current, legacyConfigJson: value }))}
          placeholder='{"provider":"openai"}'
          value={form.legacyConfigJson ?? ""}
        />
        <View style={{ gap: 10 }}>
          <AppButton
            disabled={saving}
            label={saving ? "Saving..." : "Save Secure Settings"}
            onPress={async () => {
              setSaving(true);
              try {
                await mobileIde.saveSecrets(form);
              } finally {
                setSaving(false);
              }
            }}
          />
          <AppButton
            disabled={saving}
            label="Clear All Secrets"
            onPress={async () => {
              setSaving(true);
              try {
                await mobileIde.saveSecrets(EMPTY_FORM);
              } finally {
                setSaving(false);
              }
            }}
            variant="secondary"
          />
        </View>
      </SectionCard>
    </ScreenScrollView>
  );
}
