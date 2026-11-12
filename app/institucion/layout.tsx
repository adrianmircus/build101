import { InstitutionHeader } from "@/components/institution/InstitutionHeader";

// The admin area of a school. Every page under it checks that the person is an admin of that school (access.ts), and
// the database checks it again in each RPC.
export default function InstitutionLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col print:block print:min-h-0">
      <InstitutionHeader />
      <main id="main-content" className="mx-auto w-full max-w-5xl flex-1 px-4 pt-8 pb-16 print:m-0 print:block print:max-w-none print:p-0">
        {children}
      </main>
    </div>
  );
}
