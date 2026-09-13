"use client";

import { useState } from "react";
import { clock, prefix, secondsUntil } from "@/app/lib-client/format";
import type { Assertion } from "@/app/lib-client/types";
import { KV, StateBadge, TEXT } from "./ui";

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
    <div className="flex flex-col gap-2 rounded-sm border border-ok/40 bg-ok/5 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">Assertion</span>
        <div className="flex items-center gap-2">
          <StateBadge value={assertion.assurance} />
          <span className={`font-mono text-[11px] ${ttl === 0 ? TEXT.bad : ttl < 15 ? TEXT.warn : TEXT.neutral}`}>
            {ttl === 0 ? "expired" : `expires in ${ttl} s`}
          </span>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-3">
        <KV k="nonce">{assertion.nonce}</KV>
        <KV k="iat / exp">
          {clock(assertion.iat * 1000)} → {clock(assertion.exp * 1000)}
        </KV>
        <KV k="kid">{assertion.kid}</KV>
        <KV k="evidence_digest">
          <span title={assertion.evidence_digest}>{prefix(assertion.evidence_digest, 20)}</span>
        </KV>
        <KV k="passkey_cred_id">
          <span title={assertion.passkey_cred_id}>{prefix(assertion.passkey_cred_id, 20)}</span>
        </KV>
        <KV k="sig">
          <span title={assertion.sig}>{prefix(assertion.sig, 20)}</span>
        </KV>
      </dl>
      <div className="flex items-center gap-2">
        <button type="button" className="btn" onClick={download}>
          Download assertion.json
        </button>
        <button type="button" className="btn" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
