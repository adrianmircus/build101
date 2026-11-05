import { ImageResponse } from "next/og";

// The image shown when the landing is shared (WhatsApp, redes): the hero's sentence on the board.
// It uses ImageResponse's default font: Lexend would need its .ttf in the repo (next/font only serves .woff2).
export const alt = "Tiza.ai: el mismo práctico, para quien tiene dislexia";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#1e1b4b",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", fontSize: 40, fontWeight: 700 }}>
          Tiza<span style={{ color: "#fcd34d" }}>.ai</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 76, fontWeight: 700, lineHeight: 1.15 }}>
          <span>El mismo práctico,</span>
          <span>para quien tiene</span>
          <span style={{ color: "#fcd34d" }}>dislexia.</span>
        </div>
        <div style={{ display: "flex", fontSize: 30, color: "#e0e7ff" }}>
          Una versión para cada estudiante del grupo, y vos aprobás cada una.
        </div>
      </div>
    ),
    size,
  );
}
