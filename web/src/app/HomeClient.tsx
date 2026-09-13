"use client";

import dynamic from "next/dynamic";

// Console reads sessionStorage (?focus=latest) and wall-clock login text.
// Must stay client-only to avoid hydration mismatches.
const Console = dynamic(() => import("@/components/Console").then((m) => m.Console), {
  ssr: false,
  loading: () => (
    <div className="relative min-h-screen overflow-x-hidden px-3 sm:px-5">
      <div className="tty">
        <div className="tty-bar">
          <span className="tty-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span>araxia — tty.ble</span>
        </div>
        <div className="tty-body">
          <pre className="text-[12px] leading-relaxed text-muted whitespace-pre-wrap">{`Araxia 16  tty.ble
# sandbox. not a bank.

last login: ble`}</pre>
        </div>
      </div>
    </div>
  ),
});

export function HomeClient() {
  return <Console />;
}
