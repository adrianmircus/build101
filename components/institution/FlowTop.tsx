"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { textLink } from "@/components/ui/styles";
import { Icon } from "./Icon";

// The top of a screen of the panel: the way back, the title and a short lead. The title takes the focus when the
// screen changes (focus), so a keyboard or screen reader user starts reading the new step, not the old one.

type Props = {
  title: string;
  lead?: React.ReactNode;
  /** Where «back» goes: a link to another page, or a button that only changes the step of the flow. */
  back: { label: string; href: string } | { label: string; onClick: () => void };
  focus?: boolean;
};

export function FlowTop({ title, lead, back, focus = false }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) heading.current?.focus();
  }, [focus]);
  const content = (
    <>
      <Icon name="back" className="size-5" />
      {back.label}
    </>
  );
  return (
    <header className="space-y-3">
      {"href" in back ? (
        <Link href={back.href} className={textLink}>
          {content}
        </Link>
      ) : (
        <button type="button" onClick={back.onClick} className={textLink}>
          {content}
        </button>
      )}
      <h1 ref={heading} tabIndex={-1} className="text-3xl font-bold outline-none sm:text-4xl">
        {title}
      </h1>
      {lead && <p className="max-w-2xl text-lg text-slate-700">{lead}</p>}
    </header>
  );
}
