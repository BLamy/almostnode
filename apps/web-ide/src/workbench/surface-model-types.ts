import type { DomSlot } from "./framework/dom-slot";

export interface SlotSurfaceState {
  slot: DomSlot;
}

export interface SlotSurfaceActions {
  focus?: () => void;
}

export interface KeychainSlotPicker {
  actionPrefix: string;
  label: string;
  options: Array<{ label: string; value: string }>;
  value?: string;
  placeholder?: string;
}

export interface KeychainSidebarSlotStatus {
  name: string;
  label: string;
  active: boolean;
  canAuth?: boolean;
  authAction?: string;
  authLabel?: string;
  authDisabled?: boolean;
  statusText?: string;
  statusDetail?: string;
  selectActionPrefix?: string;
  selectLabel?: string;
  selectOptions?: Array<{ label: string; value: string }>;
  selectValue?: string;
  pickers?: KeychainSlotPicker[];
}

export interface KeychainVaultEnvVar {
  name: string;
  value: string | null;
  source?: string;
  note?: string;
  excludeFromSync?: boolean;
}

export interface KeychainVaultSyncState {
  target: string | null;
  targetLabel: string | null;
  busy: boolean;
  message: string | null;
  messageKind: "info" | "success" | "error" | null;
}

export interface KeychainSidebarState {
  slots: KeychainSidebarSlotStatus[];
  hasStoredVault: boolean;
  hasUnlockedKey: boolean;
  supported: boolean;
  vaultEnvVars: KeychainVaultEnvVar[];
  vaultSync: KeychainVaultSyncState;
}

export interface KeychainSidebarActions {
  dispatch(action: string): void;
}

export interface DatabaseSidebarEntry {
  name: string;
  createdAt: string;
}

export interface DatabaseSidebarState {
  databases: DatabaseSidebarEntry[];
  activeName: string | null;
}

export interface DatabaseSidebarActions {
  create(name: string): void;
  open(name: string): void;
  delete(name: string): void;
}

export interface TestsSidebarState {
  tests: Array<{
    id: string;
    name: string;
    status: "pending" | "passed" | "failed" | "running";
  }>;
}

export interface TestsSidebarActions {
  open(id: string): void;
  run(id: string): void;
  runAll(): void;
  delete(id: string): void;
}
