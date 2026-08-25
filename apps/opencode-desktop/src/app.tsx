import { fileURLToPath } from "node:url";
import clipboard from "clipboardy";
import { createEffect, createSignal, Match, onCleanup, Show, Switch, untrack } from "solid-js";
import { promptForPaths, readClipboard, render, type DropFilesEvent, type InputEvent, type KeyEvent } from "solid-gpui";
import { attachmentFromImage, attachmentFromMention, attachmentFromPath, attachmentFromReference, attachmentFromResource, attachmentToken, fileMentions, type ComposerAttachment } from "./attachments.js";
import { loadConfig } from "./config.js";
import { ComposerHistory, type ComposerMode } from "./composer-history.js";
import { activeFileMention, insertText, replaceFileMention, type EditorState } from "./editor.js";
import { OpenCodeController, type MessageDraft, type OpenCodeState } from "./opencode.js";
import { color, raisedShadow } from "./theme.js";
import { Composer, ModelPicker } from "./composer.js";
import { PermissionDialog, QuestionDialog } from "./dialogs.js";
import { Sidebar } from "./sidebar.js";
import { TranscriptWindowView } from "./transcript-window.js";
import { Button, run } from "./ui.js";
import { QueueDock } from "./session-controls.js";
import { FileWorkspace } from "./file-workspace.js";
import { ReviewWorkspace } from "./review-workspace.js";
import { TerminalPanel, TodoDock } from "./workspace-panels.js";
import { formatCommentNote, selectionID, type LineSelection, type PromptContext } from "./workspace-model.js";
import { WorkspacePersistence } from "./workspace-persistence.js";
import { launchProjectWindow } from "./project-window.js";
import { agentMentions, type MentionSuggestion } from "./mentions.js";
import { createModelSelection } from "./model-selection.js";
import { AppChrome, SessionHeader, type WorkspaceView } from "./app-chrome.js";
const config = loadConfig(); // Process-level configuration belongs to the desktop shell.
const controller = new OpenCodeController(config);

function EmptyState(props: { state: OpenCodeState }) {
  return (
    <div style={{ position: "relative", flexDirection: "column", flexGrow: 1, minHeight: 220, alignItems: "center", justifyContent: "center", gap: 8, overflow: "hidden" }}>
      <div style={{ position: "absolute", color: "#ffffff08", fontSize: 76, fontWeight: "bold" }}>OPENCODE</div>
      <div style={{ color: color.text, fontSize: 16, fontWeight: "semibold" }}>{props.state.selectedID ? "What do you want to build?" : "No session selected"}</div>
      <div style={{ maxWidth: 430, color: color.tertiary, fontSize: 10, lineHeight: 17, textAlign: "center" }}>
        {props.state.selectedID ? "Ask about this project, reference files with @, or run a command." : "Create a session to start working with OpenCode."}
      </div>
      <Show when={!props.state.selectedID}>
        <Button tone="primary" onClick={() => run(() => controller.createSession())}>New session</Button>
      </Show>
    </div>
  );
}

function OfflineState(props: { state: OpenCodeState }) {
  return (
    <div style={{ flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 30 }}>
      <div style={{ color: color.red, fontSize: 22 }}>●</div>
      <div style={{ fontSize: 17, fontWeight: "bold" }}>OpenCode is unavailable</div>
      <div style={{ maxWidth: 550, color: color.secondary, fontSize: 12, lineHeight: 19, textAlign: "center" }}>{props.state.error ?? "Could not connect"}</div>
      <div style={{ padding: 10, borderRadius: 7, background: color.raised, color: color.tertiary, fontFamily: "monospace", fontSize: 10 }}>
        Install the opencode CLI, or set OPENCODE_URL and OPENCODE_PASSWORD.
      </div>
      <Button tone="primary" onClick={() => run(() => controller.retry())}>Retry connection</Button>
    </div>
  );
}

