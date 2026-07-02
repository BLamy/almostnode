# Task: Native app menus (AppDefinition.menu)

**Priority:** P2 · **Area:** almost-os · **Deps:** menubar-menus

## Problem

Native (non-Electron) apps need to contribute menus to the MenuBar through the same rendering path as Electron apps.

## Changes

1. **`src/os/types.ts`**:
   ```ts
   export interface NativeMenuItemTemplate {
     type?: 'normal' | 'separator' | 'checkbox' | 'radio';
     label?: string; accelerator?: string; enabled?: boolean; checked?: boolean;
     click?: () => void; submenu?: NativeMenuItemTemplate[];
   }
   export interface AppDefinition { /* existing */ menu?: (ctx: { system: SystemActions }) => NativeMenuItemTemplate[]; }
   ```
2. **New `src/desktop/native-menu.ts`**: `resolveNativeMenu(template): ResolvedMenu` — assigns commandIds, keeps a click map, produces the same shape the MenuBar consumes.
3. **`src/os/apps.tsx`**: real menus for 2-3 native apps as proof — Finder (File > New Finder Window), Terminal (Shell > New Window, Edit), Settings.
4. **`src/desktop/Desktop.tsx`**: wire native branch of menu resolution (rebuild on focus change).

## Verification

Focus Finder → File menu contains New Finder Window and it works; focus Terminal → Shell menu; unfocused → default. Type-check passes.
