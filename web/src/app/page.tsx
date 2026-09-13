import type { Metadata } from "next";
import { BankingDemo } from "@/components/BankingDemo";

export const metadata: Metadata = {
  title: "Small One",
};

export default function Home() {
  return <BankingDemo />;
}
