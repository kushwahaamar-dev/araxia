import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
  description: "That path is not part of the Araxia console.",
};

export default function NotFound() {
  return (
    <div className="araxia-noise relative flex min-h-screen items-center justify-center overflow-x-hidden px-6">
      <div className="araxia-orb pointer-events-none fixed -top-80 -left-72 size-[46rem] rounded-full bg-[radial-gradient(circle,rgba(216,185,138,0.11),transparent_62%)] blur-3xl" />
      <div className="relative z-10 max-w-md text-center">
        <Image src="/logo-white.png" alt="Araxia" width={220} height={59} className="mx-auto h-8 w-auto" />
        <p className="mt-6 font-mono text-[11px] tracking-[0.22em] text-dim uppercase">HTTP 404</p>
        <h1 className="font-display mt-3 text-4xl tracking-[-0.04em] text-fg">This page is not in the console.</h1>
        <p className="mt-3 text-sm text-muted">
          Araxia is one screen. There is no unused navigation and no hidden admin path.
        </p>
        <Link href="/" className="btn btn-primary mt-6 inline-flex">
          Back to the console
        </Link>
      </div>
    </div>
  );
}
