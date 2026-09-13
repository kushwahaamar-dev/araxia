import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
  description: "That path is not part of the Araxia console.",
};

export default function NotFound() {
  return (
    <div className="relative min-h-screen overflow-x-hidden px-5">
      <div className="shard-field" aria-hidden>
        <i className="shard shard-a" />
        <i className="shard shard-b" />
      </div>
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
          <Image src="/logo-white.png" alt="Araxia" width={220} height={59} className="h-5 w-auto opacity-90" />
          <p className="term-prompt mt-6">cd /missing</p>
          <h1 className="font-display mt-2 text-6xl leading-none text-white">404</h1>
          <p className="mt-3 text-[13px] text-muted">bash: cd: /missing: No such file or directory</p>
          <Link href="/" className="btn btn-primary mt-6 self-start">
            cd ~
          </Link>
        </div>
      </div>
    </div>
  );
}
