import type { DomSlot } from "./framework/dom-slot";
import type { OAuthDiscoveryPreview } from "../features/oauth-services/types";

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
  /**
   * Set on slots backed by a user-added OAuth service. Lets the view render a
   * "Remove" affordance and group user services separately from built-in
   * integrations.
   */
  userOAuthServiceId?: string;
  /** Dispatch action that removes the user OAuth service. */
  removeAction?: string;
  /** Dispatch action that forces a refresh of the user OAuth service. */
  refreshAction?: string;
  /** True while a refresh request is in flight for this service. */
  refreshing?: boolean;
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

/**
 * State machine for the "Add OAuth service" modal.
 *
 *  - `idle`: modal is closed.
 *  - `prompt`: modal is open, URL input is shown, no fetch in flight.
 *  - `discovering`: a `.well-known` lookup is in flight for `inputUrl`.
 *  - `preview`: discovery succeeded; awaiting confirmation. `discovered` is set.
 *  - `manual-client`: discovery succeeded but the AS does not advertise DCR;
 *    waiting for the user to paste a `client_id` (and optional secret).
 *  - `authorizing`: the popup is open and we're waiting for the callback.
 *  - `error`: discovery, registration, or token exchange failed; `errorMessage`
 *    is set and the modal stays open so the user can retry.
 */
export type KeychainAddServiceFlowStatus =
  | "idle"
  | "prompt"
  | "discovering"
  | "preview"
  | "manual-client"
  | "authorizing"
  | "error";

export interface KeychainAddServiceFlowState {
  status: KeychainAddServiceFlowStatus;
  /** Mirrors the input field so the modal stays in sync after dispatcher round-trips. */
  inputUrl?: string;
  /** Discovery result; set once `status` reaches `preview` or `manual-client`. */
  discovered?: OAuthDiscoveryPreview;
  /** Display name override the user typed in the preview step. */
  displayNameOverride?: string;
  /** Scopes selected in the preview step (defaults to `discovered.scopesSupported`). */
  selectedScopes?: string[];
  /** Manual `client_id` typed by the user when DCR is unavailable. */
  manualClientId?: string;
  /** Manual `client_secret` typed by the user when DCR is unavailable. */
  manualClientSecret?: string;
  /** Error message surfaced inline in the modal. */
  errorMessage?: string;
}

export interface KeychainSidebarState {
  slots: KeychainSidebarSlotStatus[];
  hasStoredVault: boolean;
  hasUnlockedKey: boolean;
  supported: boolean;
  vaultEnvVars: KeychainVaultEnvVar[];
  vaultSync: KeychainVaultSyncState;
  /**
   * State of the add-service modal. Omitted (or `status: "idle"`) means no
   * modal is open. The dispatcher transitions this through the steps via
   * `oauth:add-*` actions handled in workbench-host.
   */
  addServiceFlow?: KeychainAddServiceFlowState;
  /**
   * The absolute callback URL the popup will be redirected to. Surfaced so
   * the manual-client step in the modal can show users exactly what to paste
   * into the upstream provider's "Authorized redirect URIs" field.
   */
  oauthCallbackUrl?: string;
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
