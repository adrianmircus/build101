// Files that exceed a size or complexity limit today. Each one is frozen at its current numbers
// (not switched off), so it cannot grow. This list can only shrink: the ticket that touches one of
// these files splits it and deletes its entry. Never add a file here; split it instead.
// Regenerate only with eslint/build-legacy.mjs; eslint/legacy.test.ts fails on entries that no
// longer apply.

const legacyRules = {
  "app/api/assessments/read-pdf/route.ts": {"complexity":12},
  "app/page.tsx": {"tiza/function-size":{"max":40,"componentMax":212},"max-lines":255},
  "components/assessments/AssessmentDetail.tsx": {"tiza/function-size":{"max":40,"componentMax":540},"complexity":81,"max-lines":573},
  "components/assessments/NewAssessment.tsx": {"tiza/function-size":{"max":40,"componentMax":337},"complexity":41,"max-lines":407},
  "components/demo/Tour.tsx": {"tiza/function-size":{"max":72,"componentMax":178},"complexity":26,"max-params":5,"max-lines":478},
  "components/results/GradeExercises.tsx": {"complexity":18,"max-lines":374},
  "components/results/ResultsTab.tsx": {"complexity":12,"max-lines":419,"tiza/function-size":{"max":51,"componentMax":150}},
  "components/solve/DictationAnswer.tsx": {"tiza/function-size":{"max":40,"componentMax":297},"complexity":48,"max-lines":310},
  "components/solve/Listen.tsx": {"complexity":15},
  "components/solve/SolveAssessment.tsx": {"tiza/function-size":{"max":40,"componentMax":209},"complexity":31,"max-lines":393},
  "components/student/gaze/GazeSession.tsx": {"complexity":11,"max-lines":247},
  "components/student/gaze/useDwell.ts": {"tiza/function-size":{"max":43,"componentMax":40}},
  "components/student/gaze/useGaze.ts": {"tiza/function-size":{"max":90,"componentMax":40}},
  "components/student/voice/VoiceCommands.tsx": {"complexity":13},
  "components/syllabus/SyllabusEditor.tsx": {"complexity":11,"max-lines":283},
  "components/ui/AiProgress.tsx": {"complexity":19},
  "components/ui/FunctionGraph.tsx": {"max-params":4},
  "components/ui/MathText.tsx": {"complexity":11},
  "lib/agent/client.ts": {"complexity":14},
  "lib/agent/exercises.ts": {"tiza/function-size":{"max":49,"componentMax":40}},
  "lib/agent/generate.ts": {"tiza/function-size":{"max":91,"componentMax":40},"complexity":13},
  "lib/agent/prompt.ts": {"complexity":19},
  "lib/groups/generate.ts": {"tiza/function-size":{"max":65,"componentMax":40},"complexity":12},
  "lib/groups/numberCheck.ts": {"complexity":13},
  "lib/groups/store.ts": {"max-depth":5,"max-params":4},
  "lib/results/exercises.ts": {"complexity":13},
  "lib/solve/steps.ts": {"complexity":13},
  "lib/speech/latexSpeech.ts": {"complexity":17,"tiza/function-size":{"max":48,"componentMax":40},"max-params":4},
  "lib/speech/useDictation.ts": {"tiza/function-size":{"max":93,"componentMax":40},"max-lines":213},
  "lib/speech/voice.ts": {"tiza/function-size":{"max":48,"componentMax":40}},
  "lib/voice/commands.ts": {"complexity":14},
  "proxy.ts": {"complexity":17},
  "scripts/distill-profiles.mjs": {"max-params":5,"tiza/function-size":{"max":46,"componentMax":40},"complexity":17,"max-lines":285},
  "scripts/research-profiles.mjs": {"max-params":5,"tiza/function-size":{"max":46,"componentMax":40},"complexity":13},
};

export const legacyFiles = Object.keys(legacyRules);

const blank = { skipBlankLines: true, skipComments: true };

// Turns a frozen value into the rule configuration that enforces it.
function ruleConfig(rule, value) {
  if (rule === "max-lines") return ["error", { max: value, ...blank }];
  return ["error", value];
}

export const legacy = Object.entries(legacyRules).map(([file, rules]) => ({
  files: [file],
  rules: Object.fromEntries(Object.entries(rules).map(([rule, value]) => [rule, ruleConfig(rule, value)])),
}));
