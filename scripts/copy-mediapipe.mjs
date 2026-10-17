// Copies MediaPipe's WASM next to the app so eye tracking doesn't depend on a CDN during the demo.
import { cpSync, existsSync } from "node:fs";

const from = "node_modules/@mediapipe/tasks-vision/wasm";
if (existsSync(from)) cpSync(from, "public/mediapipe/wasm", { recursive: true });
