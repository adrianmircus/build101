// Files that exceed a size or complexity limit today, with only the rules each one breaks.
// This list can only shrink: the ticket that touches one of these files splits it and deletes its
// entry. Never add a file here; split it instead. Regenerate only with eslint/build-legacy.mjs.

const legacyRules = {
  "app/api/assessments/read-pdf/route.ts": ["complexity"],
  "app/page.tsx": ["max-lines", "tiza/function-size"],
  "components/assessments/AssessmentDetail.tsx": ["complexity", "max-lines", "tiza/function-size"],
  "components/assessments/NewAssessment.tsx": ["complexity", "max-lines", "tiza/function-size"],
  "components/demo/Tour.tsx": ["complexity", "max-lines", "max-params", "tiza/function-size"],
  "components/results/GradeExercises.tsx": ["complexity", "max-lines"],
  "components/results/ResultsTab.tsx": ["complexity", "max-lines", "tiza/function-size"],
  "components/solve/DictationAnswer.tsx": ["complexity", "max-lines", "tiza/function-size"],
  "components/solve/Listen.tsx": ["complexity"],
  "components/solve/SolveAssessment.tsx": ["complexity", "max-lines", "tiza/function-size"],
  "components/student/gaze/GazeSession.tsx": ["complexity", "max-lines"],
  "components/student/gaze/useDwell.ts": ["tiza/function-size"],
  "components/student/gaze/useGaze.ts": ["tiza/function-size"],
  "components/student/voice/VoiceCommands.tsx": ["complexity"],
  "components/syllabus/SyllabusEditor.tsx": ["complexity", "max-lines"],
  "components/ui/AiProgress.tsx": ["complexity"],
  "components/ui/FunctionGraph.tsx": ["max-params"],
  "components/ui/MathText.tsx": ["complexity"],
  "lib/agent/client.ts": ["complexity"],
  "lib/agent/exercises.ts": ["tiza/function-size"],
  "lib/agent/generate.ts": ["complexity", "tiza/function-size"],
  "lib/agent/prompt.ts": ["complexity"],
  "lib/groups/generate.ts": ["complexity", "tiza/function-size"],
  "lib/groups/numberCheck.ts": ["complexity"],
  "lib/groups/store.ts": ["max-depth", "max-params"],
  "lib/results/exercises.ts": ["complexity"],
  "lib/solve/steps.ts": ["complexity"],
  "lib/speech/latexSpeech.ts": ["complexity", "max-params", "tiza/function-size"],
  "lib/speech/useDictation.ts": ["max-lines", "tiza/function-size"],
  "lib/speech/voice.ts": ["tiza/function-size"],
  "lib/voice/commands.ts": ["complexity"],
  "proxy.ts": ["complexity"],
  "scripts/distill-profiles.mjs": ["complexity", "max-lines", "max-params", "tiza/function-size"],
  "scripts/research-profiles.mjs": ["complexity", "max-params", "tiza/function-size"],
  "scripts/research-profiles.test.ts": ["max-params"],
  "lib/auth/rateLimit.test.ts": ["max-params"],
};

export const legacyFiles = Object.keys(legacyRules);

export const legacy = Object.entries(legacyRules).map(([file, rules]) => ({
  files: [file],
  rules: Object.fromEntries(rules.map((rule) => [rule, "off"])),
}));
