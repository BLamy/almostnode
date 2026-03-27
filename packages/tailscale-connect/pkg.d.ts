import { ITerminalOptions } from 'xterm';

declare global {
	function newIPN(config: IPNConfig): IPN;
	type IPNFetchRequest = {
		url: string;
		method?: string;
		headers?: Record<string, string>;
		bodyBase64?: string;
		redirect?: "follow" | "manual" | "error";
	};
	type IPNFetchResponse = {
		url: string;
		status: number;
		statusText: string;
		headers: Record<string, string>;
		bodyBase64: string;
		text: () => Promise<string>;
	};
	interface IPN {
		run(callbacks: IPNCallbacks): void;
		configure(config: {
			useExitNode?: boolean;
			exitNodeId?: string | null;
		}): Promise<void>;
		login(): void;
		logout(): void;
		ssh(host: string, username: string, termConfig: {
			writeFn: (data: string) => void;
			writeErrorFn: (err: string) => void;
			setReadFn: (readFn: (data: string) => void) => void;
			rows: number;
			cols: number;
			/** Defaults to 5 seconds */
			timeoutSeconds?: number;
			onConnectionProgress: (message: string) => void;
			onConnected: () => void;
			onDone: () => void;
		}): IPNSSHSession;
		fetch(url: string | IPNFetchRequest): Promise<IPNFetchResponse>;
	}
	interface IPNSSHSession {
		resize(rows: number, cols: number): boolean;
		close(): boolean;
	}
	interface IPNStateStorage {
		setState(id: string, value: string): void;
		getState(id: string): string;
	}
	type IPNConfig = {
		stateStorage?: IPNStateStorage;
		authKey?: string;
		controlURL?: string;
		hostname?: string;
		useExitNode?: boolean;
		exitNodeId?: string | null;
	};
	type IPNCallbacks = {
		notifyState: (state: IPNState) => void;
		notifyNetMap: (netMapStr: string) => void;
		notifyBrowseToURL: (url: string) => void;
		notifyPanicRecover: (err: string) => void;
	};
	type IPNNetMap = {
		self: IPNNetMapSelfNode;
		peers: IPNNetMapPeerNode[];
		lockedOut: boolean;
		selectedExitNodeId?: string;
	};
	type IPNNetMapNode = {
		id?: string;
		name: string;
		addresses: string[];
		machineKey: string;
		nodeKey: string;
	};
	type IPNNetMapSelfNode = IPNNetMapNode & {
		machineStatus: IPNMachineStatus;
	};
	type IPNNetMapPeerNode = IPNNetMapNode & {
		online?: boolean;
		exitNodeOption?: boolean;
		tailscaleSSHEnabled: boolean;
	};
	/** Mirrors values from ipn/backend.go */
	type IPNState = "NoState" | "InUseOtherUser" | "NeedsLogin" | "NeedsMachineAuth" | "Stopped" | "Starting" | "Running";
	/** Mirrors values from MachineStatus in tailcfg.go */
	type IPNMachineStatus = "MachineUnknown" | "MachineUnauthorized" | "MachineAuthorized" | "MachineInvalid";
}
export declare type SSHSessionDef = {
	username: string;
	hostname: string;
	/** Defaults to 5 seconds */
	timeoutSeconds?: number;
};
export declare type SSHSessionCallbacks = {
	onConnectionProgress: (messsage: string) => void;
	onConnected: () => void;
	onDone: () => void;
	onError?: (err: string) => void;
};
export declare function runSSHSession(termContainerNode: HTMLDivElement, def: SSHSessionDef, ipn: IPN, callbacks: SSHSessionCallbacks, terminalOptions?: ITerminalOptions): void;
/**
 * Superset of the IPNConfig type, with additional configuration that is
 * needed for the package to function.
 */
export declare type IPNPackageConfig = IPNConfig & {
	authKey: string;
	wasmURL?: string;
	panicHandler: (err: string) => void;
};
export declare function createIPN(config: IPNPackageConfig): Promise<IPN>;

export {};
