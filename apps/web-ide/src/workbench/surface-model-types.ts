import type { DomSlot } from "./framework/dom-slot";

export interface SlotSurfaceState {
  slot: DomSlot;
}

export interface SlotSurfaceActions {
  focus?: () => void;
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
  selectOptions?: Array<{ label: string; value: string }>;
  selectValue?: string;
}

export interface KeychainSidebarState {
  slots: KeychainSidebarSlotStatus[];
  hasStoredVault: boolean;
  supported: boolean;
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
