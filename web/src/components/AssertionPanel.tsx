"use client";

import { useState } from "react";
import { clock, prefix, secondsUntil } from "@/app/lib-client/format";
import type { Assertion } from "@/app/lib-client/types";
import { StateBadge, TEXT } from "./ui";

export function AssertionPanel({ assertion, now }: { assertion: Assertion; now: number }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(assertion, null, 2);
  const ttl = secondsUntil(assertion.exp, now);

  const download = () => {
    const u = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = u;
    a.download = "assertion.json";
    a.click();
    URL.revokeObjectURL(u);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="term-prompt text-[12px]">
        cat assertion.json <StateBadge value={assertion.assurance} />
      </p>
      <p className={`text-[12px] ${ttl === 0 ? TEXT.bad : ttl < 15 ? TEXT.warn : "text-dim"}`}>
        {ttl === 0 ? "! expired" : `ttl ${ttl}s`}
      </p>
      <dl className="dump">
        <dt>nonce</dt>
        <dd>{assertion.nonce}</dd>
        <dt>iat/exp</dt>
        <dd>
          {clock(assertion.iat * 1000)} → {clock(assertion.exp * 1000)}
        </dd>
        <dt>kid</dt>
        <dd>{assertion.kid}</dd>
        <dt>evidence</dt>
        <dd title={assertion.evidence_digest}>{prefix(assertion.evidence_digest, 20)}</dd>
        <dt>passkey</dt>
        <dd title={assertion.passkey_cred_id}>{prefix(assertion.passkey_cred_id, 20)}</dd>
        <dt>sig</dt>
        <dd title={assertion.sig}>{prefix(assertion.sig, 20)}</dd>
      </dl>
      <div className="flex items-center gap-2">
        <button type="button" className="btn" onClick={download}>
          save
        </button>
        <button type="button" className="btn" onClick={copy}>
          {copied ? "copied" : "pbcopy"}
        </button>
      </div>
    </div>
  );
}
