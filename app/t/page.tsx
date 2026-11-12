"use client";

import { CardLanding } from "@/components/auth/student/CardLanding";

// A Client Component on purpose: the token of the card travels in the fragment (/t#<token>), which only the browser
// sees. CardLanding reads it, takes it out of the address bar and sends it in the body of a Server Action.
export default function CardPage() {
  return <CardLanding />;
}
