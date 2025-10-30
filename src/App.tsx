import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Typing for Texting — Single-file App.tsx
 * - Modes: Copy / Listen / Roleplay
 * - Sequential key guide, ✅ tick + chime on correct
 * - Roleplay: centred prompt bubble, centred controls, show/hide replies
 * - Prev/Skip with wrap-around on all screens
 * - Larger keyboard & typed text
 * - Prefers Google UK English Female voice
 * - Self-tests summary at the bottom
 */

// ---------- Data ----------
const WORDS = [
  "Yes", "No", "Great", "Good", "Fine", "Love", "Miss",
  "You", "Tired", "Pain", "Ok",
  // +20 common 3-letter content words (UK-friendly)
  "Mum", "Dad", "Run", "Eat", "Fix", "Pay", "Buy", "Try", "Use", "Cry",
  "Hug", "Nap", "Win", "Bus", "Car", "Bed", "Pet", "Cat", "Dog", "Sun"
];

const ALIASES: Record<string, string[]> = {
  Ok: ["ok", "OK", "okay"],
};

type Scenario = { id: string; prompt: string; suggestions: string[] };

// ---------- Utils ----------
const norm = (s: string) => s.toLowerCase().trim().replace(/[.!?,]+$/g, "");

function pickUkVoice(voices: SpeechSynthesisVoice[], preferredName?: string) {
  const byName = (n: string) => voices.find(v => v.name === n);
  if (preferredName) {
    const exact = byName(preferredName);
    if (exact) return exact;
  }
  const googleUkFemale = byName("Google UK English Female");
  if (googleUkFemale) return googleUkFemale;

  const enGbVoices = voices.filter(v => v.lang?.toLowerCase() === "en-gb");
  const femaleish = enGbVoices.find(v => /female|woman|girl/i.test(v.name));
  if (femaleish) return femaleish;

  const googleUkMale = byName("Google UK English Male");
  if (googleUkMale) return googleUkMale;

  return (
    enGbVoices[0] ||
    voices.find(v => v.lang?.toLowerCase().startsWith("en-")) ||
    voices[0]
  );
}

function useSpeech() {
  const synth = window.speechSynthesis;
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    const load = () => {
      const v = synth.getVoices();
      const preferredName = localStorage.getItem("ttsVoiceName") || "Google UK English Female";
      voiceRef.current = pickUkVoice(v, preferredName) ?? null;
    };
    load();
    synth.onvoiceschanged = load;
    return () => {
      (synth as any).onvoiceschanged = null;
    };
  }, []);

  const speak = (text: string) => {
    if (!text) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voiceRef.current) u.voice = voiceRef.current;
    u.rate = 0.92;
    u.pitch = 1.05;
    synth.speak(u);
  };

  return { speak };
}

function errorBeep() {
  const Ctx: any = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine"; o.frequency.value = 220; o.connect(g); g.connect(ctx.destination);
  const now = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  o.start(); o.stop(now + 0.1);
}

// Positive feedback chime (two-note up) when correct
function successChime() {
  const Ctx: any = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const now = ctx.currentTime;

  const play = (freq: number, t0: number, dur = 0.12) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine"; o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.start(t0); o.stop(t0 + dur + 0.02);
  };

  play(660, now, 0.12);      // E5
  play(880, now + 0.12, 0.14); // A5
}

// ---------- Roleplay data ----------
const LEXICON = [
  // affirmation
  "yes","yeah","yep","y","ok","okay","good","great","fine",
  // negative/hedge
  "no","nah","nope","bad","maybe",
  // state
  "tired","busy","hungry","cold","hot","pain","sore","dizzy",
  // place/time
  "home","later","now",
  // social
  "love","miss","sorry","thanks","hello","hi","bye"
];
const LEXSET = new Set(LEXICON.map(norm));

const SCENARIOS: Scenario[] = [
  { id: "how-are-you",   prompt: "How are you, Dad?",            suggestions: ["Good","Fine"] },
  { id: "pain-check",    prompt: "Are you in pain?",             suggestions: ["No","Yes"] },
  { id: "call-now",      prompt: "Can I call you now?",          suggestions: ["Yes","No"] },
  { id: "groceries",     prompt: "Need anything from the shop?", suggestions: ["No","Hungry"] },
  { id: "tired-check",   prompt: "Are you tired?",               suggestions: ["Tired","Fine"] },
  { id: "visit-time",    prompt: "Can I come now?",              suggestions: ["Now","Later"] },
  { id: "where-are-you", prompt: "Are you at home?",             suggestions: ["Home","Later"] },
  { id: "go-out",        prompt: "Shall we go out today?",       suggestions: ["Yes","No"] },
  { id: "shirt-choice",  prompt: "Red shirt okay?",              suggestions: ["Ok","No"] },
  { id: "thanks-prompt", prompt: "Thanks for today ❤️",          suggestions: ["Thanks","Love","Bye"] },
];

