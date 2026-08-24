/**
 * Things the host can be asked to do that are not part of the element tree:
 * moving the window about, and the platform dialogs.
 *
 * Each of these is a round trip. The ones that open a dialog resolve when the
 * user answers it, so they can be awaited like any other asynchronous call.
 */

import { session } from "./session.js";

/** The window this process owns. */
export const appWindow = {
  /** Replaces the title bar's text. */
  setTitle(title: string): Promise<void> {
    return session.call("window.setTitle", { title });
  },
  minimize(): Promise<void> {
    return session.call("window.minimize");
  },
  /** The green button: fills the screen without entering full screen. */
  zoom(): Promise<void> {
    return session.call("window.zoom");
  },
  toggleFullscreen(): Promise<void> {
    return session.call("window.toggleFullscreen");
  },
  /** Brings the window to the front and gives it focus. */
  activate(): Promise<void> {
    return session.call("window.activate");
  },
};

export type MessageLevel = "info" | "warning" | "critical";

export interface MessageOptions {
  message: string;
  detail?: string;
  /** Button labels, left to right. Defaults to a single "OK". */
  answers?: string[];
  level?: MessageLevel;
}

export interface OpenFileOptions {
  /** Allow files to be picked. Defaults to true. */
  files?: boolean;
  /** Allow directories to be picked. Defaults to false. */
  directories?: boolean;
  /** Allow more than one selection. Defaults to false. */
  multiple?: boolean;
  /** The label on the accept button. */
  prompt?: string;
}

export interface SaveFileOptions {
  /** Where the dialog opens. Defaults to the working directory. */
  directory?: string;
  suggestedName?: string;
}

/** The platform's modal dialogs. */
export const dialog = {
  /**
   * A message box. Resolves with the index of the button that was pressed.
   */
  message(options: MessageOptions): Promise<number> {
    return session.call("dialog.message", options);
  },

  /**
   * A file picker. Resolves with the chosen paths, or `null` if it was
   * cancelled.
   */
  openFile(options: OpenFileOptions = {}): Promise<string[] | null> {
    return session.call("dialog.openFile", options);
  },

  /**
   * A save panel. Resolves with the chosen path, or `null` if it was
   * cancelled.
   */
  saveFile(options: SaveFileOptions = {}): Promise<string | null> {
    return session.call("dialog.saveFile", options);
  },
};

/** Handing a path to the rest of the desktop. */
export const shell = {
  /** Shows the path in Finder, or the platform's equivalent. */
  revealPath(path: string): Promise<void> {
    return session.call("shell.revealPath", { path });
  },
  /** Opens the path with whatever application owns it. */
  openWithSystem(path: string): Promise<void> {
    return session.call("shell.openWithSystem", { path });
  },
};
