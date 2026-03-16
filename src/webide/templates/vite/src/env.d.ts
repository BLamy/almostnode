// Ambient type declarations for the browser-based IDE.
// Full @types packages are not available in node_modules, so we provide
// minimal declarations to satisfy tsc --noEmit.

declare module 'react' {
  export function useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly unknown[]): T;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useRef<T>(initial: T): { current: T };

  export const StrictMode: FC<{ children?: ReactNode }>;
  export const Fragment: FC<{ children?: ReactNode }>;

  export type FC<P = {}> = (props: P & { children?: ReactNode }) => JSX.Element | null;
  export type ReactNode = string | number | boolean | null | undefined | JSX.Element | ReactNode[];
  export type ReactElement = JSX.Element;

  export interface HTMLAttributes<T = Element> {
    children?: ReactNode;
    className?: string;
    id?: string;
    style?: Record<string, any>;
    title?: string;
    key?: string | number;
    onClick?: (e: any) => void;
    onSubmit?: (e: any) => void;
    onChange?: (e: any) => void;
    onKeyDown?: (e: any) => void;
    onFocus?: (e: any) => void;
    onBlur?: (e: any) => void;
    dangerouslySetInnerHTML?: { __html: string };
    [attr: string]: any;
  }

  export interface ButtonHTMLAttributes<T = Element> extends HTMLAttributes<T> {
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
  }

  export interface InputHTMLAttributes<T = Element> extends HTMLAttributes<T> {
    type?: string;
    value?: string | number | readonly string[];
    placeholder?: string;
    disabled?: boolean;
    checked?: boolean;
    name?: string;
  }

  export namespace JSX {
    type Element = any;
    interface IntrinsicElements {
      [elemName: string]: HTMLAttributes<Element>;
    }
  }
}

declare module 'react/jsx-runtime' {
  import type { HTMLAttributes, JSX } from 'react';
  export function jsx(type: any, props: any, key?: any): any;
  export function jsxs(type: any, props: any, key?: any): any;
  export const Fragment: any;
  export { JSX };
}

declare module 'react-dom/client' {
  export function createRoot(container: Element | null): {
    render(element: any): void;
    unmount(): void;
  };
}

declare module 'react-router-dom' {
  export function Routes(props: { children?: any }): any;
  export function Route(props: { path?: string; element?: any; children?: any; index?: boolean }): any;
  export function Link(props: { to: string; children?: any; className?: string; [key: string]: any }): any;
  export function BrowserRouter(props: { basename?: string; children?: any }): any;
  export function useNavigate(): (to: string | number) => void;
  export function useParams<T extends Record<string, string> = Record<string, string>>(): T;
  export function useLocation(): { pathname: string; search: string; hash: string; state: any };
  export function useSearchParams(): [URLSearchParams, (params: URLSearchParams | Record<string, string>) => void];
}

declare module 'drizzle-orm' {
  export type InferSelectModel<T> = T extends { $inferSelect: infer S } ? S : Record<string, any>;
  export type InferInsertModel<T> = T extends { $inferInsert: infer I } ? I : Record<string, any>;
  export function eq(column: any, value: any): any;
  export function ne(column: any, value: any): any;
  export function and(...conditions: any[]): any;
  export function or(...conditions: any[]): any;
  export function desc(column: any): any;
  export function asc(column: any): any;
  export function sql(strings: TemplateStringsArray, ...values: any[]): any;
}

declare module 'drizzle-orm/pg-core' {
  interface ColumnBuilder {
    primaryKey(): ColumnBuilder;
    notNull(): ColumnBuilder;
    default(value: any): ColumnBuilder;
    defaultNow(): ColumnBuilder;
    unique(): ColumnBuilder;
    references(fn: () => any): ColumnBuilder;
  }

  interface TableConfig {
    $inferSelect: any;
    $inferInsert: any;
    [key: string]: any;
  }

  export function pgTable(name: string, columns: Record<string, any>): TableConfig;
  export function serial(name: string): ColumnBuilder;
  export function text(name: string): ColumnBuilder;
  export function boolean(name: string): ColumnBuilder;
  export function timestamp(name: string, opts?: Record<string, any>): ColumnBuilder;
  export function integer(name: string): ColumnBuilder;
  export function varchar(name: string, opts?: Record<string, any>): ColumnBuilder;
  export function uuid(name: string): ColumnBuilder;
  export function jsonb(name: string): ColumnBuilder;
  export function date(name: string): ColumnBuilder;
  export function numeric(name: string, opts?: Record<string, any>): ColumnBuilder;
}