// =============================================================
// Keyboard (fixed, larger) + sequential highlight helper
// =============================================================
const ROWS = ["QWERTYUIOP","ASDFGHJKL","ZXCVBNM"];

// Index helpers for wrap-around navigation
function nextIdx(len: number, i: number) { return (i + 1) % len; }
function prevIdx(len: number, i: number) { return (i - 1 + len) % len; }

// Helper to decide which keys should glow
function computeHighlight(
  guideLetters: string[],
  nextRequired: string,
  guidesOn: boolean,
  sequential = true
) {
  if (!guidesOn) return new Set<string>();
  const set = new Set<string>();
  if (sequential) {
    const next = (nextRequired || "").toUpperCase();
    if (next) set.add(next);
  } else {
    guideLetters.forEach(ch => set.add(ch.toUpperCase()));
    const next = (nextRequired || "").toUpperCase();
    if (next) set.add(next);
  }
  return set;
}

function Key({ label, onClick, wide=false, xwide=false, ring=false }: {
  label: string; onClick: () => void; wide?: boolean; xwide?: boolean; ring?: boolean;
}) {
  const base: React.CSSProperties = {
    position: "relative",
    height: 80, // larger keys
    minWidth: xwide ? 320 : wide ? 140 : 72,
    border: "1px solid #d0d5dd",
    borderRadius: 16,
    background: "#fff",
    padding: "0 18px",
    fontWeight: 800,
    fontSize: 22,
    boxShadow: "0 1px 1px rgba(0,0,0,.05)",
  };
  const ringStyle: React.CSSProperties = ring ? { boxShadow: "0 0 0 3px #34d399 inset" } : {};
  return (
    <button onClick={onClick} style={{ ...base, ...ringStyle }} aria-label={label}>
      {label}
    </button>
  );
}

