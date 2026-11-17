import React, { useState, useEffect, useCallback, useRef } from "react";
import { sep, basename } from "path";
import { exec } from "child_process";
import { Box, Text, useApp, useInput, useStdout, measureElement, DOMElement } from "ink";
import { Footer } from "./components/Footer";
import { Working } from "./components/Working";
import { DiffView } from "./components/DiffView";
import { ConnectPopup } from "./components/ConnectPopup";
import { ModelPicker } from "./components/ModelPicker";
import { FilePicker } from "./components/FilePicker";
import { InfoPopup, INFO_FRAME_ROWS } from "./components/InfoPopup";
import { CommandPicker } from "./components/CommandPicker";
import { CommandPalette, PaletteItem } from "./components/CommandPalette";
import { HelpOverlay } from "./components/HelpOverlay";
import { Logo, Tip, LOGO_WIDTH, LOGO_HEIGHT } from "./components/Logo";
import { HistoryItem, estimateHeight, transcriptItems } from "./components/HistoryItem";
import { Fieldset } from "./components/Fieldset";
import { PromptEditor, promptEditorRows } from "./components/PromptEditor";
import { Sidebar } from "./components/Sidebar";
import { AgentRuntime } from "./agent/AgentRuntime";
import { ConfigManager } from "./config/ConfigManager";
import { LLMRouter } from "./llm/LLMRouter";
import { AgentMessage, ToolCall, Attachment } from "./shared/types";
import { BUILTIN_COMMANDS } from "./shared/constants";
import { checkForUpdate, UpdateInfo } from "./shared/updateChecker";
import { getAppVersion } from "./shared/version";
import { parseThinking, getSuggestion, getItemWindow, truncEnd, formatTokens } from "./shared/utils";
import { editKey, EditorState } from "./shared/lineEditor";
import { loadAttachment, listCwdFiles } from "./shared/attachments";
import { theme, modeColors, ICON, Mode, THREAD_BORDER } from "./shared/theme";
import { resolveUiMode, footerHints } from "./shared/keymap";
import { globalCommandRegistry } from "./plugins/registry.js";
import { useSlashCommands, conversationFrom } from "./hooks/useSlashCommands";
import { loadInstructions } from "./agent/projectInstructions";

type AgentStatus = "idle" | "running" | "thinking" | "error";
interface ConfirmRequest {
  toolCall: ToolCall;
  reason: string;
  diffPreview?: import("./agent/AgentRuntime").DiffPreview;
  dangerous?: boolean;
}
interface AppProps {
  initialCommand?: string;
  cwd: string;
  /** Start by picking up the last session in this folder (--continue). */
  resume?: boolean;
  /** Mouse wheel steps (-1 up, +1 down) from the fullscreen input proxy. */
  wheel?: import("events").EventEmitter;
  onStatusChange?: (status: string, cwd: string) => void;
}

/** The session sidebar appears from this terminal width on. */
const SIDEBAR_MIN_COLS = 120;
const SIDEBAR_WIDTH = 38;
/** PgUp / PgDn scroll this many rows. */
const SCROLL_PAGE = 15;
const ROWS_CONFIRM_CHROME = 4; // frame top/bottom + reason row + gap
const ROWS_DIFF_HEADER = 1;
const TOOL_OUTPUT_POPUP_LINES = 200;
/** Preferred width of the centred prompt on the start screen. */
const SPLASH_PANEL_WIDTH = 72;
/** Lines of a running command's output shown live. */
const LIVE_OUTPUT_LINES = 8;
/** From this share of the context window on, the UI suggests /compact. */
const CONTEXT_WARN = 0.8;
/** Prompt frame chrome: border + padding + the "▍ " mode marker. */
const PROMPT_CHROME_COLS = 6;

