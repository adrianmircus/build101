// The guided demo from the landing. The cookie only tells the UI it's in the demo (the tour, the bar, its own
// data); what a demo session may do comes from the signed session, never from this cookie.
export const DEMO_COOKIE = "tiza-demo";

// Paula G., the student who answers with eye gaze: the tour ends on her side.
export const DEMO_STUDENT = "demo-s2";

// Client only: on the server there is no document and it's never the demo.
export function isDemo(): boolean {
  return typeof document !== "undefined" && document.cookie.split("; ").includes(`${DEMO_COOKIE}=1`);
}