function Keyboard({
  onKey,
  guidesOn = true,
  guideLetters = [],
  nextRequired = "",
  sequential = true, // one-at-a-time highlight
  showEnter = true,
  showBackspace = true,
  showSpace = false
}: {
  onKey: (k: string) => void;
  guidesOn?: boolean;
  guideLetters?: string[];
  nextRequired?: string;
  sequential?: boolean;
  showEnter?: boolean;
  showBackspace?: boolean;
  showSpace?: boolean;
}) {
  const highlight = computeHighlight(guideLetters, nextRequired, guidesOn, sequential);
  return (
    <div style={{ userSelect: "none" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        {ROWS.map((row, i) => (
          <div key={row} style={{ display: "flex", gap: 12 }}>
            {row.split("").map((ch) => (
              <Key
                key={ch}
                label={ch}
                onClick={() => onKey(ch)}
                ring={highlight.has(ch)}
              />
            ))}
            {i === 1 && showBackspace && (
              <Key label="⌫" wide onClick={() => onKey("Backspace")} />
            )}
          </div>
        ))}
        <div style={{ display: "flex", gap: 12 }}>
          {showSpace && <Key label="Space" xwide onClick={() => onKey(" ")} />}
          {showEnter && <Key label="Enter ⏎" wide onClick={() => onKey("Enter")} />}
        </div>
      </div>
    </div>
  );
}

// =============================================================
// Copy / Listen game logic
// =============================================================
function useTypingGame(wordList: string[], holdMs: number) {
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [assisted, setAssisted] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [errors, setErrors] = useState(0);

  const target = useMemo(() => wordList[index] ?? "", [wordList, index]);
  const nextRequired = (target[typed.length] ?? "") as string;
  const guideLetters = Array.from(new Set(target.toUpperCase().split("")));

  const variants = useMemo(() => {
    const base = [target, ...(ALIASES[target] || [])];
    return new Set(base.map(norm));
  }, [target]);

  const onKey = (key: string) => {
    if (completed) return;
    if (key === "Backspace") { setTyped(t => t.slice(0, -1)); return; }
    if (key.length === 1) {
      const want = (nextRequired || "").toLowerCase();
      const got = key.toLowerCase();
      if (want && got === want) {
        setTyped(t => {
          const nt = t + key;
          if (variants.has(norm(nt))) {
            setCompleted(true);
            successChime();
            setTimeout(() => advance(), holdMs);
          }
          return nt;
        });
      } else {
        setErrors(e => e + 1); errorBeep();
      }
    }
  };

  const advance = () => {
    setCompleted(false); setTyped(""); setAssisted(false); setErrors(0);
    setIndex(i => nextIdx(wordList.length, i));
  };
  const retreat = () => {
    setCompleted(false); setTyped(""); setAssisted(false); setErrors(0);
    setIndex(i => prevIdx(wordList.length, i));
  };
  const revealWord = () => setAssisted(true);
  const resetWord = () => { setTyped(""); setCompleted(false); setErrors(0); setAssisted(false); };
  const skipWord = () => advance();
  const prevWord = () => retreat();

  return { index, target, typed, assisted, errors, completed, onKey, revealWord, resetWord, skipWord, prevWord, nextRequired, guideLetters } as const;
}

function PracticeScreen({ mode, words, guidesOn, holdMs }: {
  mode: "copy" | "listen"; words: string[]; guidesOn: boolean; holdMs: number;
}) {
  const { speak } = useSpeech();
  const game = useTypingGame(words, holdMs);

  useEffect(() => { if (mode === "listen" && game.target) speak(game.target); }, [mode, game.index]);
  useEffect(() => { const h = (e: KeyboardEvent) => game.onKey(e.key); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [game]);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", display: "grid", gap: 16 }}>
      {/* Prompt word + ✅ next to/below (not overlay) */}
      <div style={{ textAlign: "center", minHeight: 64 }}>
        {mode === "copy" ? (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: 1 }}>{game.target}</div>
            {game.completed && (
              <span style={{ display: "inline-flex", width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>✅</span>
            )}
          </div>
        ) : game.assisted ? (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: 1 }}>{game.target}</div>
            {game.completed && (
              <span style={{ display: "inline-flex", width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>✅</span>
            )}
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 22, color: "#475467" }}>🎧 Listen and type the word</div>
            {game.completed && (<div style={{ marginTop: 8 }}>✅</div>)}
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        {mode === "listen" && (
          <>
            <button className="btn" onClick={() => speak(game.target)}>🔊 Repeat</button>
            <button className="btn" onClick={() => game.revealWord()} title="Reveal word (assisted)">👁 Show word</button>
          </>
        )}
        <button className="btn" onClick={() => game.resetWord()}>↺ Reset</button>
        <button className="btn" onClick={() => game.prevWord()}>◀ Prev</button>
        <button className="btn" onClick={() => game.skipWord()}>⏭ Skip</button>
      </div>

      {/* Typed buffer */}
      <div style={{ textAlign: "center", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace", fontSize: 32, minHeight: 44 }}>
        {game.typed}
      </div>

      {/* Keyboard */}
      <Keyboard
        onKey={game.onKey}
        guidesOn={guidesOn}
        guideLetters={game.guideLetters}
        nextRequired={(game.nextRequired || "").toUpperCase()}
        sequential={true}
        showEnter={false}
        showBackspace
      />

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, textAlign: "center", fontSize: 14, color: "#344054" }}>
        <div><b>Word</b> {game.index + 1}/{words.length}</div>
        <div><b>Errors</b> {game.errors}</div>
        <div><b>Assisted</b> {game.assisted ? "Yes" : "No"}</div>
      </div>
    </div>
  );
}

// =============================================================
// Roleplay game logic (lexicon-based, guides disabled)
// =============================================================
function useRoleplayGame(scenarios: Scenario[], holdMs: number) {
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [assisted, setAssisted] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [errors, setErrors] = useState(0);

  const scenario = scenarios[index];

  const onKey = (key: string) => {
    if (completed) return;
    if (key === "Backspace") { setTyped(t => t.slice(0, -1)); return; }
    if (key === "Enter") { checkCompletion(); return; }
    if (key.length === 1) setTyped(t => t + key);
  };

  const fillSuggestion = (s: string) => setTyped(s);

  const checkCompletion = () => {
    const c = norm(typed);
    if (c && !c.includes(" ") && LEXSET.has(c)) {
      setCompleted(true);
      successChime();
      setTimeout(() => advance(), holdMs);
    } else { setErrors(e => e + 1); errorBeep(); }
  };

  const advance = () => {
    setCompleted(false); setTyped(""); setAssisted(false); setErrors(0);
    setIndex(i => nextIdx(scenarios.length, i));
  };
  const retreat = () => {
    setCompleted(false); setTyped(""); setAssisted(false); setErrors(0);
    setIndex(i => prevIdx(scenarios.length, i));
  };

  return { scenario, index, typed, assisted, errors, completed, setAssisted, onKey, checkCompletion, fillSuggestion, advance, retreat } as const;
}

function RoleplayScreen({ holdMs }: { holdMs: number }) {
  const { speak } = useSpeech();
  const game = useRoleplayGame(SCENARIOS, holdMs);

  useEffect(() => { if (game.scenario) speak(game.scenario.prompt); }, [game.scenario?.id]);
  useEffect(() => { const h = (e: KeyboardEvent) => game.onKey(e.key); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [game]);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", display: "grid", gap: 16 }}>
      {/* Incoming message bubble */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div
          style={{
            borderRadius: 18,
            padding: "14px 18px",
            background: "#d1fae5",  // green background
            color: "#065f46",       // dark green text
            maxWidth: "90%",
            width: "100%",
            textAlign: "center",
            fontSize: 24,
            fontWeight: 600,
            boxShadow: "0 2px 6px rgba(0,0,0,.05)"
          }}
        >
          {game.scenario?.prompt}
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <button className="btn" onClick={() => speak(game.scenario?.prompt || "")}>🔊 Play prompt</button>
        <button className="btn" onClick={() => game.setAssisted((a: boolean) => !a)}>
          {game.assisted ? "🙈 Hide replies" : "👁 Show replies"}
        </button>
        <button className="btn" onClick={() => game.checkCompletion()}>⏎ Check</button>
        <button className="btn" onClick={() => game.retreat()}>◀ Prev</button>
        <button className="btn" onClick={() => game.advance()}>⏭ Skip</button>
      </div>

      {/* Suggestions (chips) when assisted */}
      {game.assisted && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {game.scenario?.suggestions.map(s => (
            <button key={s} className="btn" onClick={() => game.fillSuggestion(s)}>{s}</button>
          ))}
        </div>
      )}

      {/* Typed buffer */}
      <div style={{ position: "relative", fontFamily: "ui-monospace, monospace", fontSize: 44, minHeight: 56, textAlign: "center" }}>
        {game.typed}
        {game.completed && <span style={{ marginLeft: 8 }}>✅</span>}
      </div>
      <div style={{ fontSize: 13, color: "#475467", textAlign: "center" }}>
        Type a <b>one-word</b> reply then press <span style={{ fontFamily: 'monospace' }}>Enter</span> or click <b>Check</b>.
      </div>

      {/* Keyboard without guides */}
      <Keyboard onKey={game.onKey} guidesOn={false} sequential={true} showEnter showBackspace />

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, textAlign: "center", fontSize: 14, color: "#344054" }}>
        <div><b>Prompt</b> {game.index + 1}/{SCENARIOS.length}</div>
        <div><b>Errors</b> {game.errors}</div>
        <div><b>Assisted</b> {game.assisted ? "Yes" : "No"}</div>
      </div>
    </div>
  );
}

