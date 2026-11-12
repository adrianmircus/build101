import type { AccessCard } from "@/lib/domain/accounts/entities";
import { CardFace } from "./CardFace";
import { chunk, CARDS_PER_SHEET, firstName } from "./cards-state";
import { QrCode } from "./QrCode";

// The sheets that go to the printer: A4 with four A6 cards. This block is `display: none` on the screen and shows only
// in @media print, so the passwords are never drawn on the screen: the screen reader does not read it either
// (display: none), and it is the only place where they exist in the page. It leaves when «Listo» or pagehide clear them.

const MARKS = "linear-gradient(#94a3b8,#94a3b8)";
// Two small crop marks at opposite corners of each card, so the sheet is cut in four with a ruler.
const CROP_MARKS = {
  backgroundImage: `${MARKS}, ${MARKS}, ${MARKS}, ${MARKS}`,
  backgroundSize: "4mm .25mm, .25mm 4mm, 4mm .25mm, .25mm 4mm",
  backgroundPosition: "100% 100%, 100% 100%, 0 0, 0 0",
  backgroundRepeat: "no-repeat",
  printColorAdjust: "exact",
  WebkitPrintColorAdjust: "exact",
} as const;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function PrintSheets({ cards, groupName }: { cards: readonly AccessCard[]; groupName: string }) {
  return (
    <div data-print-sheets="" className="hidden print:block" aria-hidden="true">
      {/* The sheet is A4 with no margin: the browser's own margins would push the second row to another page. */}
      <style>{"@page { size: A4; margin: 0; }"}</style>
      {chunk(cards, CARDS_PER_SHEET).map((sheet, index) => (
        <section key={sheet[0]?.studentId ?? index} className="grid h-[296mm] w-[210mm] grid-cols-[105mm_105mm] grid-rows-[148mm_148mm] break-after-page last:break-after-auto">
          {sheet.map((card) => (
            <article key={card.studentId} className="break-inside-avoid overflow-hidden px-[11mm] pt-[12mm] pb-[9mm]" style={CROP_MARKS}>
              <CardFace
                variant="paper"
                hello={firstName(card.displayName)}
                qr={<QrCode value={card.qrUrl} className="size-full" />}
                address={`${hostOf(card.qrUrl)}/ingresar/estudiante`}
                schoolCode={card.institutionCode}
                username={card.username}
                password={<span className="whitespace-nowrap">{card.password}</span>}
                footer={`${card.displayName} · ${groupName} · ${card.institutionName}`}
              />
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