function App() {
  const history = new ComposerHistory({ projectDirectory: config.directory });
  const workspace = new WorkspacePersistence({ projectDirectory: config.directory });
  const storedSessionTabs = workspace.sessionTabs();
  const [state, setState] = createSignal(controller.state);
  const [collapsed, setCollapsed] = createSignal(true);
  const [composerActive, setComposerActive] = createSignal(true);
  const [modelOpen, setModelOpen] = createSignal(false);
  const [view, setView] = createSignal<WorkspaceView>("chat");
  const [editor, setEditor] = createSignal<EditorState>({ value: "", cursor: 0 });
  const [mode, setMode] = createSignal<ComposerMode>("prompt");
  const [mentionMatches, setMentionMatches] = createSignal<MentionSuggestion[]>([]);
  const [mentionSelected, setMentionSelected] = createSignal(0);
  const [attachments, setAttachments] = createSignal<ComposerAttachment[]>([]);
  const [selectedAgentMentions, setSelectedAgentMentions] = createSignal<string[]>([]);
  const [contexts, setContexts] = createSignal<PromptContext[]>([]);
  const [sessionTabs, setSessionTabs] = createSignal(storedSessionTabs.open);
  const [closedSessionTabs, setClosedSessionTabs] = createSignal(storedSessionTabs.closed);
  const models = createModelSelection(controller, state);
  let imageSequence = 0;
  let mentionSearch = 0;
  const unsubscribe = controller.subscribe(setState);
  onCleanup(() => {
    history.saveDraft(state().selectedID, editor().value);
    history.flush();
    workspace.saveContexts(state().selectedID, contexts());
    workspace.saveSessionTabs(sessionTabs(), state().selectedID, closedSessionTabs());
    workspace.flush();
    unsubscribe();
    controller.stop();
  });
  queueMicrotask(() => run(() => controller.connect()));

  let sessionTabsRestored = false;
  createEffect(
    () => ({ connection: state().connection, sessionIDs: state().sessions.map((session) => session.id), selectedID: state().selectedID }),
    ({ connection, sessionIDs, selectedID }) => {
      if (connection !== "connected" || sessionTabsRestored || sessionIDs.length === 0) return;
      untrack(() => {
        const available = new Set(sessionIDs);
        const restored = workspace.sessionTabs();
        const selected = restored.selected && available.has(restored.selected) ? restored.selected : selectedID;
        const open = restored.open.filter((id) => available.has(id));
        const nextOpen = selected && !open.includes(selected) ? [...open, selected] : open;
        const closed = restored.closed.filter((id) => available.has(id) && !nextOpen.includes(id));
        setSessionTabs(nextOpen);
        setClosedSessionTabs(closed);
        sessionTabsRestored = true;
        workspace.saveSessionTabs(nextOpen, selected, closed);
        if (selected && selected !== selectedID) run(() => controller.selectSession(selected));
      });
    },
  );
  createEffect(
    () => state().selectedID,
    (selectedID) => {
      untrack(() => {
        if (!sessionTabsRestored || !selectedID || !state().sessions.some((session) => session.id === selectedID)) return;
        const open = sessionTabs().includes(selectedID) ? sessionTabs() : [...sessionTabs(), selectedID].slice(-20);
        const closed = closedSessionTabs().filter((id) => id !== selectedID);
        setSessionTabs(open);
        setClosedSessionTabs(closed);
        workspace.saveSessionTabs(open, selectedID, closed);
      });
    },
  );
  createEffect(
    () => state().sessions.map((session) => session.id).join("\0"),
    () => {
      untrack(() => {
        if (!sessionTabsRestored) return;
        const available = new Set(state().sessions.map((session) => session.id));
        const open = sessionTabs().filter((id) => available.has(id));
        const closed = closedSessionTabs().filter((id) => available.has(id) && !open.includes(id));
        setSessionTabs(open);
        setClosedSessionTabs(closed);
        workspace.saveSessionTabs(open, state().selectedID, closed);
      });
    },
  );
  const closeSessionTab = (id: string) => {
    const open = sessionTabs();
    const index = open.indexOf(id);
    if (index < 0) return;
    const nextOpen = open.filter((item) => item !== id);
    const closed = [...closedSessionTabs().filter((item) => item !== id), id].slice(-20);
    setSessionTabs(nextOpen);
    setClosedSessionTabs(closed);
    const nextSelected = state().selectedID === id ? nextOpen[index] ?? nextOpen[index - 1] : state().selectedID;
    workspace.saveSessionTabs(nextOpen, nextSelected, closed);
    if (nextSelected && nextSelected !== state().selectedID) run(() => controller.selectSession(nextSelected));
  };
  const reopenSessionTab = () => {
    const id = [...closedSessionTabs()].reverse().find((item) => state().sessions.some((session) => session.id === item));
    if (!id) return;
    const open = [...sessionTabs().filter((item) => item !== id), id].slice(-20);
    const closed = closedSessionTabs().filter((item) => item !== id);
    setSessionTabs(open);
    setClosedSessionTabs(closed);
    workspace.saveSessionTabs(open, id, closed);
    run(() => controller.selectSession(id));
  };

  let tabsRestored = false;
  createEffect(
    () => state().connection,
    (connection) => {
      if (connection !== "connected" || tabsRestored) return;
      tabsRestored = true;
      const tabs = workspace.tabs();
      run(async () => {
        for (const path of tabs.open) await controller.openFile(path);
        if (tabs.selected) controller.selectOpenFile(tabs.selected);
      });
    },
  );
  createEffect(
    () => ({ open: state().openFiles.map((file) => file.path), selected: state().selectedFile }),
    ({ open, selected }) => {
      if (tabsRestored) workspace.saveTabs(open, selected);
    },
  );

  let draftSession: string | undefined;
  createEffect(
    () => ({ sessionID: state().selectedID, text: editor().value, promptContexts: contexts() }),
    ({ sessionID, text, promptContexts }) => {
      if (sessionID === draftSession) return;
      history.saveDraft(draftSession, text);
      workspace.saveContexts(draftSession, promptContexts);
      draftSession = sessionID;
      setAttachments([]);
      setSelectedAgentMentions([]);
      setContexts(workspace.contexts(sessionID));
      const value = history.draft(sessionID);
      setEditor({ value, cursor: value.length });
    },
  );

  const mention = () => activeFileMention(editor());
  const updateEditor = (next: EditorState) => {
    setEditor(next);
    history.reset();
    history.saveDraft(state().selectedID, next.value);
    const active = activeFileMention(next);
    const generation = ++mentionSearch;
    if (!active) {
      setMentionMatches([]);
      return;
    }
    setMentionSelected(0);
    run(async () => {
      const matches = await controller.searchMentions(active.query);
      if (generation === mentionSearch) setMentionMatches(matches);
    });
  };
  const selectMention = (item: MentionSuggestion) => {
    const active = activeFileMention(editor());
    if (!active) return;
    const replacement = item.kind === "file" || item.kind === "recent" ? item.path : item.kind === "agent" ? item.name : item.label;
    if (item.kind === "agent") setSelectedAgentMentions((current) => current.includes(item.name) ? current : [...current, item.name]);
    else {
      const attachment = item.kind === "reference"
        ? attachmentFromReference({ name: item.label, path: item.path })
        : item.kind === "resource"
          ? attachmentFromResource({ name: item.label, uri: item.uri, client: item.client, mime: item.mime })
          : attachmentFromPath(item.path);
      setAttachments((current) => current.some((currentItem) => currentItem.id === attachment.id) ? current : [...current, attachment]);
    }
    ++mentionSearch;
    setMentionMatches([]);
    setEditor(replaceFileMention(editor(), active, replacement));
    setComposerActive(true);
  };
  const addAttachment = (attachment: ComposerAttachment) => {
    if (attachments().some((item) => item.id === attachment.id)) return;
    setAttachments((current) => [...current, attachment]);
    const prefix = editor().value && !/\s$/.test(editor().value.slice(0, editor().cursor)) ? " " : "";
    updateEditor(insertText(editor(), `${prefix}${attachmentToken(attachment)} `));
    setMode("prompt");
    setView("chat");
    setComposerActive(true);
  };
  const attachFile = (path: string, mime?: string) => addAttachment({ ...attachmentFromPath(path), ...(mime ? { mime } : {}) });
  const attachPaths = (paths: string[]) => paths.forEach((path) => addAttachment(attachmentFromPath(path)));
  const chooseFiles = async () => attachPaths(await promptForPaths({ files: true, multiple: true, prompt: "Attach files" }));
  const openProject = async () => {
    const [directory] = await promptForPaths({ directories: true, prompt: "Open project" });
    if (directory) launchProjectWindow(directory, config);
  };
  const removeAttachment = (id: string) => {
    const attachment = attachments().find((item) => item.id === id);
    setAttachments((current) => current.filter((item) => item.id !== id));
    if (!attachment) return;
    const value = editor().value.replaceAll(attachmentToken(attachment), "").replace(/ {2,}/g, " ");
    updateEditor({ value, cursor: Math.min(editor().cursor, value.length) });
  };
  const addContext = (context: PromptContext) => {
    setContexts((current) => context.comment
      ? persistContexts([...current, context])
      : persistContexts([...current.filter((item) => item.id !== context.id), context]));
    setMode("prompt");
  };
  const addFileContext = (selection: LineSelection, preview: string) => addContext({
    ...selection,
    id: `selection:${selectionID(selection)}`,
    origin: "file",
    preview,
  });
  const persistContexts = (next: PromptContext[]) => {
    workspace.saveContexts(state().selectedID, next);
    return next;
  };
  const removeContext = (id: string) => setContexts((current) => persistContexts(current.filter((item) => item.id !== id)));
  const updateContext = (id: string, comment: string) => setContexts((current) => persistContexts(current.map((item) => item.id === id ? { ...item, comment } : item)));
  const editMessage = (draft: MessageDraft) => {
    setEditor({ value: draft.text, cursor: draft.text.length });
    setAttachments(draft.files.map((file, index) => attachmentFromMention(file, index + 1)));
    setSelectedAgentMentions(draft.agents.map((agent) => agent.name));
    const model = state().models.find((item) => item.providerID === draft.model.providerID && item.id === draft.model.modelID);
    if (model) models.restore(model, draft.variant);
    controller.selectAgent(draft.agent);
    setMode("prompt");
    setView("chat");
    setComposerActive(true);
    history.saveDraft(state().selectedID, draft.text);
  };
  const send = async () => {
    const text = editor().value.trim();
    if ((!text && contexts().length === 0) || state().connection !== "connected") return;
    if (!state().selectedID) await controller.createSession();
    const currentMode = mode();
    const command = currentMode === "prompt" ? /^\/(\S+)(?:\s+(.*))?$/.exec(text) : null;
    const knownCommand = command && state().commands.some((item) => item.name === command[1]);
    const files = fileMentions(text, attachments());
    const agents = agentMentions(text, selectedAgentMentions());
    const submittedAttachments = attachments();
    const promptContexts = contexts();
    const contextFiles = promptContexts.map(({ path, startLine, endLine, side }) => ({ path, startLine, endLine, side }));
    const commentNotes = promptContexts.filter((item) => item.comment).map(formatCommentNote);
    const networkText = [text, ...commentNotes].filter(Boolean).join("\n");
    const sessionID = state().selectedID;
    const submission = currentMode === "shell"
      ? controller.runShell(text)
      : command && knownCommand
        ? controller.runCommand(command[1]!, [command[2] ?? "", ...commentNotes].filter(Boolean).join("\n"), files, contextFiles)
        : controller.send(networkText, files, { contexts: contextFiles, agents });
    history.record(state().selectedID, currentMode, text);
    history.clearDraft(state().selectedID);
    setEditor({ value: "", cursor: 0 });
    setAttachments([]);
    setSelectedAgentMentions([]);
    if (currentMode === "prompt") setContexts(persistContexts([]));
    setMentionMatches([]);
    try {
      await submission;
    } catch (error) {
      const unchanged = state().selectedID === sessionID && editor().value === "" && attachments().length === 0
        && (currentMode !== "prompt" || contexts().length === 0);
      if (unchanged) {
        setEditor({ value: text, cursor: text.length });
        setAttachments(submittedAttachments);
        setSelectedAgentMentions(agents.map((agent) => agent.name));
        if (currentMode === "prompt") setContexts(persistContexts(promptContexts));
        history.saveDraft(sessionID, text);
      }
      throw error;
    }
  };
  const selectCommand = (name: string) => {
    const value = `/${name} `;
    setEditor({ value, cursor: value.length });
    setComposerActive(true);
  };
  const keyDown = (event: KeyEvent) => {
    const shortcut = event.modifiers.platform || event.modifiers.control;
    if (shortcut && event.key === "n") { run(() => controller.createSession()); return; }
    if (shortcut && event.modifiers.shift && event.key === "t") { reopenSessionTab(); return; }
    if (shortcut && event.key === "k") { setModelOpen((value) => !value); return; }
    if (shortcut && event.key === "e") { setMode((value) => value === "prompt" ? "shell" : "prompt"); return; }
    if (shortcut && event.key === "1") { setView("chat"); return; }
    if (shortcut && event.key === "2") { setView("files"); return; }
    if (shortcut && event.key === "3") { setView("review"); return; }
    if (shortcut && event.key === "4") { setView("terminal"); return; }
    if (view() === "terminal") {
      if (shortcut && event.key === "v") { run(async () => controller.sendTerminal(await clipboard.read())); return; }
      if (event.modifiers.control && event.key === "c") { controller.sendTerminal("\x03"); return; }
      if (event.modifiers.control && event.key === "d") { controller.sendTerminal("\x04"); return; }
      if (event.modifiers.control && event.key === "l") { controller.sendTerminal("\x0c"); return; }
      const sequence: Record<string, string> = {
        enter: "\r", backspace: "\x7f", tab: "\t", escape: "\x1b",
        up: "\x1b[A", down: "\x1b[B", right: "\x1b[C", left: "\x1b[D",
        home: "\x1b[H", end: "\x1b[F", delete: "\x1b[3~",
      };
      const input = sequence[event.key] ?? (!event.modifiers.control && !event.modifiers.alt && !event.modifiers.platform ? event.text : null);
      if (input) controller.sendTerminal(input);
      return;
    }
    if (view() !== "chat") return;
    if (shortcut && event.key === "v") {
      run(async () => {
        const entries = await readClipboard();
        for (const entry of entries) {
          if (entry.type === "paths") attachPaths(entry.paths);
          else if (entry.type === "image") addAttachment(attachmentFromImage(entry, ++imageSequence));
        }
      });
      return;
    }
    if (event.key === "escape") { setModelOpen(false); setComposerActive(false); return; }
    if (!composerActive() || state().permission || state().question) return;
    if (mention() && mentionMatches().length > 0) {
      if (event.key === "up") { setMentionSelected((value) => (value - 1 + mentionMatches().length) % mentionMatches().length); return; }
      if (event.key === "down") { setMentionSelected((value) => (value + 1) % mentionMatches().length); return; }
      if (event.key === "enter" && !event.modifiers.shift) { selectMention(mentionMatches()[mentionSelected()]!); return; }
    }
    if (!mention() && editor().anchor === undefined && (event.key === "up" || event.key === "down")) {
      const value = event.key === "up" ? history.previous(state().selectedID, mode(), editor().value) : history.next(state().selectedID, mode(), editor().value);
      setEditor({ value, cursor: value.length });
      return;
    }
    if (event.key === "enter" && event.modifiers.shift) { updateEditor(insertText(editor(), "\n")); return; }
    if (event.key === "enter" && !event.modifiers.shift) { run(send); return; }
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", flexDirection: "column", borderRadius: 12, background: color.deep, color: color.text, fontFamily: "sans-serif", fontSize: 13, overflow: "hidden" }} onKeyDown={keyDown} onDropFiles={(event: DropFilesEvent) => attachPaths(event.paths)}>
      <AppChrome state={state()} sidebarOpen={!collapsed()} openSessions={sessionTabs().length ? sessionTabs() : state().selectedID ? [state().selectedID!] : []} canReopen={closedSessionTabs().some((id) => state().sessions.some((session) => session.id === id))} toggleSidebar={() => setCollapsed((value) => !value)} createSession={() => run(() => controller.createSession())} selectSession={(id) => run(() => controller.selectSession(id))} closeSession={closeSessionTab} reopenSession={reopenSessionTab} />
      <div style={{ flexGrow: 1, minHeight: 0, padding: 8, paddingTop: 0, gap: 8 }}>
        <Show when={!collapsed()}><Sidebar state={state()} onCollapse={() => setCollapsed(true)} onRefresh={() => run(() => controller.refresh())} onOpenProject={() => run(openProject)} onCreate={() => run(() => controller.createSession())} onSelect={(id) => run(() => controller.selectSession(id))} /></Show>
        <div style={{ flexDirection: "column", flexGrow: 1, minWidth: 0, height: "100%", overflow: "hidden", borderRadius: 10, background: color.canvas, boxShadow: raisedShadow }}>
        <Show when={state().connection === "connected"}><SessionHeader state={state()} controller={controller} view={view()} selectView={setView} /></Show>
        <Switch>
          <Match when={state().connection === "offline"}><OfflineState state={state()} /></Match>
          <Match when={state().connection === "connecting"}>
            <div style={{ flexGrow: 1, alignItems: "center", justifyContent: "center", color: color.tertiary, fontSize: 12 }}>Starting OpenCode…</div>
          </Match>
          <Match when={state().connection === "connected"}>
            <Switch>
              <Match when={view() === "files"}><FileWorkspace state={state()} controller={controller} onAttach={attachFile} onContext={addFileContext} /></Match>
              <Match when={view() === "review"}><ReviewWorkspace state={state()} contexts={contexts()} onContext={addContext} onUpdateContext={updateContext} onRemoveContext={removeContext} /></Match>
              <Match when={view() === "terminal"}><TerminalPanel state={state()} controller={controller} /></Match>
              <Match when={view() === "chat"}>
                <div style={{ flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", alignItems: "center", paddingX: 24, paddingTop: state().messages.length > 0 ? 16 : 0, paddingBottom: 28 }}>
                  <div style={{ width: "100%", maxWidth: 1000, flexDirection: "column", flexGrow: 1 }}>
                    <Show when={state().messages.length > 0} fallback={<EmptyState state={state()} />}>
                      <TranscriptWindowView state={state()} controller={controller} edit={editMessage} />
                    </Show>
                  </div>
                </div>
              </Match>
            </Switch>
            <Show when={state().error}>
              <div style={{ paddingX: 44, paddingY: 7, justifyContent: "center", background: "#382326", color: color.red, fontSize: 10 }}>{state().error}</div>
            </Show>
            <Show when={view() === "chat"}>
              <div style={{ flexDirection: "column", flexShrink: 0, alignItems: "center", paddingX: 24, paddingTop: 7, paddingBottom: 12 }}>
                <div style={{ width: 1000, maxWidth: "100%", flexDirection: "column" }}>
                  <TodoDock state={state()} />
                  <QueueDock state={state()} controller={controller} />
                  <Composer state={state()} editor={editor()} active={composerActive()} modelOpen={modelOpen()} mode={mode()} mentionQuery={mode() === "prompt" ? mention()?.query : undefined} mentionMatches={mentionMatches()} mentionSelected={mentionSelected()} attachments={attachments()} contexts={contexts()} activate={() => setComposerActive(true)} toggleModels={() => setModelOpen((value) => !value)} toggleMode={() => setMode((value) => value === "prompt" ? "shell" : "prompt")} selectCommand={selectCommand} selectMention={selectMention} attach={() => run(chooseFiles)} removeAttachment={removeAttachment} removeContext={removeContext} nativeInput={(event) => updateEditor({ value: event.value, cursor: event.selectionEnd, anchor: event.selectionStart === event.selectionEnd ? undefined : event.selectionStart })} nativeKeyDown={keyDown} send={() => run(send)} selectModel={models.select} selectAgent={(name) => controller.selectAgent(name)} modelRecent={models.recent()} modelFavorites={models.favorites()} toggleModelFavorite={models.toggleFavorite} cycleVariant={models.cycleVariant} abort={() => run(() => controller.abort())} />
                </div>
              </div>
            </Show>
          </Match>
        </Switch>
        </div>
      </div>
      <Show when={modelOpen()}><ModelPicker state={state()} recent={models.recent()} favorites={models.favorites()} close={() => setModelOpen(false)} selectModel={models.select} toggleFavorite={models.toggleFavorite} /></Show>
      <PermissionDialog state={state()} reply={(response) => run(() => controller.replyPermission(response))} />
      <QuestionDialog request={state().question} reject={() => run(() => controller.rejectQuestion())} reply={(answers) => run(() => controller.replyQuestion(answers))} />
    </div>
  );
}

await render(() => <App />, {
  title: "OpenCode · Solid GPUI",
  width: 1220,
  height: 840,
  appearance: "transparent",
  titlebarTransparent: true,
  trafficLightPosition: { x: 12, y: 11 },
  hostPath: process.env["SOLID_GPUI_HOST"] ?? fileURLToPath(new URL("../../../crates/solid-gpui-host/target/release/solid-gpui-host", import.meta.url)),
  onClose: () => controller.stop(),
});
