"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const DEFAULT_KEYWORDS = ["BPM", "synthmode", "synthrange", "split"];
let triggerDecoration;
let stateLineDecoration;
let overviewDecoration;
let dedupedDecoration;
class StateItem extends vscode.TreeItem {
    constructor(label, descriptionText, line) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.label = label;
        this.descriptionText = descriptionText;
        this.line = line;
        this.description = descriptionText;
        if (line !== undefined) {
            this.command = {
                command: "revealLine",
                title: "Reveal line",
                arguments: [line]
            };
        }
    }
}
class AscoStateProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.items = [];
    }
    refresh(items) {
        this.items = items;
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren() {
        return Promise.resolve(this.items);
    }
}
function createDecorations() {
    triggerDecoration = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: "rgba(90, 150, 110, 0.16)",
        overviewRulerColor: "rgba(80, 180, 120, 0.95)",
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        before: {
            contentText: "▌",
            color: "rgba(80, 180, 120, 0.95)",
            margin: "0 0.35rem 0 0"
        },
        after: {
            contentText: " synth ✓",
            color: new vscode.ThemeColor("descriptionForeground"),
            margin: "0 0 0 1rem"
        }
    });
    dedupedDecoration = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: "rgba(180, 160, 80, 0.12)",
        overviewRulerColor: "rgba(210, 180, 70, 0.9)",
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        before: {
            contentText: "▌",
            color: "rgba(210, 180, 70, 0.9)",
            margin: "0 0.35rem 0 0"
        },
        after: {
            contentText: " synth repeat",
            color: new vscode.ThemeColor("descriptionForeground"),
            margin: "0 0 0 1rem"
        }
    });
    stateLineDecoration = vscode.window.createTextEditorDecorationType({
        isWholeLine: false,
        overviewRulerColor: "rgba(120, 160, 255, 0.95)",
        overviewRulerLane: vscode.OverviewRulerLane.Left,
        before: {
            contentText: "▎",
            color: "rgba(120, 160, 255, 0.95)",
            margin: "0 0.35rem 0 0"
        }
    });
    overviewDecoration = vscode.window.createTextEditorDecorationType({
        overviewRulerColor: "rgba(255, 200, 80, 0.85)",
        overviewRulerLane: vscode.OverviewRulerLane.Center
    });
}
function isEnabled() {
    return vscode.workspace.getConfiguration("ascoState").get("enabled", true);
}
function trackedKeywords() {
    return vscode.workspace
        .getConfiguration("ascoState")
        .get("trackKeywords", DEFAULT_KEYWORDS);
}
function allowedExtensions() {
    return vscode.workspace
        .getConfiguration("ascoState")
        .get("fileExtensions", [".asco", ".asco.txt"]);
}
function isScoreDocument(doc) {
    const name = doc.fileName.toLowerCase();
    return allowedExtensions().some(ext => name.endsWith(ext.toLowerCase()));
}
function stripComment(line) {
    const semicolon = line.indexOf(";");
    return semicolon >= 0 ? line.slice(0, semicolon) : line;
}
function parseStateCommand(line, keywords) {
    const trimmed = stripComment(line).trim();
    if (!trimmed)
        return undefined;
    if (trimmed.startsWith("NOTE "))
        return undefined;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2)
        return undefined;
    const key = parts[0];
    if (!keywords.includes(key))
        return undefined;
    return { key, value: parts.slice(1).join(" ") };
}
function parseSynthRange(value) {
    const parts = value.trim().split(/\s+/);
    if (parts.length < 2)
        return undefined;
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (Number.isNaN(a) || Number.isNaN(b))
        return undefined;
    return [Math.min(a, b), Math.max(a, b)];
}
function pitchClassToSemitone(pc) {
    const map = {
        C: 0,
        "C#": 1,
        Db: 1,
        D: 2,
        "D#": 3,
        Eb: 3,
        E: 4,
        F: 5,
        "F#": 6,
        Gb: 6,
        G: 7,
        "G#": 8,
        Ab: 8,
        A: 9,
        "A#": 10,
        Bb: 10,
        B: 11
    };
    return map[pc];
}
function noteNameToMidi(name) {
    const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim());
    if (!m)
        return undefined;
    const pc = (m[1].toUpperCase() + m[2]);
    const octave = Number(m[3]);
    const semitone = pitchClassToSemitone(pc);
    if (semitone === undefined)
        return undefined;
    return (octave + 1) * 12 + semitone;
}
function parseNoteLine(line) {
    const trimmed = stripComment(line).trim();
    const m = /^NOTE\s+(-?[A-Ga-g][#b]?-?\d+)\b/.exec(trimmed);
    if (!m)
        return undefined;
    const noteName = m[1];
    if (noteName.startsWith("-"))
        return undefined; // held/tied note
    const midi = noteNameToMidi(noteName);
    if (midi === undefined)
        return undefined;
    return { noteName, midi };
}
function parseChordLine(line) {
    const trimmed = stripComment(line).trim();
    const m = /^CHORD\s*\(([^)]*)\)/.exec(trimmed);
    if (!m)
        return undefined;
    const rawNotes = m[1]
        .trim()
        .split(/\s+/)
        .map(x => x.trim())
        .filter(Boolean)
        .filter(x => x !== "0")
        .filter(x => !x.startsWith("-")); // ignore held/tied notes completely
    if (rawNotes.length === 0)
        return undefined;
    const noteNames = [];
    const midis = [];
    for (const raw of rawNotes) {
        const midi = noteNameToMidi(raw);
        if (midi !== undefined) {
            noteNames.push(raw);
            midis.push(midi);
        }
    }
    if (midis.length === 0)
        return undefined;
    return { noteNames, midis };
}
function bassCandidateFromRange(state, midiValues, noteNames) {
    const rawRange = state["synthrange"];
    if (!rawRange)
        return undefined;
    const range = parseSynthRange(rawRange);
    if (!range)
        return undefined;
    const [low, high] = range;
    if (low === 1 && high === 1)
        return undefined;
    const filtered = midiValues
        .map((midi, i) => ({ midi, noteName: noteNames?.[i] }))
        .filter(x => x.midi >= low && x.midi <= high)
        .sort((a, b) => a.midi - b.midi);
    if (filtered.length === 0)
        return undefined;
    return filtered[0];
}
function analyseDocument(doc) {
    const keywords = trackedKeywords();
    const lines = [];
    const state = {};
    const stateChanges = [];
    for (let i = 0; i < doc.lineCount; i++) {
        const text = doc.lineAt(i).text;
        const stateBefore = { ...state };
        const command = parseStateCommand(text, keywords);
        if (command) {
            state[command.key] = command.value;
            stateChanges.push({
                keyword: command.key,
                value: command.value,
                line: i
            });
        }
        let noteMidi;
        let noteName;
        let chordMidis;
        let chordNotes;
        let bassCandidateMidi;
        let bassCandidateNote;
        let triggersSynth = false;
        const note = parseNoteLine(text);
        if (note) {
            noteMidi = note.midi;
            noteName = note.noteName;
        }
        const chord = parseChordLine(text);
        if (chord) {
            chordMidis = chord.midis;
            chordNotes = chord.noteNames;
        }
        if (noteMidi !== undefined) {
            const candidate = bassCandidateFromRange(state, [noteMidi], noteName ? [noteName] : undefined);
            if (candidate) {
                bassCandidateMidi = candidate.midi;
                bassCandidateNote = candidate.noteName;
                triggersSynth = true;
            }
        }
        if (chordMidis && chordMidis.length > 0) {
            const candidate = bassCandidateFromRange(state, chordMidis, chordNotes);
            if (candidate) {
                bassCandidateMidi = candidate.midi;
                bassCandidateNote = candidate.noteName;
                triggersSynth = true;
            }
        }
        lines.push({
            lineNumber: i,
            text,
            stateBefore,
            stateAfter: { ...state },
            noteMidi,
            noteName,
            chordMidis,
            chordNotes,
            bassCandidateMidi,
            bassCandidateNote,
            dedupedBass: false,
            newlyTriggeredBass: false,
            triggersSynth
        });
    }
    let lastPlayedBass;
    for (const line of lines) {
        if (line.bassCandidateMidi === undefined)
            continue;
        if (line.bassCandidateMidi === lastPlayedBass) {
            line.dedupedBass = true;
            line.newlyTriggeredBass = false;
        }
        else {
            line.dedupedBass = false;
            line.newlyTriggeredBass = true;
            lastPlayedBass = line.bassCandidateMidi;
        }
    }
    return {
        lines,
        currentState: { ...state },
        stateChanges
    };
}
function rangesForLines(doc, lineNumbers) {
    return lineNumbers.map(line => {
        const lastChar = Math.max(0, doc.lineAt(line).text.length);
        return new vscode.Range(line, 0, line, lastChar);
    });
}
function buildSidebarItems(editor, analysis) {
    const cursorLine = editor.selection.active.line;
    const currentLineAnalysis = analysis.lines[Math.min(cursorLine, analysis.lines.length - 1)];
    const items = [];
    items.push(new StateItem("Cursor line", `${cursorLine + 1}`));
    const keys = trackedKeywords();
    for (const key of keys) {
        const value = currentLineAnalysis?.stateAfter[key] ?? "—";
        const lastChange = [...analysis.stateChanges].reverse().find(x => x.keyword === key && x.line <= cursorLine);
        const desc = lastChange ? `${value}  @ line ${lastChange.line + 1}` : `${value}`;
        items.push(new StateItem(key, desc, lastChange?.line));
    }
    const newlyTriggered = analysis.lines.filter(x => x.newlyTriggeredBass).length;
    const deduped = analysis.lines.filter(x => x.dedupedBass).length;
    items.push(new StateItem("New bass triggers", String(newlyTriggered)));
    items.push(new StateItem("Deduped bass repeats", String(deduped)));
    return items;
}
function refreshEditor(editor, provider) {
    if (!editor || !isEnabled() || !isScoreDocument(editor.document)) {
        provider.refresh([]);
        return;
    }
    const analysis = analyseDocument(editor.document);
    const triggeredLines = analysis.lines
        .filter(x => x.newlyTriggeredBass)
        .map(x => x.lineNumber);
    const dedupedLines = analysis.lines
        .filter(x => x.dedupedBass)
        .map(x => x.lineNumber);
    const stateChangeLines = analysis.stateChanges.map(x => x.line);
    const noteLines = analysis.lines
        .filter(x => x.noteMidi !== undefined || x.chordMidis !== undefined)
        .map(x => x.lineNumber);
    editor.setDecorations(triggerDecoration, rangesForLines(editor.document, triggeredLines));
    editor.setDecorations(stateLineDecoration, rangesForLines(editor.document, stateChangeLines));
    editor.setDecorations(overviewDecoration, rangesForLines(editor.document, noteLines));
    editor.setDecorations(dedupedDecoration, rangesForLines(editor.document, dedupedLines));
    provider.refresh(buildSidebarItems(editor, analysis));
}
function activate(context) {
    createDecorations();
    const provider = new AscoStateProvider();
    vscode.window.registerTreeDataProvider("ascoState.currentState", provider);
    context.subscriptions.push(vscode.commands.registerCommand("ascoState.refresh", () => {
        refreshEditor(vscode.window.activeTextEditor, provider);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("revealLine", async (line) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const pos = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => refreshEditor(editor, provider)), vscode.window.onDidChangeTextEditorSelection(e => refreshEditor(e.textEditor, provider)), vscode.workspace.onDidChangeTextDocument(e => {
        const active = vscode.window.activeTextEditor;
        if (active && e.document === active.document) {
            refreshEditor(active, provider);
        }
    }), vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration("ascoState")) {
            refreshEditor(vscode.window.activeTextEditor, provider);
        }
    }));
    refreshEditor(vscode.window.activeTextEditor, provider);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map