// =============================================================
// Self-tests (simple runtime checks, results shown in footer)
// =============================================================
function runSelfTests() {
  const results: { name: string; pass: boolean; details?: string }[] = [];
  const add = (name: string, pass: boolean, details?: string) => results.push({ name, pass, details });

  // 1: LEXICON normalization (OK/Okay should pass)
  add("LEXICON ok/Okay", LEXSET.has(norm("OK")) && LEXSET.has(norm("Okay")));

  // 2: Reject multi-word replies in roleplay
  add("Reject multi-word", !LEXSET.has(norm("good day")));

  // 3: nextRequired logic (first letter is target[0])
  const t = "Good"; const typed = ""; const next = (t[typed.length] ?? "");
  add("nextRequired first letter", next === "G");

  // 4: ALIASES for Ok includes 'okay'
  const aliasSet = new Set(["Ok", ...(ALIASES["Ok"] || [])].map(norm));
  add("ALIASES includes okay", aliasSet.has("okay"));

  // 5/6: Sequential highlight
  const seq = computeHighlight(["G","O","D"], "O", true, true);
  const par = computeHighlight(["G","O","D"], "O", true, false);
  add("Sequential highlight size=1", seq.size === 1 && seq.has("O"));
  add("Parallel highlight includes letters", par.has("G") && par.has("O") && par.has("D"));

  // 7: successChime is callable
  add("successChime is function", typeof (successChime as any) === "function");

  // 8/9: navigation helpers wrap correctly
  add("nextIdx wraps 9->0", nextIdx(10, 9) === 0);
  add("prevIdx wraps 0->9", prevIdx(10, 0) === 9);

  // 10: guides off -> empty set
  add("Guides off yields empty set", computeHighlight(["A"], "A", false, true).size === 0);

  // 11: lexicon does not include empty string
  add("LEXSET excludes empty", !LEXSET.has(""));

  // 12: 'maybe' is in lexicon
  add("LEXICON includes maybe", LEXSET.has(norm("maybe")));

  return results;
}

