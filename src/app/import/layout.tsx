import { SiteHeader } from "@/components/site-header";

export default function ImportLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-6 pb-safe">{children}</main>
    </>
  );
}
