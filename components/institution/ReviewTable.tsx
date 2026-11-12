import type { ReactNode } from "react";
import { Icon } from "./Icon";

// The table of a «revisar» step: what will happen to each line, before anything has effect. Read as a table by a
// screen reader (caption and headers), and a line with a problem says so in words with an icon, never only in color.

export type ReviewLine = {
  key: string;
  first: ReactNode;
  second: ReactNode;
  /** The reason or the explanation under the second cell. */
  note?: { text: string; kind: "problem" | "info"; id?: string } | null;
  /** A control for the line, such as «Corregir». */
  action?: ReactNode;
};

type Props = { caption: string; heads: [string, string]; lines: ReviewLine[] };

export function ReviewTable({ caption, heads, lines }: Props) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      <table className="w-full table-fixed text-left text-lg">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-slate-100 text-base text-slate-800">
            <th scope="col" className="w-[44%] px-4 py-3 font-semibold sm:w-1/2">
              {heads[0]}
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              {heads[1]}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.key} className={line.note?.kind === "problem" ? "bg-red-50 align-top" : "align-top"}>
              <td className="px-4 py-3 [overflow-wrap:anywhere]">{line.first}</td>
              <td className="px-4 py-3 [overflow-wrap:anywhere]">
                {line.second}
                {line.note && (
                  <p id={line.note.id} className="mt-2 flex gap-2 text-base text-slate-900">
                    <Icon name={line.note.kind === "problem" ? "alert" : "idea"} className="mt-0.5 size-5" />
                    <span>{line.note.text}</span>
                  </p>
                )}
                {line.action}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