function SelfTestPanel() {
  const tests = useMemo(runSelfTests, []);
  const allPass = tests.every(t => t.pass);
  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "8px 16px", color: allPass ? "#065f46" : "#7f1d1d" }}>
      <div style={{ fontSize: 12 }}>
        <b>Self-tests:</b> {tests.filter(t => t.pass).length}/{tests.length} passed
      </div>
    </div>
  );
}

// =============================================================
// App shell
// =============================================================
export default function App() {
  const [mode, setMode] = useState<"copy" | "listen" | "roleplay">("copy");
  const [guidesOn, setGuidesOn] = useState(true); // auto-disabled in roleplay
  const [holdMs] = useState(2000);
  useEffect(() => { if (mode === "roleplay") setGuidesOn(false); }, [mode]);

  const container: React.CSSProperties = { minHeight: "100dvh", background: "#fff", color: "#111827", fontFamily: "Inter, system-ui, Segoe UI, Roboto, Arial, sans-serif" };
  const headerRow: React.CSSProperties = { position: "sticky", top: 0, borderBottom: "1px solid #e5e7eb", background: "rgba(255,255,255,.9)", backdropFilter: "saturate(180%) blur(6px)" };

  return (
    <div style={container}>
      <header style={headerRow}>
        <div style={{ maxWidth: 880, margin: "0 auto", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 700 }}>Typing for Texting</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <ModeTabs mode={mode} setMode={setMode} />
            <button
              className="btn"
              onClick={() => setGuidesOn(g => !g)}
              disabled={mode === "roleplay"}
              title={mode === "roleplay" ? "Guides disabled in Roleplay" : "Toggle guides"}
            >
              ⚙ Guides: {guidesOn ? "On" : "Off"}
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 880, margin: "0 auto", padding: "24px 16px" }}>
        {mode === "copy" && (
          <PracticeScreen mode="copy" words={WORDS} guidesOn={guidesOn} holdMs={2000} />
        )}
        {mode === "listen" && (
          <PracticeScreen mode="listen" words={WORDS} guidesOn={guidesOn} holdMs={2000} />
        )}
        {mode === "roleplay" && (
          <RoleplayScreen holdMs={2000} />
        )}
      </main>

      <SelfTestPanel />
    </div>
  );
}

function ModeTabs({ mode, setMode }: { mode: "copy" | "listen" | "roleplay"; setMode: (m: any) => void }) {
  const tabs = [
    { id: "copy", label: "Copy" },
    { id: "listen", label: "Listen" },
    { id: "roleplay", label: "Roleplay" }
  ] as const;
  return (
    <div style={{ display: "inline-flex", padding: 4, borderRadius: 14, border: "1px solid #e5e7eb", background: "#fff" }}>
      {tabs.map(t => (
        <button
          key={t.id}
          className="btn"
          onClick={() => setMode(t.id)}
          style={{
            background: mode === t.id ? "#059669" : "#fff",
            color: mode === t.id ? "#fff" : "#111827",
            borderColor: mode === t.id ? "#059669" : "#e5e7eb"
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// Lightweight button styling (works without Tailwind)
const style = document.createElement("style");
// (Previously had a stray non-JS comment here, now fixed)
style.innerHTML = `.btn{display:inline-flex;align-items:center;gap:.5rem;border:1px solid #e5e7eb;padding:.5rem .75rem;border-radius:12px;font-weight:600;background:#fff;box-shadow:0 1px 1px rgba(0,0,0,.04)}.btn:hover{background:#f9fafb}.btn:active{transform:scale(.99)}`;
document.head.appendChild(style);