// ── App ───────────────────────────────────────────────────────────────────────
//
// Fullscreen: the transcript fills the screen and scrolls inside the app, the
// prompt sits at the bottom, and wide terminals get a session sidebar on the
// right. Before the first message a centred start screen shows the logo and
// the prompt. The app is the only keyboard listener for the prompt — text
// editing is done by shared/lineEditor.
export const App: React.FC<AppProps> = ({
  initialCommand,
  cwd,
  resume,
  wheel,
  onStatusChange,
}) => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cm = ConfigManager.getInstance();

  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle");
  const [currentTokens, setCurrentTokens] = useState("");
  const [tokenCount, setTokenCount] = useState(0);
  const [history, setHistory] = useState<string[]>(() => cm.getHistory());
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  // Text and cursor are ONE state: Ink re-renders synchronously after every
  // single state change here, so two separate states would briefly show (and
  // hand the next key) new text with the old cursor.
  const [editor, setEditorState] = useState<EditorState>({ value: "", cursor: 0 });
  const inputValue = editor.value;
  const cursor = Math.min(editor.cursor, editor.value.length);
  /**
   * The prompt as of the latest keypress. Ink re-registers the key handler
   * only after a re-render, so keys arriving in quick succession (held ←,
   * fast typing, text + Enter) would otherwise each see the same stale text.
   * Edits read and write this ref first.
   */
  const editorRef = useRef<EditorState>(editor);
  editorRef.current = { value: inputValue, cursor };
  const [histIndex, setHistIndex] = useState(-1);
  const [pickerIdx, setPickerIdx] = useState(0);

  const [connectPopup, setConnectPopup] = useState(false);
  const [modelPicker, setModelPicker] = useState(false);
  const [modelList, setModelList] = useState<string[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const [filePicker, setFilePicker] = useState(false);
  const [fileList, setFileList] = useState<string[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mode, setMode] = useState<Mode>(() =>
    cm.get().debugMode ? "debug" : "build"
  );
  const [pluginCmds, setPluginCmds] = useState<
    Array<{ cmd: string; description: string }>
  >([]);
  const [convHistory, setConvHistory] = useState<
    import("./shared/types").Message[]
  >([]);
  const [infoPopup, setInfoPopup] = useState<{
    title: string;
    content: string;
  } | null>(null);
  const [infoScroll, setInfoScroll] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  /** Rows the transcript is scrolled up from the bottom (0 = following). */
  const [scrollOffset, setScrollOffset] = useState(0);
  /** Tokens the last request used, and the model's context window. */
  const [contextTokens, setContextTokens] = useState(0);
  const [contextLimit, setContextLimit] = useState<number | null>(null);
  const [nativeTools, setNativeTools] = useState<boolean | null>(null);
  const [rules, setRules] = useState<string[]>([]);
  /** Output of the command or tool running right now. */
  const [liveOutput, setLiveOutput] = useState<{ title: string; text: string } | null>(null);
  /** An automatic save of an earlier session exists for this folder. */
  const [canContinue] = useState(() => !resume && !!cm.loadSession(cm.autosaveName(cwd))?.length);

  const taskQueueRef = useRef<string[]>([]);
  const crashCompactRef = useRef(false);
  const agentRef = useRef<AgentRuntime | null>(null);
  const toolMsgsRef = useRef<import("./shared/types").Message[]>([]);
  const tokenBufRef = useRef("");
  const tokenCntRef = useRef(0);
  const tokenFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamInThinkingRef = useRef(false);
  const agentStartTimeRef = useRef(0);

  const [termRows, setTermRows] = useState(stdout.rows || 24);
  const [termCols, setTermCols] = useState(stdout.columns || 80);

  // Stable ref that holds the latest state values
  const s = useRef({
    agentStatus,
    isRunning: false,
    attachments,
    mode,
    pickerIdx,
    messages,
    convHistory,
    debugMode: mode === "debug",
  });
  s.current = {
    agentStatus,
    isRunning: agentStatus === "thinking" || agentStatus === "running",
    attachments,
    mode,
    pickerIdx,
    messages,
    convHistory,
    debugMode: mode === "debug",
  };

  const config = cm.get();
  /** The settings this mode runs with — plan/debug may use their own model. */
  const llm = LLMRouter.forMode(config.llm, mode);

  const totalTokens =
    messages
      .filter((m) => m.type === "done" && m.tokenCount)
      .reduce((sum, m) => sum + (m.tokenCount ?? 0), 0) + tokenCount;

  // Slash-command picker: filter commands when input starts with /
  const allSlashCmds = [...BUILTIN_COMMANDS, ...pluginCmds];
  const slashCmds =
    inputValue.startsWith("/") &&
    !inputValue.includes("\n") &&
    agentStatus === "idle" &&
    !connectPopup &&
    !modelPicker &&
    !filePicker &&
    !paletteOpen
      ? allSlashCmds
          .filter((c) =>
            c.cmd.toLowerCase().startsWith(inputValue.toLowerCase()),
          )
          .slice(0, 7)
      : [];
  const showPicker = slashCmds.length > 0;

  const suggestion =
    !showPicker && !connectPopup && !modelPicker && agentStatus === "idle" && cursor === inputValue.length
      ? getSuggestion(inputValue, history)
      : "";
  const isRunning = agentStatus === "thinking" || agentStatus === "running";
  // Instruction files can be created or edited between tasks — look again after each one.
  useEffect(() => {
    if (!isRunning) setRules(loadInstructions(cwd).sources);
  }, [isRunning, cwd]);

  // Exactly one mode owns the keyboard — see shared/keymap.ts.
  const uiMode = resolveUiMode({
    popupOpen: connectPopup || modelPicker || filePicker || paletteOpen,
    helpOpen,
    infoOpen: !!infoPopup,
    confirmOpen: !!confirm,
    pickerOpen: showPicker,
  });

  useEffect(() => {
    onStatusChange?.(agentStatus, cwd);
  }, [agentStatus]);

  useEffect(() => {
    const onResize = () => {
      setTermRows(stdout.rows || 24);
      setTermCols(stdout.columns || 80);
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  // New output follows the bottom of the transcript.
  useEffect(() => {
    setScrollOffset(0);
  }, [messages.length]);

  // A cleared conversation uses no context.
  useEffect(() => {
    if (messages.length === 0) setContextTokens(0);
  }, [messages.length]);

  // Git branch for the project label — resolved once, never blocks first paint.
  const [branch, setBranch] = useState("");
  useEffect(() => {
    let cancelled = false;
    exec("git rev-parse --abbrev-ref HEAD", { cwd, timeout: 1500 }, (err, out) => {
      if (!cancelled) setBranch(err ? "" : out.trim());
    });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  // The model's context window — asked again whenever the model changes.
  const contextKey = `${llm.provider}|${llm.baseURL ?? ""}|${llm.model}`;
  useEffect(() => {
    let alive = true;
    setContextLimit(null);
    LLMRouter.contextLength(llm).then((n) => {
      if (alive) setContextLimit(n);
    });
    setNativeTools(null);
    (llm.toolMode === "text"
      ? Promise.resolve(false)
      : llm.toolMode === "native"
        ? Promise.resolve(true)
        : LLMRouter.supportsTools(llm)
    ).then((v) => {
      if (alive) setNativeTools(v);
    });
    return () => {
      alive = false;
    };
  }, [contextKey]);

  // Background update check — runs once on mount, non-blocking
  useEffect(() => {
    checkForUpdate(getAppVersion()).then((info) => {
      if (info) setUpdateInfo(info);
    });
  }, []);

  useEffect(() => {
    setPluginCmds(
      globalCommandRegistry
        .listCommands()
        .map((c) => ({ cmd: c.cmd, description: c.description })),
    );
  }, []);

  // Every change to the conversation is saved for --continue / /continue.
  useEffect(() => {
    if (messages.length === 0) return;
    const t = setTimeout(() => cm.saveSession(cm.autosaveName(cwd), messages), 600);
    return () => clearTimeout(t);
  }, [messages]);

  const showInfo = useCallback((title: string, lines: string[]) => {
    setInfoPopup({ title, content: lines.join("\n") });
    setInfoScroll(0);
  }, []);

  const addMsg = useCallback((msg: Omit<AgentMessage, "id" | "timestamp">) => {
    setMessages((prev) => [
      ...prev,
      { ...msg, id: nextId(), timestamp: Date.now() },
    ]);
  }, []);

  /** Pick up the last session in this folder. */
  const continueSession = useCallback(() => {
    const loaded = cm.loadSession(cm.autosaveName(cwd));
    if (!loaded?.length) {
      addMsg({ type: "error", content: "There is no earlier session in this folder to continue." });
      return;
    }
    setMessages(loaded);
    setConvHistory(conversationFrom(loaded));
  }, [cwd]);

  /** Replace the prompt text, cursor at the end. */
  const setEditor = useCallback((value: string) => {
    const next = { value, cursor: value.length };
    editorRef.current = next;
    setEditorState(next);
  }, []);

  const clearInput = useCallback(() => {
    setEditor("");
    setHistIndex(-1);
  }, []);

  const cycleMode = useCallback((backwards: boolean) => {
    setMode((m) => {
      const next: Mode = backwards
        ? m === "build" ? "debug" : m === "debug" ? "plan" : "build"
        : m === "build" ? "plan" : m === "plan" ? "debug" : "build";
      cm.set({ debugMode: next === "debug" });
      return next;
    });
  }, []);

  /** Choose the model for the current mode (build mode's is the default for all). */
  const setModelForMode = (model: string) => {
    const cur = cm.get().llm;
    if (mode === "build") {
      cm.setLLM({ model });
      addMsg({ type: "done", content: `Switched to ${model}` });
    } else {
      cm.setLLM({ modeModels: { ...cur.modeModels, [mode]: model } });
      addMsg({
        type: "done",
        content: `${mode} mode now uses ${model} (build mode keeps ${cur.model}). /model reset goes back.`,
      });
    }
  };

  /**
   * Text changed by typing or pasting. A dropped/pasted file path becomes an
   * attachment, and "@" opens the file picker.
   */
  const applyEdit = (next: EditorState) => {
    const v = next.value;
    if (v !== inputValue) {
      const trimmed = v.trim().replace(/^["']|["']$/g, "");
      const isWindowsPath = /^[A-Za-z]:[\\\/].{2,}/.test(trimmed) && !trimmed.includes("\n");
      const isUnixPath = /^\/[^\s\/]+\/[^\s]*$/.test(trimmed);
      if (isWindowsPath || isUnixPath) {
        clearInput();
        setPickerIdx(0);
        loadAttachment(trimmed, cwd).then((att) => {
          if (att) setAttachments((prev) => [...prev, att]);
          else setEditor(v);
        });
        return;
      }
      const atMatch = v.slice(0, next.cursor).match(/(^|\s)@(\S*)$/);
      if (atMatch && next.cursor === v.length) {
        const query = atMatch[2].toLowerCase();
        listCwdFiles(cwd).then((files) => {
          const filtered = query ? files.filter((f) => f.toLowerCase().includes(query)) : files;
          setFileList(filtered.slice(0, 200));
          setFilePicker(true);
          setEditor(v.slice(0, v.lastIndexOf("@")));
        });
        return;
      }
      setHistIndex(-1);
      setPickerIdx(0);
    }
    editorRef.current = next;
    setEditorState(next);
  };

  const { handleSubmit } = useSlashCommands({
    cwd,
    exit,
    addMsg,
    showInfo,
    setInputValue: setEditor,
    setHistIndex,
    setPickerIdx,
    setAgentStatus,
    setCurrentTokens,
    setTokenCount,
    setHistory,
    setMessages,
    setConvHistory,
    setAttachments,
    setMode,
    setConnectPopup,
    setModelPicker,
    setModelLoading,
    setModelList,
    setFilePicker,
    setFileList,
    setConfirm,
    setPluginCmds,
    setInfoScroll,
    setContextTokens,
    setLiveOutput,
    s,
    agentRef,
    taskQueueRef,
    crashCompactRef,
    tokenBufRef,
    tokenCntRef,
    tokenFlushRef,
    toolMsgsRef,
    streamInThinkingRef,
    agentStartTimeRef,
  });

  useEffect(() => {
    if (resume) continueSession();
    if (initialCommand) {
      const t = setTimeout(() => handleSubmit(initialCommand), 150);
      return () => clearTimeout(t);
    }
  }, []);

  /** Full reasoning of the last answer, in the scrollable popup. */
  const showLastReasoning = () => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      const text =
        m.type === "done" ? parseThinking(m.content).thinking.trim()
        : m.type === "thinking" ? m.content.trim()
        : "";
      if (text) {
        showInfo("reasoning", text.split("\n"));
        return;
      }
    }
  };

  /** Full output of every tool the last turn ran, in the scrollable popup. */
  const showLastToolOutput = () => {
    let start = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.type === "text" && m.content.startsWith("> ") && !m.content.startsWith("> [btw]")) {
        start = i;
        break;
      }
    }
    const lines: string[] = [];
    for (const m of messages.slice(start)) {
      if (m.type !== "tool_result" || !m.toolCall) continue;
      const args = JSON.stringify(m.toolCall.arguments);
      lines.push(`**${m.toolCall.tool}  ${args.length > 80 ? args.slice(0, 79) + "…" : args}**`);
      const body = m.toolResult?.success
        ? m.toolResult.output || "(no output)"
        : `error: ${m.toolResult?.error || "unknown"}`;
      const out = body.split("\n");
      lines.push(...out.slice(0, TOOL_OUTPUT_POPUP_LINES).map((l) => "  " + l));
      if (out.length > TOOL_OUTPUT_POPUP_LINES)
        lines.push(`  … ${out.length - TOOL_OUTPUT_POPUP_LINES} more lines`);
      lines.push("");
    }
    if (lines.length) showInfo("tool output", lines);
  };

  const hasToolResults = messages.some((m) => m.type === "tool_result");
  const hasReasoning = messages.some(
    (m) =>
      (m.type === "thinking" && m.content.trim()) ||
      (m.type === "done" && parseThinking(m.content).thinking.trim()),
  );
  const contextShare = contextLimit && contextTokens ? contextTokens / contextLimit : null;

  // ── Layout ────────────────────────────────────────────────────────────────
  // Start screen until the first message; after that the transcript fills the
  // screen above the prompt, with the session sidebar on wide terminals.
  const showSplash =
    messages.length === 0 &&
    agentStatus === "idle" &&
    !confirm &&
    !helpOpen &&
    !infoPopup &&
    !connectPopup &&
    !modelPicker &&
    !filePicker &&
    !paletteOpen &&
    !liveOutput;
  const splashPanelW = Math.max(24, Math.min(SPLASH_PANEL_WIDTH, termCols - 4));
  const showSidebar = !showSplash && termCols >= SIDEBAR_MIN_COLS;
  const mainW = termCols - (showSidebar ? SIDEBAR_WIDTH : 0);
  /** Width of everything inside the main column (one column of padding each side). */
  const contentW = Math.max(20, mainW - 2);
  const showHeader = !showSplash && !showSidebar;
  const promptW = showSplash ? splashPanelW : contentW;
  const editorW = Math.max(4, promptW - PROMPT_CHROME_COLS);
  const editorMaxRows = Math.max(2, Math.min(10, Math.floor(termRows / 4)));
  /** The prompt frame: top border, the text rows, bottom border (+ attachments). */
  const promptRows =
    2 + promptEditorRows(inputValue, editorW, editorMaxRows) + (attachments.length > 0 ? 1 : 0);
  const chromeRows =
    (updateInfo ? 1 : 0) + (showHeader ? 2 : 0) + 1 /* gap */ + promptRows + 1 /* footer */;

  // Approval dialog: never more than half the screen, so the transcript stays visible.
  const confirmDiffRows = confirm?.diffPreview
    ? confirm.diffPreview.contextBefore.length +
      confirm.diffPreview.oldLines.length +
      confirm.diffPreview.newLines.length +
      confirm.diffPreview.contextAfter.length +
      ROWS_DIFF_HEADER
    : 0;
  const confirmRows = confirm
    ? Math.min(
        ROWS_CONFIRM_CHROME + (confirm.dangerous ? 1 : 0) + confirmDiffRows,
        Math.floor(termRows / 2),
      )
    : 0;
  const confirmDiffMaxLines = Math.max(
    4,
    confirmRows - ROWS_CONFIRM_CHROME - (confirm?.dangerous ? 1 : 0) - ROWS_DIFF_HEADER,
  );
  /** Rows an overlay (info / help / palette) may use. */
  const overlayRows = Math.max(6, termRows - chromeRows);
  const infoPage = Math.max(1, overlayRows - INFO_FRAME_ROWS);
  const infoMaxScroll = infoPopup
    ? Math.max(0, infoPopup.content.split("\n").length - infoPage)
    : 0;

  // ── Transcript scrolling ──────────────────────────────────────────────────
  // Items sit bottom-aligned in a clipped viewport; scrolling pushes them down
  // with a negative bottom margin, so the position is exact. Heights are only
  // estimated to decide which items are worth rendering; Ink's measurement of
  // the previous frame replaces the estimate for the scroll range.
  const viewportRef = useRef<DOMElement>(null);
  const contentRef = useRef<DOMElement>(null);
  const layoutRef = useRef({ viewH: 0, total: 0 });
  const items = transcriptItems(messages);
  const heights = items.map((it) => estimateHeight(it, contentW));
  const viewRows = layoutRef.current.viewH || Math.max(3, termRows - chromeRows);
  const knownTotal = layoutRef.current.total || heights.reduce((a, b) => a + b, 0);
  const maxScroll = Math.max(0, knownTotal - viewRows);
  const safeOffset = Math.min(scrollOffset, maxScroll);
  const win = getItemWindow(heights, viewRows, safeOffset);
  /** Scroll up by n rows, never past the top of the transcript. */
  const scrollUp = (n: number) => setScrollOffset(() => Math.min(safeOffset + n, maxScroll));
  const scrollDown = (n: number) => setScrollOffset(() => Math.max(0, safeOffset - n));

  useEffect(() => {
    const viewH = viewportRef.current ? measureElement(viewportRef.current).height : 0;
    const contentH = contentRef.current ? measureElement(contentRef.current).height : 0;
    const total = contentH + win.linesBelow + win.linesAbove;
    layoutRef.current = { viewH, total };
    // Scrolled past the real top (the estimate was too generous): snap back.
    if (viewH > 0 && win.start === 0 && scrollOffset > Math.max(0, total - viewH)) {
      setScrollOffset(Math.max(0, total - viewH));
    }
  });

  // Mouse wheel: scrolls an open info popup, otherwise the transcript.
  const onWheelRef = useRef<(dir: number) => void>(() => {});
  onWheelRef.current = (dir: number) => {
    if (infoPopup) {
      setInfoScroll((v) => Math.max(0, Math.min(infoMaxScroll, v + dir * 3)));
    } else if (!helpOpen && !paletteOpen) {
      if (dir < 0) scrollUp(3);
      else scrollDown(3);
    }
  };
  useEffect(() => {
    if (!wheel) return;
    const onWheel = (dir: number) => onWheelRef.current(dir);
    wheel.on("wheel", onWheel);
    return () => {
      wheel.off("wheel", onWheel);
    };
  }, [wheel]);

  /** Live answer lines shown at the bottom of the transcript while streaming. */
  const maxStreamLines = Math.max(4, Math.floor(viewRows * 0.75));
  const innerStreamW = Math.max(10, contentW - 4);

  /**
   * Enter with the slash picker open runs the highlighted command, not the
   * half-typed prefix; a command that takes an argument is inserted instead.
   */
  const submitPrompt = (value: string) => {
    const sel = showPicker ? slashCmds[pickerIdx] : undefined;
    if (sel && sel.cmd.trim() !== value.trim()) {
      if (sel.cmd.endsWith(" ")) {
        setEditor(sel.cmd);
        setPickerIdx(0);
        return;
      }
      handleSubmit(sel.cmd.trim());
      return;
    }
    handleSubmit(value);
  };

  /** Palette choice → the matching action. */
  const onPalettePick = (item: PaletteItem) => {
    setPaletteOpen(false);
    switch (item.kind) {
      case "command": {
        const full = allSlashCmds.find((c) => c.cmd.trim() === item.label);
        if (full?.cmd.endsWith(" ")) setEditor(full.cmd);
        else handleSubmit(item.label);
        return;
      }
      case "model":
        setModelForMode(item.label);
        return;
      case "session":
        handleSubmit(`/session load ${item.label}`);
        return;
      case "file":
        loadAttachment(item.label, cwd).then((att) => {
          if (att) setAttachments((prev) => [...prev, att]);
        });
        return;
    }
  };

  // ── Keyboard ────────────────────────────────────────────────────────────────
  // One handler per UI mode, dispatched on the mode that owns the keyboard.
  // Modes are exclusive, so a key can never be claimed by two handlers.
  useInput((ch, key) => {
    // Ctrl+C first: close whatever is on top, else abort the run, else clear
    // the prompt, else quit.
    if (key.ctrl && ch === "c") {
      switch (uiMode) {
        case "popup":
          setConnectPopup(false);
          setModelPicker(false);
          setFilePicker(false);
          setPaletteOpen(false);
          return;
        case "help":
          setHelpOpen(false);
          return;
        case "info":
          setInfoPopup(null);
          setInfoScroll(0);
          return;
        default:
          if (agentRef.current) {
            agentRef.current.abort();
            agentRef.current = null;
            taskQueueRef.current = [];
            if (tokenFlushRef.current) {
              clearTimeout(tokenFlushRef.current);
              tokenFlushRef.current = null;
            }
            tokenBufRef.current = "";
            tokenCntRef.current = 0;
            setAgentStatus("idle");
            setCurrentTokens("");
            setConfirm(null);
            setLiveOutput(null);
            addMsg({ type: "error", content: "Aborted." });
          } else if (inputValue) {
            clearInput();
          } else {
            exit();
          }
          return;
      }
    }

    switch (uiMode) {
      // Popups run their own useInput handlers.
      case "popup":
        return;

      case "help":
        if (key.escape || ch === "?") setHelpOpen(false);
        return;

      case "info":
        if (key.escape || ch === "q") {
          setInfoPopup(null);
          setInfoScroll(0);
        } else if (key.upArrow) {
          setInfoScroll((v) => Math.max(0, v - 1));
        } else if (key.downArrow) {
          setInfoScroll((v) => Math.min(infoMaxScroll, v + 1));
        } else if (key.pageUp) {
          setInfoScroll((v) => Math.max(0, v - infoPage));
        } else if (key.pageDown) {
          setInfoScroll((v) => Math.min(infoMaxScroll, v + infoPage));
        }
        return;

      case "confirm":
        if (ch === "y" || ch === "Y") {
          agentRef.current?.confirm(true, false);
          setConfirm(null);
        } else if (ch === "t" || ch === "T") {
          agentRef.current?.confirm(true, true);
          setConfirm(null);
        } else if (ch === "n" || ch === "N" || key.escape) {
          agentRef.current?.confirm(false, false);
          setConfirm(null);
        }
        return;

      case "picker":
        if (key.upArrow) {
          setPickerIdx((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow) {
          setPickerIdx((i) => Math.min(slashCmds.length - 1, i + 1));
          return;
        }
        if (key.tab) {
          const sel = slashCmds[pickerIdx];
          if (sel) {
            setEditor(sel.cmd.endsWith(" ") ? sel.cmd : sel.cmd.trim());
            setPickerIdx(0);
          }
          return;
        }
        if (key.escape) {
          clearInput();
          setPickerIdx(0);
          return;
        }
        if (key.ctrl && ch === "k") {
          clearInput();
          return;
        }
        break; // typing keeps filtering — handled by the editor below

      case "chat": {
        if (key.ctrl && ch === "l") {
          setMessages([]);
          return;
        }
        if (key.ctrl && ch === "k") {
          clearInput();
          return;
        }
        if (key.ctrl && ch === "b") {
          showLastToolOutput();
          return;
        }
        // Full reasoning of the last answer.
        if (key.ctrl && ch === "o") {
          showLastReasoning();
          return;
        }
        if (key.ctrl && ch === "p") {
          setPaletteOpen(true);
          return;
        }
        if (key.pageUp) {
          scrollUp(SCROLL_PAGE);
          return;
        }
        if (key.pageDown) {
          scrollDown(SCROLL_PAGE);
          return;
        }
        if (key.escape) {
          if (inputValue === "" && safeOffset > 0) setScrollOffset(0);
          else clearInput();
          return;
        }
        if (!isRunning && ch === "?" && !key.ctrl && !key.meta && inputValue === "") {
          setHelpOpen(true);
          return;
        }
        if (!isRunning && key.tab) {
          if (suggestion) setEditor(inputValue + suggestion);
          else cycleMode(!!key.shift);
          return;
        }
        break; // the rest edits the prompt
      }
    }

    // ── Prompt editing (chat and picker modes) ──
    const result = editKey(editorRef.current, ch, key, Math.max(1, editorW - 1));
    if (result.kind === "submit") {
      submitPrompt(editorRef.current.value);
    } else if (result.kind === "edit") {
      applyEdit(result.state);
    } else if (result.kind === "edge" && uiMode === "chat" && !isRunning) {
      // ↑ on the first row / ↓ on the last row: prompt history.
      if (result.dir < 0) {
        const next = Math.min(histIndex + 1, history.length - 1);
        if (next < 0) return;
        setHistIndex(next);
        setEditor(history[next] || "");
      } else {
        if (histIndex === -1) return;
        const next = histIndex - 1;
        setHistIndex(next);
        setEditor(next === -1 ? "" : history[next] || "");
      }
    }
  });

  const hints = footerHints({
    uiMode,
    agentMode: mode,
    isRunning,
    hasSuggestion: !!suggestion,
    hasToolResults,
    hasReasoning,
    contextShare: contextShare ?? undefined,
  });

  const projectLabel = basename(cwd) + (branch ? `:${branch}` : "");
  const providerName =
    ({ lmstudio: "LM Studio", ollama: "Ollama", openai: "OpenAI", claude: "Anthropic", openrouter: "OpenRouter" } as Record<string, string>)[
      llm.provider
    ] ?? llm.provider;

  // When the current run started, for the elapsed time on the working line.
  const runStartRef = useRef(0);
  if (isRunning && !runStartRef.current) runStartRef.current = Date.now();
  if (!isRunning) runStartRef.current = 0;

  // ── What the model is producing right now ─────────────────────────────────
  const stream = (() => {
    const parsed = parseThinking(currentTokens);
    const forceThinking =
      streamInThinkingRef.current &&
      !currentTokens.includes("</think>") &&
      !currentTokens.includes("</thinking>");
    const thinking = forceThinking ? currentTokens : parsed.thinking;
    const response = forceThinking ? "" : parsed.response;
    const stillThinking = forceThinking ? true : parsed.stillThinking;
    let answer = response.replace(/```json[\s\S]*?```/gi, "");
    const toolIdx = answer.search(/\{[\s\S]*?"tool"\s*:/);
    if (toolIdx !== -1) answer = answer.slice(0, toolIdx);
    answer = answer.replace(/(?:^|\n)DONE:\s*/gi, "\n").trim();
    let thought = thinking.trim();
    const idx = thought.search(/\{[^}]*"tool"\s*:/);
    if (idx !== -1) thought = thought.slice(0, idx);
    return {
      answer,
      thought: thought.replace(/\s+/g, " ").trim(),
      thinkingNow: stillThinking || (!!thinking && !answer),
      draft: toolDraft(response),
    };
  })();

  // ── Prompt frame ───────────────────────────────────────────────────────────
  //   ┌─ build ─────────────── qwen3.5-9b  lm studio ─┐
  //   │ ▍Ask anything                                  │
  //   └──────────────────────────────── LocalCode:main ─┘
  const renderPrompt = (width: number) => {
    const color = isRunning ? theme.textFaint : modeColors[mode].accent;
    const placeholder = isRunning
      ? "Add a message for the agent"
      : mode === "plan"
        ? "Describe what you want to plan"
        : width >= 60
          ? "Ask anything   / commands   @ attach   ctrl+p palette"
          : width >= 40
            ? "Ask anything   / commands"
            : "Ask anything";
    const modelText = truncEnd(llm.model, Math.max(8, Math.floor(width / 2) - providerName.length - 4));
    const focused = uiMode === "chat" || uiMode === "picker";
    return (
      <Fieldset
        width={width}
        color={theme.border}
        title={[{ text: modeColors[mode].label, color: modeColors[mode].accent }]}
        right={[
          { text: modelText, color: theme.textMuted },
          { text: "  " + providerName.toLowerCase(), color: theme.textFaint },
        ]}
        footer={[{ text: projectLabel, color: theme.textFaint }]}
      >
        {attachments.length > 0 && (
          <Text wrap="truncate-end">
            {attachments.map((att, i) => (
              <Text key={i} color={theme.primary}>{i > 0 ? "   " : ""}@{att.name}</Text>
            ))}
          </Text>
        )}
        <Box>
          <Box flexShrink={0} width={2}>
            <Text color={color}>▍</Text>
          </Box>
          <Box flexGrow={1} minWidth={0}>
            <PromptEditor
              value={inputValue}
              cursor={cursor}
              width={editorW}
              maxRows={editorMaxRows}
              placeholder={placeholder}
              ghost={suggestion}
              focused={focused}
            />
          </Box>
        </Box>
      </Fieldset>
    );
  };

  const renderFooter = (width: number) => (
    <Footer
      width={width}
      hints={hints}
      busy={
        isRunning ? (
          <Working
            label={
              confirm ? "Waiting for you"
              : liveOutput ? "Running"
              : stream.draft ? stream.draft.label
              : stream.answer && !stream.thinkingNow ? "Writing"
              : stream.thinkingNow ? "Thinking"
              : "Working"
            }
            detail={stream.draft ? `${formatTokens(stream.draft.chars)} chars` : undefined}
            startedAt={runStartRef.current || Date.now()}
          />
        ) : undefined
      }
    />
  );

  const renderUpdateBanner = () =>
    updateInfo ? (
      <Box paddingX={1} flexShrink={0}>
        <Text wrap="truncate-end">
          <Text color={theme.warn}>Update available  </Text>
          <Text color={theme.textMuted}>{getAppVersion()} → {updateInfo.latestVersion}</Text>
          <Text color={theme.textFaint}>   run </Text>
          <Text color={theme.textBright}>{updateInfo.updateCommand}</Text>
        </Text>
      </Box>
    ) : null;

  // ── Live answer at the bottom of the transcript ───────────────────────────
  const renderStream = () => {
    if (!isRunning && !currentTokens) return null;
    const lines: string[] = [];
    for (const l of stream.answer ? stream.answer.split("\n") : []) {
      if (!l) { lines.push(""); continue; }
      for (let c = 0; c < l.length; c += innerStreamW) lines.push(l.slice(c, c + innerStreamW));
    }
    const shown = lines.slice(Math.max(0, lines.length - maxStreamLines));
    if (!stream.thought && shown.length === 0) return null;
    const thread = <Text color={theme.thread}>│ </Text>;
    return (
      <Box flexDirection="column" flexShrink={0}>
        {items.length > 0 && <Text color={theme.thread}>│</Text>}
        <Box>
          <Text color={theme.primary}>{ICON.agent} </Text>
          <Text color={theme.textMuted}>localcode</Text>
        </Box>
        {stream.thought && (stream.thinkingNow || shown.length === 0) ? (
          <Box>
            {thread}
            <Box flexGrow={1} minWidth={0}>
              <Text color={theme.textFaint} italic wrap="truncate-start">{ICON.thought} {stream.thought}</Text>
            </Box>
          </Box>
        ) : null}
        {shown.map((line, i) => (
          <Box key={i}>
            {thread}
            <Text color={theme.text} wrap="truncate-end">{line || " "}</Text>
            {i === shown.length - 1 && <Text color={theme.primary}>{ICON.cursor}</Text>}
          </Box>
        ))}
      </Box>
    );
  };

  // ── A command that is running right now, with its output as it arrives ────
  const renderLiveOutput = () => {
    if (!liveOutput) return null;
    const lines = liveOutput.text.replace(/\r/g, "").split("\n").filter((l, i, a) => l || i < a.length - 1);
    const shown = lines.slice(-LIVE_OUTPUT_LINES);
    return (
      <Box flexDirection="column" flexShrink={0}>
        {items.length > 0 && <Text color={theme.thread}>│</Text>}
        <Box>
          <Box flexShrink={0}>
            <Text color={theme.thread}>{ICON.tool} </Text>
          </Box>
          <Box flexGrow={1} minWidth={0}>
            <Text color={theme.text} wrap="truncate-end">{liveOutput.title}</Text>
          </Box>
          <Box flexShrink={0} marginLeft={2}>
            <Text color={theme.primary}>running</Text>
          </Box>
        </Box>
        {shown.length > 0 && (
          <Box
            flexDirection="column"
            borderStyle={THREAD_BORDER}
            borderTop={false}
            borderRight={false}
            borderBottom={false}
            borderColor={theme.thread}
            paddingLeft={4}
          >
            {lines.length > shown.length && (
              <Text color={theme.textFaint}>{ICON.ellipsis} {lines.length - shown.length} earlier lines</Text>
            )}
            {shown.map((l, i) => (
              <Text key={i} color={theme.textDim} wrap="truncate-end">{l || " "}</Text>
            ))}
          </Box>
        )}
      </Box>
    );
  };

  // ── Transcript ─────────────────────────────────────────────────────────────
  // Nothing inside the viewport may set overflow="hidden": Ink 4 replaces the
  // active clip with the innermost one instead of intersecting them, so a
  // clipped row would paint outside the viewport. Rows stay one line with
  // <Text wrap="truncate-…"> instead.
  const renderTranscript = () => (
    <Box flexDirection="column" flexGrow={1} minHeight={0}>
      <Box
        ref={viewportRef}
        flexGrow={1}
        minHeight={0}
        flexDirection="column"
        justifyContent="flex-end"
        overflow="hidden"
      >
        <Box
          ref={contentRef}
          flexDirection="column"
          flexShrink={0}
          width={contentW}
          marginBottom={-Math.max(0, safeOffset - win.linesBelow)}
        >
          {items.slice(win.start, win.end).map((it) => (
            <HistoryItem
              key={it.msg.id}
              item={it}
              model={llm.model}
              mode={mode}
              debugMode={mode === "debug"}
              width={contentW}
            />
          ))}
          {renderLiveOutput()}
          {renderStream()}
        </Box>
      </Box>
      {safeOffset > 0 && (
        <Box paddingX={1} flexShrink={0}>
          <Text wrap="truncate-end">
            <Text color={theme.textFaint}>{ICON.down} </Text>
            <Text color={theme.textMuted}>{safeOffset} lines below</Text>
            <Text color={theme.textFaint}>   esc  back to the latest</Text>
          </Text>
        </Box>
      )}
    </Box>
  );

  // ── Session header (narrow terminals; wide ones have the sidebar) ─────────
  const renderHeader = () => {
    const first = messages.find((m) => m.type === "text" && m.content.startsWith("> "));
    const title = first ? first.content.slice(2).trim().replace(/\s+/g, " ") : "New session";
    const ctx = contextTokens
      ? contextLimit
        ? `${formatTokens(contextTokens)} / ${formatTokens(contextLimit)}`
        : `${formatTokens(contextTokens)} tokens`
      : "";
    const ctxColor =
      contextShare === null ? theme.textFaint
      : contextShare >= 0.95 ? theme.error
      : contextShare >= CONTEXT_WARN ? theme.warn
      : theme.textFaint;
    return (
      <Box paddingX={1} marginBottom={1} flexShrink={0}>
        <Box flexGrow={1} minWidth={0}>
          <Text wrap="truncate-end">
            <Text color={theme.textFaint}>session  </Text>
            <Text color={theme.textBright}>{title}</Text>
          </Text>
        </Box>
        {ctx && (
          <Box flexShrink={0}>
            <Text color={ctxColor}>   {ctx}</Text>
          </Box>
        )}
      </Box>
    );
  };

  // ── Start screen ───────────────────────────────────────────────────────────
  const renderSplash = () => {
    const pageRows = termRows - (updateInfo ? 1 : 0);
    const pickerRows = showPicker ? slashCmds.length + 2 : 0;
    const tipRows = 2;
    const free = pageRows - promptRows - pickerRows - 1 /* footer */;
    const bigLogo = termCols >= LOGO_WIDTH + 4 && free >= LOGO_HEIGHT + 2 + tipRows;
    const smallLogo = !bigLogo && free >= 2 + tipRows;
    const showTip = free >= tipRows + (bigLogo ? LOGO_HEIGHT + 2 : smallLogo ? 2 : 0);
    return (
      <Box flexDirection="column" width={termCols} height={termRows}>
        {renderUpdateBanner()}
        <Box
          flexGrow={1}
          minHeight={0}
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          overflow="hidden"
        >
          {(bigLogo || smallLogo) && (
            <Box marginBottom={bigLogo ? 2 : 1} flexShrink={0}>
              <Logo big={bigLogo} />
            </Box>
          )}
          {renderPrompt(splashPanelW)}
          {showPicker && (
            <Box width={splashPanelW} flexDirection="column" flexShrink={0}>
              <CommandPicker commands={slashCmds} selectedIdx={pickerIdx} width={splashPanelW} />
            </Box>
          )}
          <Box width={splashPanelW} flexShrink={0}>
            {renderFooter(splashPanelW)}
          </Box>
          {showTip && (
            <Box marginTop={1} flexShrink={0}>
              {canContinue ? (
                <Box width={splashPanelW} justifyContent="center">
                  <Text wrap="truncate-end">
                    <Text color={theme.warn}>tip  </Text>
                    <Text color={theme.textMuted}>/continue</Text>
                    <Text color={theme.textFaint}> picks up your last session in this folder</Text>
                  </Text>
                </Box>
              ) : (
                <Tip width={splashPanelW} />
              )}
            </Box>
          )}
        </Box>
      </Box>
    );
  };

  if (showSplash) return renderSplash();

  return (
    <Box flexDirection="row" width={termCols} height={termRows}>
      {/* ── Main column ── */}
      <Box flexDirection="column" width={mainW} height={termRows} paddingX={1}>
        {renderUpdateBanner()}
        {showHeader && renderHeader()}

        {helpOpen || infoPopup || paletteOpen ? (
          <Box flexGrow={1} minHeight={0} flexDirection="column" justifyContent="flex-end">
            {helpOpen ? (
              <HelpOverlay termCols={contentW} maxRows={overlayRows} />
            ) : paletteOpen ? (
              <CommandPalette
                width={contentW}
                maxRows={overlayRows}
                commands={allSlashCmds}
                sessions={cm.listSessions()}
                loadModels={() =>
                  llm.provider === "ollama"
                    ? LLMRouter.getOllamaProvider().listModels(llm.baseURL)
                    : LLMRouter.getLMStudioProvider().listModels(llm.baseURL)
                }
                loadFiles={() => listCwdFiles(cwd)}
                currentModel={llm.model}
                onPick={onPalettePick}
                onCancel={() => setPaletteOpen(false)}
              />
            ) : (
              <InfoPopup
                title={infoPopup!.title}
                content={infoPopup!.content}
                scroll={infoScroll}
                maxRows={overlayRows}
                termCols={contentW}
              />
            )}
          </Box>
        ) : (
          renderTranscript()
        )}

        {/* Approval: the same labelled frame as the prompt, in brass — it needs you */}
        {confirm && !helpOpen && !infoPopup && (
          <Box marginTop={1} flexShrink={0}>
            <Fieldset
              width={contentW}
              color={confirm.dangerous ? theme.error : theme.warn}
              title={[
                {
                  text: confirm.dangerous ? `${ICON.danger} dangerous` : "permission",
                  color: confirm.dangerous ? theme.error : theme.warn,
                },
              ]}
              footer={[
                { text: "y", color: theme.textBright },
                { text: " allow   ", color: theme.textMuted },
                ...(!confirm.dangerous
                  ? [
                      { text: "t", color: theme.textBright },
                      { text: " trust this folder   ", color: theme.textMuted },
                    ]
                  : []),
                { text: "n", color: theme.textBright },
                { text: " deny", color: theme.textMuted },
              ]}
            >
              <Text color={theme.textBright} wrap="truncate-end">
                {/* Paths inside the project read relative, as everywhere else. */}
                {confirm.reason.split(cwd + (cwd.endsWith("\\") || cwd.endsWith("/") ? "" : sep)).join("")}
              </Text>
              {confirm.diffPreview && (
                <Box marginTop={1}>
                  <DiffView
                    filePath={confirm.diffPreview.filePath}
                    oldLines={confirm.diffPreview.oldLines}
                    newLines={confirm.diffPreview.newLines}
                    startLine={confirm.diffPreview.startLine}
                    contextBefore={confirm.diffPreview.contextBefore}
                    contextAfter={confirm.diffPreview.contextAfter}
                    maxLines={confirmDiffMaxLines}
                    width={contentW - 4}
                    bodyOnly
                  />
                </Box>
              )}
            </Fieldset>
          </Box>
        )}

        {connectPopup && (
          <ConnectPopup
            width={contentW}
            onConnect={(provider, baseURL) => {
              cm.setLLM({ provider: provider as any, baseURL });
              setConnectPopup(false);
              addMsg({ type: "done", content: `Connected to ${provider} at ${baseURL}` });
            }}
            onCancel={() => setConnectPopup(false)}
          />
        )}
        {modelPicker && (
          <ModelPicker
            width={contentW}
            models={modelList}
            loading={modelLoading}
            currentModel={llm.model}
            mode={mode}
            onSelect={(model) => {
              setModelPicker(false);
              setModelForMode(model);
            }}
            onCancel={() => setModelPicker(false)}
          />
        )}
        {filePicker && (
          <FilePicker
            width={contentW}
            files={fileList}
            onSelect={async (path) => {
              setFilePicker(false);
              const att = await loadAttachment(path, cwd);
              if (att) setAttachments((prev) => [...prev, att]);
            }}
            onCancel={() => setFilePicker(false)}
          />
        )}
        {showPicker && <CommandPicker commands={slashCmds} selectedIdx={pickerIdx} width={contentW} />}

        {!infoPopup && !helpOpen && !paletteOpen && (
          <Box marginTop={1} flexShrink={0}>
            {renderPrompt(contentW)}
          </Box>
        )}
        {renderFooter(contentW)}
      </Box>

      {/* ── Session sidebar ── */}
      {showSidebar && (
        <Sidebar
          width={SIDEBAR_WIDTH}
          height={termRows}
          messages={messages}
          contextTokens={contextTokens}
          contextLimit={contextLimit}
          model={llm.model}
          provider={providerName}
          mode={mode}
          nativeTools={nativeTools}
          rules={rules}
        />
      )}
    </Box>
  );
};

// Ids must stay unique across sessions: /session load brings back messages
// with ids from an earlier run, and React keys items by id.
let _id = 0;
const ID_PREFIX = Date.now().toString(36);
function nextId(): string {
  return `${ID_PREFIX}-${++_id}`;
}

/**
 * A tool call the model is still writing — a long write_file can stream for
 * minutes, and without this the UI just said "Working…" the whole time.
 */
function toolDraft(response: string): { label: string; chars: number } | null {
  const at = response.search(/\{\s*"tool"\s*:/)
  if (at === -1) return null
  const body = response.slice(at)
  const tool = /"tool"\s*:\s*"([\w-]+)"/.exec(body)?.[1]
  if (!tool) return null
  const path = /"path"\s*:\s*"([^"]+)"/.exec(body)?.[1]
  const verb: Record<string, string> = {
    write_file: "Writing",
    append_file: "Appending to",
    edit_file: "Editing",
    run_shell: "Preparing a command",
  }
  // The path is still JSON-escaped here ("C:\\\\dir\\\\file"): any run of backslashes is a separator.
  const name = path ? path.replace(/\\+/g, "/").split("/").pop() : ""
  const label = verb[tool] ? `${verb[tool]}${name && tool !== "run_shell" ? " " + name : ""}` : `Preparing ${tool}`
  return { label, chars: body.length }
}
